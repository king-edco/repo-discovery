import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { demandQuota, type DemandSource } from "@/db/schema";

// --- Shared types ---------------------------------------------------------

/** One normalized item returned by any demand-signal source client. */
export type RawDemandItem = {
  source: DemandSource;
  external_id: string;
  niche_keyword: string;
  title: string;
  content: string | null;
  url: string | null;
  score: number;
  num_comments: number;
  created_at: string; // ISO 8601
};

export type SourceClient = {
  source: DemandSource;
  /** Fetch items for a niche keyword. Returns [] (and never throws) on error. */
  fetch(niche: string): Promise<RawDemandItem[]>;
};

// --- Helpers --------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Parse the Currents `published` timestamp. The API returns values like
 * `"2026-08-15 16:10:00 +0000"` (space-separated, non-ISO) which `new Date()`
 * rejects as Invalid Date on V8. Convert to a real ISO string first.
 */
function parseCurrentsDate(s: string): string {
  // "2026-08-15 16:10:00 +0000" -> "2026-08-15T16:10:00+00:00"
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (m) {
    const iso = `${m[1]}T${m[2]}${m[3]}:${m[4]}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // Fallback: try the raw string, then "now".
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// --- Currents quota tracker ----------------------------------------------
// The Currents free tier is strictly capped at 250 requests/day (verified in
// the dashboard — not the 1000/day claimed elsewhere). We stop at a safety
// margin below the hard cap so a burst of parallel requests can't overshoot.

export const CURRENTS_HARD_LIMIT = 250;
export const CURRENTS_SOFT_LIMIT = 230; // stop fetching at this count

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Read the persisted Currents request count for today (UTC). Resets
 * implicitly: if the stored date is not today, the count is treated as 0.
 */
export function currentsQuotaUsed(): number {
  const db = getDb();
  const row = db
    .select()
    .from(demandQuota)
    .where(eq(demandQuota.source, "currents"))
    .get();
  if (!row || row.date !== todayUtc()) return 0;
  return row.count;
}

/** Increment the persisted Currents counter by `n` requests (resets on new day). */
export function currentsQuotaIncrement(n: number): number {
  const db = getDb();
  const today = todayUtc();
  const existing = db
    .select()
    .from(demandQuota)
    .where(eq(demandQuota.source, "currents"))
    .get();
  const next = (existing && existing.date === today ? existing.count : 0) + n;
  const now = new Date().toISOString();
  if (existing) {
    db.update(demandQuota)
      .set({ count: next, date: today, updated_at: now })
      .where(eq(demandQuota.source, "currents"))
      .run();
  } else {
    db.insert(demandQuota)
      .values({ source: "currents", date: today, count: next, updated_at: now })
      .run();
  }
  return next;
}

/** Whether the Currents daily budget still allows more requests. */
export function currentsQuotaAvailable(): boolean {
  return currentsQuotaUsed() < CURRENTS_SOFT_LIMIT;
}

// --- Hacker News (Algolia) — no key, no strict limit ---------------------
// https://hn.algolia.com/api. Search stories by keyword. One request per
// niche; we add a small polite delay between calls.

const HN_BASE = "https://hn.algolia.com/api/v1/search";

class HackerNewsClient implements SourceClient {
  source = "hackernews" as const;
  constructor(private perNiche: number, private delayMs: number) {}

  async fetch(niche: string): Promise<RawDemandItem[]> {
    const params = new URLSearchParams({
      query: niche,
      tags: "story",
      hitsPerPage: String(this.perNiche),
    });
    try {
      const res = await fetch(`${HN_BASE}?${params}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(`[hn] ${res.status} for "${niche}"`);
        return [];
      }
      const data = (await res.json()) as {
        hits?: Array<{
          objectID?: string;
          title?: string | null;
          story_text?: string | null;
          url?: string | null;
          points?: number | null;
          num_comments?: number | null;
          created_at?: string | null;
        }>;
      };
      await sleep(this.delayMs);
      const hits = data.hits ?? [];
      const items: RawDemandItem[] = [];
      for (const h of hits) {
        if (!h.objectID || !h.title) continue;
        const text = stripHtml(h.story_text ?? "");
        items.push({
          source: "hackernews",
          external_id: String(h.objectID),
          niche_keyword: niche,
          title: truncate(h.title.trim(), 500),
          content: text ? truncate(text, 1000) : null,
          url: h.url?.trim() || null,
          score: typeof h.points === "number" ? h.points : 0,
          num_comments: typeof h.num_comments === "number" ? h.num_comments : 0,
          created_at: h.created_at || new Date().toISOString(),
        });
      }
      return items;
    } catch (err) {
      console.warn(`[hn] error for "${niche}":`, (err as Error).message);
      return [];
    }
  }
}

// --- Stack Exchange — free tier, keyless, ~300 req/day soft quota --------
// https://api.stackexchange.com/docs/search. Searches Stack Overflow by
// intitle keyword; we request the body via the `withbody` filter.

