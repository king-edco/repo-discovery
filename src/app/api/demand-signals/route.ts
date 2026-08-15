import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { demandSignals, DEMAND_SOURCES } from "@/db/schema";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Optional source filter.
  const source = searchParams.get("source")?.trim().toLowerCase() || null;
  const conditions: SQL[] = [];
  if (source) {
    if (!DEMAND_SOURCES.includes(source as (typeof DEMAND_SOURCES)[number])) {
      return Response.json(
        {
          error: `Invalid 'source'. Must be one of: ${DEMAND_SOURCES.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    conditions.push(eq(demandSignals.source, source));
  }

  // Pagination (1-indexed page).
  const pageRaw = Number(searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const sizeRaw = Number(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE));
  const pageSize =
    Number.isFinite(sizeRaw) && sizeRaw >= 1
      ? Math.min(Math.floor(sizeRaw), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  const db = getDb();
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = db
    .select({
      id: demandSignals.id,
      source: demandSignals.source,
      external_id: demandSignals.external_id,
      niche_keyword: demandSignals.niche_keyword,
      title: demandSignals.title,
      content: demandSignals.content,
      url: demandSignals.url,
      score: demandSignals.score,
      num_comments: demandSignals.num_comments,
      created_at: demandSignals.created_at,
      ingested_at: demandSignals.ingested_at,
      // embedding deliberately excluded to keep the payload small.
    })
    .from(demandSignals)
    .where(where)
    .orderBy(desc(demandSignals.created_at))
    .limit(pageSize)
    .offset(offset)
    .all();

  const totalRow = db
    .select({ total: count() })
    .from(demandSignals)
    .where(where)
    .get();
  const total = totalRow?.total ?? 0;

  return Response.json({
    page,
    pageSize,
    total,
    results: rows,
  });
}
