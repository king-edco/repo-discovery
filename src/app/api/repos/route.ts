import { desc, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";

export const dynamic = "force-dynamic";

function parseMinStars(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export async function GET(request: Request) {
  const minStars = parseMinStars(new URL(request.url).searchParams.get("minStars"));
  const db = getDb();
  const query = db
    .select({
      id: repos.id,
      name: repos.name,
      full_name: repos.full_name,
      description: repos.description,
      url: repos.url,
      stars: repos.stars,
      language: repos.language,
      license: repos.license,
      readme_text: repos.readme_text,
      topics: repos.topics,
      pushed_at: repos.pushed_at,
      ingested_at: repos.ingested_at,
    })
    .from(repos)
    .orderBy(desc(repos.stars));

  const allRepos = minStars !== null ? query.where(gte(repos.stars, minStars)).all() : query.all();
  return Response.json(allRepos);
}
