import { parseTopics } from "@/lib/format";
import type { Repo } from "@/db/schema";
import type { CommercialScore } from "@/lib/hybrid-search";
import type { CompetitorMatch } from "@/lib/hybrid-search";
import type { DemandSignalMatch } from "@/lib/hybrid-search";

export type EnrichmentSource = "heuristic" | "gemini";

export type RepoEnrichment = {
  plainSummary: string;
  businessPitch: string;
  source: EnrichmentSource;
};

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function geminiAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

async function geminiGenerate(prompt: string, maxTokens: number = 600): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: maxTokens,
          topP: 0.9,
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[gemini] HTTP ${res.status}: ${await res.text().catch(() => "unreadable")}`);
      return null;
    }
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text?.trim() ?? null;
  } catch (err) {
    console.warn("[gemini] request failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Heuristic README simplification
// ---------------------------------------------------------------------------

const BADGE_RE = /^(?:!\[|<img|\[!\[)/;
const HEADING_BADGE_RE = /^#{1,6}\s*(?:!\[|<img|\[!\[)/;

function extractReadmeSections(readme: string): { intro: string; features: string[] } {
  const lines = readme.split("\n");
  const features: string[] = [];
  const intro: string[] = [];
  let inFeatures = false;
  let inCodeBlock = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (!line.trim()) continue;
    if (BADGE_RE.test(line.trim()) || HEADING_BADGE_RE.test(line.trim())) continue;

    const lower = line.toLowerCase().trim();
    if (/^#{1,6}\s*(features?|key features|what.*can.*do|highlights?|capabilities?)\b/.test(lower)) {
      inFeatures = true;
      continue;
    }
    if (/^#{1,6}\s/.test(line.trim()) && inFeatures) {
      inFeatures = false;
    }

    if (inFeatures && /^[-*•]\s+/.test(line.trim())) {
      const feat = line.trim().replace(/^[-*•]\s+/, "").replace(/\*\*/g, "").trim();
      if (feat && feat.length > 5 && feat.length < 200) features.push(feat);
      continue;
    }

    if (intro.length < 4 && !line.trim().startsWith("#") && !line.trim().startsWith("|") && !line.trim().startsWith(">")) {
      const clean = line.trim().replace(/\[(.+?)\]\([^)]+\)/g, "$1").replace(/`/g, "").replace(/\*\*/g, "").trim();
      if (clean.length > 15) intro.push(clean);
    }
  }

  return { intro: intro.join(" ").slice(0, 500), features: features.slice(0, 6) };
}

function heuristicSummary(repo: {
  name: string;
  full_name: string;
  description: string | null;
  readme_text: string | null;
  language: string | null;
  stars: number;
}): string {
  const { intro, features } = extractReadmeSections(repo.readme_text ?? "");
  const parts: string[] = [];

  const desc = repo.description?.trim();
  const lead = desc || intro;
  if (lead) {
    parts.push(lead.charAt(0).toUpperCase() + lead.slice(1) + (lead.endsWith(".") ? "" : "."));
  } else {
    parts.push(`${repo.name} est un projet open source.`);
  }

  const langClause = repo.language ? `Écrit en ${repo.language}` : null;
  const starClause = repo.stars >= 1000 ? ` et plébiscité par ${formatStars(repo.stars)} développeurs` : "";
  if (langClause) parts.push(`${langClause}${starClause}.`);

  if (features.length > 0) {
    const feats = features.slice(0, 4).join(", ");
    parts.push(`Ce qu'il permet : ${feats}.`);
  }

  return parts.join(" ");
}

function formatStars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Heuristic business pitch
// ---------------------------------------------------------------------------

function heuristicPitch(
  repo: { name: string; description: string | null; topics: string; language: string | null; license: string | null },
  score: CommercialScore | null,
  competitors: CompetitorMatch[],
  demandSignals: DemandSignalMatch[],
): string {
  const topics = parseTopics(repo.topics).slice(0, 4);
  const parts: string[] = [];

  const domain = topics[0] ?? repo.language?.toLowerCase() ?? "logiciel";

  if (competitors.length > 0) {
    const top = competitors[0];
    parts.push(
      `En croisant ce dépôt avec le marché, on trouve ${competitors.length} produit(s) proche(s), dont ${top.name}` +
        (top.license ? ` (${top.license})` : "") + `.`,
    );
  } else {
    parts.push(`Ce dépôt évolue dans un créneau où peu de produits commerciaux directs ressortent — un espace à occuper.`);
  }

  if (demandSignals.length > 0) {
    const totalEngagement = demandSignals.reduce((s, d) => s + d.score + d.num_comments, 0);
    parts.push(
      `Les signaux de demande sont réels : ${demandSignals.length} discussion(s) active(s)` +
        (totalEngagement > 100 ? ` avec un fort engagement` : "") +
        ` autour de sujets proches.`,
    );
  } else {
    parts.push(`La demande organique reste encore faible à identifier — il faudrait valider le marché.`);
  }

  if (score && score.score >= 40) {
    parts.push(`Le potentiel commercial est ${score.score >= 70 ? "élevé" : "modéré"} (score ${score.score}/100).`);
  }

  const lic = repo.license?.toLowerCase() ?? "";
  if (/\b(mit|apache|bsd|isc)\b/.test(lic)) {
    parts.push(`Licence permissive (${repo.license}) — vous pouvez construire un produit commercial par-dessus sans contrainte de partage.`);
  } else if (/\b(gpl|agpl)\b/.test(lic)) {
    parts.push(`Attention : licence ${repo.license} — tout produit dérivé devra partager son code. Envisagez une approche SaaS ou un usage interne.`);
  } else if (lic) {
    parts.push(`Licence ${repo.license} — vérifiez les conditions avant de commercialiser.`);
  }

  // Domain-specific idea
  const idea = businessIdeaByDomain(domain, repo.name);
  if (idea) parts.push(idea);

  return parts.join(" ");
}

