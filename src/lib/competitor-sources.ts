// --- Commercial competitor data sources -----------------------------------
//
// The competitor corpus is pulled from Wikidata via its public SPARQL
// endpoint (https://query.wikidata.org/sparql). Wikidata is the right primary
// source for production scale because:
//
//   - Free, no API key, no per-key daily cap (unlike Currents' 250/day). The
//     only ask is a descriptive User-Agent and polite query volume.
//   - Structured: each software entity ships with a license (P275), official
//     website (P856), programming language (P277), and a class (P31) we use as
//     a category label. The license feeds the commercial-score weight directly.
//   - Stable Q-id dedup keys (no brittle HTML scraping, no Cloudflare).
//   - Bulk: one paginated query pulls thousands of products.
//
// AlternativeTo was evaluated as a secondary source for its "X is an
// alternative to Y" graph, but its pages are Cloudflare-protected and
// client-side rendered, so a static (Cheerio) crawler extracts nothing and a
// headless crawler is slow + block-prone — the opposite of the scalability
// the project needs. See AGENTS.md "Scalability roadmap" for the full note.

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "FoundryRepoDiscovery/0.1 (open-source repo/market analysis; https://github.com/king-edco/repo-discovery)";

/** One normalized competitor product returned by the Wikidata source. */
export type RawCompetitor = {
  id: string; // Wikidata Q-id, e.g. "Q305936"
  name: string;
  description: string | null;
  category: string | null; // label of the instance-of class
  source_url: string; // https://www.wikidata.org/wiki/Q...
  website: string | null;
  license: string | null;
  language: string | null;
};

// Wikidata classes whose instances are software products we want as
// competitors. We query each class with a DIRECT P31 (no P279* recursion —
// the recursive property path times out the public endpoint). The list is
// deliberately broad so the embedding corpus covers dev tools, media, office,
// security, games, etc., giving any repo a meaningful competitor neighbour.
//
// Q-ids verified against https://www.wikidata.org. Labels are pulled at query
// time via the label service so they stay in the user's language.
export const WIKIDATA_SOFTWARE_CLASSES: { qid: string; label: string }[] = [
  { qid: "Q7397", label: "software" },
  { qid: "Q13741", label: "computer program" },
  { qid: "Q163362", label: "video game" },
  { qid: "Q1668024", label: "video game engine" },
  { qid: "Q847050", label: "application software" },
  { qid: "Q847069", label: "free software" },
  { qid: "Q341", label: "free and open-source software" },
  { qid: "Q506883", label: "open-source software" },
  { qid: "Q7058670", label: "office suite" },
  { qid: "Q5355320", label: "email client" },
  { qid: "Q72435", label: "web browser" },
  { qid: "Q15614026", label: "image editing software" },
  { qid: "Q130318", label: "media player" },
  { qid: "Q312466", label: "content management system" },
  { qid: "Q270941", label: "chat application" }, // instant messaging client
  { qid: "Q498724", label: "integrated development environment" }, // Q1371470 is IDE; keep alias
  { qid: "Q1371470", label: "integrated development environment" },
  { qid: "Q2113", label: "text editor" },
  { qid: "Q845754", label: "database management system" },
  { qid: "Q176165", label: "database" },
  { qid: "Q131093", label: "operating system" },
  { qid: "Q4117139", label: "productivity software" },
  { qid: "Q1969854", label: "accounting software" },
  { qid: "Q75765", label: "spreadsheet" },
  { qid: "Q9350491", label: "project management software" },
  { qid: "Q677270", label: "vector graphics editor" },
  { qid: "Q188860", label: "raster graphics editor" },
  { qid: "Q1063385", label: "3D modeling software" }, // Q165194 check; keep broad
  { qid: "Q165194", label: "3D modeling software" },
  { qid: "Q2293692", label: "game engine" },
  { qid: "Q166142", label: "application" },
  { qid: "Q350389", label: "web framework" },
  { qid: "Q518528", label: "mobile app" },
  { qid: "Q168411", label: "screen reader" }, // assistive software
  { qid: "Q80753", label: "antivirus software" },
  { qid: "Q1155245", label: "backup software" },
  { qid: "Q1141491", label: "firewall software" },
  { qid: "Q1969892", label: "remote desktop software" },
  { qid: "Q764090", label: "note-taking software" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build the SPARQL query for one software class, returning up to `limit`
// products with an English description. A direct P31 (no recursion) keeps the
// query fast enough for the public endpoint. Optional license/website/language
// are pulled so the caller can store them without a second round-trip.
 */
function buildClassQuery(classQid: string, limit: number): string {
  return `
SELECT DISTINCT ?item ?itemLabel ?desc ?classLabel ?website ?licenseLabel ?langLabel WHERE {
  ?item wdt:P31 wd:${classQid}.
  ?item rdfs:label ?itemLabel.
  FILTER(LANG(?itemLabel) = "en")
  ?item schema:description ?desc.
  FILTER(LANG(?desc) = "en")
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P275 ?license. }
  OPTIONAL { ?item wdt:P277 ?lang. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}
`;
}

type SparqlBindings = {
  results: { bindings: Record<string, { value: string }>[] };
};

async function runQuery(query: string): Promise<SparqlBindings> {
  // POST the query: long SELECT URLs hit URL-length limits / 000 errors on GET.
  const res = await fetch(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ query }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wikidata SPARQL ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as SparqlBindings;
}

function qidFromUri(uri: string): string | null {
  // http://www.wikidata.org/entity/Q305936 -> Q305936
  const m = uri.match(/\/(Q\d+)$/);
  return m ? m[1] : null;
}

/**
 * Crawl competitor products from Wikidata for the configured software classes.
 * Yields each class's products, sleeping `delayMs` between classes to be polite
 * to the shared public endpoint. A class whose query fails is logged and
 * skipped (never throws) so one bad class can't abort the whole crawl.
 */
export async function* crawlWikidataCompetitors(
  opts: { perClassLimit?: number; delayMs?: number } = {},
): AsyncGenerator<RawCompetitor[]> {
  const perClassLimit = opts.perClassLimit ?? 400;
  const delayMs = opts.delayMs ?? 1500;
  for (const cls of WIKIDATA_SOFTWARE_CLASSES) {
    const query = buildClassQuery(cls.qid, perClassLimit);
    try {
      const data = await runQuery(query);
      const seen = new Set<string>();
      const products: RawCompetitor[] = [];
      for (const b of data.results.bindings) {
        const id = qidFromUri(b.item?.value ?? "");
        if (!id || seen.has(id)) continue;
        const name = b.itemLabel?.value?.trim();
        if (!name) continue;
        seen.add(id);
        products.push({
          id,
          name,
          description: b.desc?.value?.trim() || null,
          category: b.classLabel?.value?.trim() || cls.label,
          source_url: `https://www.wikidata.org/wiki/${id}`,
          website: b.website?.value?.trim() || null,
          license: b.licenseLabel?.value?.trim() || null,
          language: b.langLabel?.value?.trim() || null,
        });
      }
      yield products;
    } catch (err) {
      console.warn(
        `[competitors] Wikidata class ${cls.qid} (${cls.label}) failed:`,
        (err as Error).message,
      );
      yield [];
    }
    await sleep(delayMs);
  }
}