const SE_BASE = "https://api.stackexchange.com/2.3/search";

class StackExchangeClient implements SourceClient {
  source = "stackexchange" as const;
  constructor(private perNiche: number, private delayMs: number) {}

  async fetch(niche: string): Promise<RawDemandItem[]> {
    const params = new URLSearchParams({
      pagesize: String(this.perNiche),
      order: "desc",
      sort: "votes",
      intitle: niche,
      site: "stackoverflow",
      filter: "withbody",
    });
    try {
      const res = await fetch(`${SE_BASE}?${params}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(`[se] ${res.status} for "${niche}"`);
        return [];
      }
      const data = (await res.json()) as {
        items?: Array<{
          question_id?: number;
          title?: string;
          body?: string;
          link?: string;
          score?: number;
          answer_count?: number;
          tags?: string[];
          creation_date?: number;
        }>;
      };
      await sleep(this.delayMs);
      const items = data.items ?? [];
      const out: RawDemandItem[] = [];
      for (const q of items) {
        if (!q.question_id || !q.title) continue;
        const text = stripHtml(q.body ?? "");
        out.push({
          source: "stackexchange",
          external_id: String(q.question_id),
          niche_keyword: niche,
          title: truncate(q.title.trim(), 500),
          content: text ? truncate(text, 1000) : null,
          url: q.link?.trim() || null,
          score: typeof q.score === "number" ? q.score : 0,
          num_comments: typeof q.answer_count === "number" ? q.answer_count : 0,
          created_at: q.creation_date
            ? new Date(q.creation_date * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
      return out;
    } catch (err) {
      console.warn(`[se] error for "${niche}":`, (err as Error).message);
      return [];
    }
  }
}

// --- Currents API — key required, 250 req/day hard cap -------------------
// https://currentsapi.services/. `keywords` search. Each call costs 1 request
// against the daily quota; the quota is checked AND persisted before every
// call so multiple script runs in the same day can't overshoot.

const CURRENTS_BASE = "https://api.currentsapi.services/v1/search";

class CurrentsClient implements SourceClient {
  source = "currents" as const;
  constructor(
    private apiKey: string,
    private perNiche: number,
    private delayMs: number,
  ) {}

  /** Whether we may still spend a Currents request this run. */
  private canRequest(): boolean {
    return currentsQuotaAvailable();
  }

  async fetch(niche: string): Promise<RawDemandItem[]> {
    if (!this.canRequest()) {
      console.warn(
        `[currents] daily quota reached (${currentsQuotaUsed()}/${CURRENTS_HARD_LIMIT}), skipping "${niche}"`,
      );
      return [];
    }
    const params = new URLSearchParams({
      keywords: niche,
      language: "en",
      limit: String(this.perNiche),
      apiKey: this.apiKey,
    });
    // Persist the spend BEFORE the network call so a crash mid-flight can't
    // cause an over-count vs. the dashboard.
    const after = currentsQuotaIncrement(1);
    try {
      const res = await fetch(`${CURRENTS_BASE}?${params}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(
          `[currents] ${res.status} for "${niche}" (used ${after}/${CURRENTS_HARD_LIMIT})`,
        );
        return [];
      }
      const data = (await res.json()) as {
        news?: Array<{
          id?: string;
          title?: string;
          description?: string;
          url?: string;
          author?: string;
          published?: string;
        }>;
      };
      await sleep(this.delayMs);
      const news = data.news ?? [];
      const out: RawDemandItem[] = [];
      for (const n of news) {
        if (!n.id || !n.title) continue;
        out.push({
          source: "currents",
          external_id: String(n.id),
          niche_keyword: niche,
          title: truncate(n.title.trim(), 500),
          content: n.description ? truncate(n.description.trim(), 1000) : null,
          url: n.url?.trim() || null,
          score: 0,
          num_comments: 0,
          created_at: n.published
            ? parseCurrentsDate(n.published)
            : new Date().toISOString(),
        });
      }
      return out;
    } catch (err) {
      console.warn(`[currents] error for "${niche}":`, (err as Error).message);
      return [];
    }
  }
}

// --- Factory --------------------------------------------------------------

export type ClientsConfig = {
  hnPerNiche: number;
  sePerNiche: number;
  currentsPerNiche: number;
  delayMs: number;
};

export function buildClients(cfg: ClientsConfig): SourceClient[] {
  const clients: SourceClient[] = [
    new HackerNewsClient(cfg.hnPerNiche, cfg.delayMs),
    new StackExchangeClient(cfg.sePerNiche, cfg.delayMs),
  ];
  const key = process.env.CURRENTS_API_KEY;
  if (key && key.trim()) {
    clients.push(new CurrentsClient(key.trim(), cfg.currentsPerNiche, cfg.delayMs));
  } else {
    console.warn("[currents] CURRENTS_API_KEY not set — skipping Currents source.");
  }
  return clients;
}
