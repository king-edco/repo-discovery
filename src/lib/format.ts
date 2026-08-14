// Display helpers shared by the feed cards and the repo detail page.

/**
 * GitHub language -> brand color. Source: github/linguist's colors. We keep a
 * curated subset (the languages most likely to appear in a top-repos dataset);
 * unknown languages fall back to a neutral gray.
 */
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Scala: "#c22d40",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Elixir: "#6e4a7e",
  Lua: "#000080",
  Clojure: "#db5855",
  Haskell: "#5e5086",
  R: "#198CE7",
  Perl: "#0298c3",
  "Jupyter Notebook": "#DA5B0B",
  ObjectiveC: "#438eff",
  "Objective-C++": "#6866fb",
  Assembly: "#6E4C13",
  Zig: "#ec915c",
  Nim: "#ffc200",
  OCaml: "#3be133",
  Solidity: "#AA6746",
  "Vim Script": "#199f4b",
  Makefile: "#427819",
  Dockerfile: "#384d54",
  Markdown: "#083fa1",
  TeX: "#3D6117",
  Astro: "#ff5a03",
  MDX: "#fcb32c",
};

export function langColor(lang: string | null | undefined): string {
  if (!lang) return "#8b949e";
  return LANG_COLORS[lang] ?? "#8b949e";
}

/** 1234 -> "1.2k", 1234567 -> "1.2M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Parse the JSON-stringified topics column into a string array. */
export function parseTopics(topics: string | null | undefined): string[] {
  if (!topics) return [];
  try {
    const parsed = JSON.parse(topics);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Strip markdown syntax down to plain text for a short preview. This is a
 * pragmatic, line-based cleanup — good enough for a 150-char excerpt, not a
 * full markdown parser.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> label
    .replace(/<[^>]+>/g, " ") // raw HTML tags
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s{0,3}>\s?/gm, "") // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // bullet lists
    .replace(/^\s{0,3}\d+\.\s+/gm, "") // numbered lists
    .replace(/^\s{0,3}[-+*]\s*$/gm, "") // thematic breaks
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // emphasis
    .replace(/\|/g, " ") // table pipes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the preview description for a card. Prefers the repo `description`;
 * otherwise falls back to a 150-char excerpt of the cleaned README.
 */
export function previewDescription(
  description: string | null | undefined,
  readme: string | null | undefined,
  maxLen = 150,
): string {
  if (description && description.trim()) return description.trim();
  if (!readme) return "";
  const cleaned = stripMarkdown(readme);
  if (!cleaned) return "";
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen).trimEnd()}…` : cleaned;
}

/**
 * Preview image URL for a repo. Routes through our `/api/og` proxy, which trims
 * the white padding GitHub's OpenGraph mirror renders around the card so the
 * feed can display a true edge-to-edge image. The `full_name` is encoded as a
 * path segment so the browser/CDN can cache the response per-repo.
 */
export function previewImage(fullName: string): string {
  const parts = fullName.split("/").filter(Boolean);
  return `/api/og/${parts.map(encodeURIComponent).join("/")}`;
}