function businessIdeaByDomain(domain: string, name: string): string | null {
  const d = domain.toLowerCase();
  const templates: Record<string, string> = {
    "machine-learning": `Idée : proposer ${name} comme API d'inférence managée — les équipes paient pour ne pas gérer l'infrastructure GPU.`,
    "react": `Idée : construire un studio de composants/thèmes premium au-dessus de ${name}, en modèle freemium.`,
    "python": `Idée : packager ${name} dans une plateforme no-code où les non-développeurs configurent des workflows.`,
    "rust": `Idée : offrir ${name} comme service binaire haute performance avec un tier gratuit + facturation à l'usage.`,
    "game": `Idée : créer une marketplace d'assets/plugins pour l'écosystème ${name}.`,
    "video": `Idée : lancer un service de traitement vidéo géré (encodage, sous-titres, IA) sur ${name}.`,
    "cli": `Idée : transformer ${name} en produit SaaS avec une UI web pour les équipes non-techniques.`,
    "database": `Idée : proposer ${name} en version cloud managée avec backup + monitoring inclus.`,
    "security": `Idée : bâtir une plateforme d'audit automatisé autour de ${name}, en facturation par scan.`,
    "finance": `Idée : offrir ${name} comme moteur de backtesting/alertes pour traders particuliers.`,
    "music": `Idée : créer une app grand public sur ${name} (génération, collaboration, partage).`,
    "graphics": `Idée : proposer ${name} comme API de rendu/manipulation d'images à la demande.`,
    "docker": `Idée : lancer une plateforme de déploiement simplifié au-dessus de ${name}.`,
    "blockchain": `Idée : bâtir un produit DeFi ou un explorateur payant sur ${name}.`,
    "api": `Idée : créer un gateway/API marketplace monétisant l'accès à ${name}.`,
  };
  return templates[d] ?? null;
}

// ---------------------------------------------------------------------------
// Gemini prompts (used when GEMINI_API_KEY is set)
// ---------------------------------------------------------------------------

function buildGeminiSummaryPrompt(repo: {
  name: string;
  full_name: string;
  description: string | null;
  readme_text: string | null;
  language: string | null;
  stars: number;
}): string {
  const readmeSnippet = (repo.readme_text ?? "").slice(0, 2000);
  return `Tu es un rédacteur produit grand public. Explique ce dépôt GitHub à une personne NON technique, en français, en 2-3 phrases claires et concrètes. Pas de jargon, pas d'emojis, pas de markdown. Commence directement par l'explication.

Dépôt: ${repo.full_name}
Langage: ${repo.language ?? "non précisé"}
Étoiles: ${repo.stars}
Description: ${repo.description ?? "aucune"}
README (extrait):
${readmeSnippet}

Explique en français, grand public, ce que fait ce projet et à qui il sert:`;
}

function buildGeminiPitchPrompt(
  repo: { name: string; full_name: string; description: string | null; topics: string; language: string | null; license: string | null },
  score: CommercialScore | null,
  competitors: CompetitorMatch[],
  demandSignals: DemandSignalMatch[],
): string {
  const topics = parseTopics(repo.topics).slice(0, 6);
  const compList = competitors.slice(0, 3).map((c) => `- ${c.name}: ${c.description ?? "n/a"}`).join("\n");
  const demandList = demandSignals.slice(0, 4).map((d) => `- ${d.title}`).join("\n");
  return `Tu es un analyste business. Propose UNE idée de business concrète et réaliste basée sur ce dépôt open source, en français, en 3-4 phrases. Pas d'emojis, pas de markdown, pas de listes à puces. Sois direct et pragmatique.

Dépôt: ${repo.full_name}
Description: ${repo.description ?? "n/a"}
Sujets: ${topics.join(", ") || "n/a"}
Langage: ${repo.language ?? "n/a"}
Licence: ${repo.license ?? "inconnue"}

Concurrents proches:
${compList || "aucun identifié"}

Signaux de demande:
${demandList || "aucun identifié"}

Score commercial: ${score?.score ?? "n/a"}/100

Propose une idée de business concrète (produit SaaS, API, marketplace, service managé...) en 3-4 phrases maximum:`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function enrichmentAvailable(): boolean {
  return geminiAvailable();
}

export async function generateEnrichment(
  repo: Pick<Repo, "id" | "name" | "full_name" | "description" | "readme_text" | "topics" | "language" | "license" | "stars">,
  context: {
    commercialScore: CommercialScore | null;
    competitors: CompetitorMatch[];
    demandSignals: DemandSignalMatch[];
  },
): Promise<RepoEnrichment> {
  // Always compute heuristic as the baseline (instant, no dependency).
  const hSummary = heuristicSummary(repo);
  const hPitch = heuristicPitch(repo, context.commercialScore, context.competitors, context.demandSignals);

  if (!geminiAvailable()) {
    return { plainSummary: hSummary, businessPitch: hPitch, source: "heuristic" };
  }

  // Gemini path: generate both, but fall back to heuristic on failure.
  const [summary, pitch] = await Promise.all([
    geminiGenerate(buildGeminiSummaryPrompt(repo), 400),
    geminiGenerate(buildGeminiPitchPrompt(repo, context.commercialScore, context.competitors, context.demandSignals), 500),
  ]);

  return {
    plainSummary: summary ?? hSummary,
    businessPitch: pitch ?? hPitch,
    source: summary && pitch ? "gemini" : "heuristic",
  };
}
