import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { repos } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const allRepos = db.select().from(repos).orderBy(desc(repos.stars)).all();
  return Response.json(allRepos);
}
