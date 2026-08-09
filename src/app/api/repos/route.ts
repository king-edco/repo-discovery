import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const allRepos = db
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
    .orderBy(desc(repos.stars))
    .all();
  return Response.json(allRepos);
}
