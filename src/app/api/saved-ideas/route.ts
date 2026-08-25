import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { repos, savedIdeas } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { isValidEntityId, parseJsonBody } from "@/lib/security";

export const dynamic = "force-dynamic";

const MAX_SAVED = 500;
const MAX_NOTE_LEN = 280;

// Saved ideas (bookmarks). GET lists the user's saved repos (joined with the
// repo rows), POST { repoId, note? } saves, DELETE ?repoId= removes.

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;

  const db = getDb();
  const saved = await db
    .select()
    .from(savedIdeas)
    .where(eq(savedIdeas.userId, user.id))
    .orderBy(desc(savedIdeas.createdAt))
    .limit(MAX_SAVED);

  const repoIds = saved.map((s) => s.repoId);
  const rows =
    repoIds.length === 0
      ? []
      : await db.select().from(repos).where(inArray(repos.id, repoIds));
  const byId = new Map(rows.map((r) => [r.id, r]));

  return Response.json({
    ideas: saved
      .map((s) => ({
        repoId: s.repoId,
        note: s.note,
        savedAt: s.createdAt,
        repo: byId.get(s.repoId) ?? null,
      }))
      .filter((s) => s.repo !== null),
  });
}

export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  const body = (await parseJsonBody(request)) as {
    repoId?: unknown;
    note?: unknown;
  } | null;
  if (body === null) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const repoId = typeof body.repoId === "string" ? body.repoId : null;
  if (!isValidEntityId(repoId)) {
    return Response.json({ error: "valid repoId required" }, { status: 400 });
  }

  const db = getDb();
  const existing = await db
    .select({ id: savedIdeas.id })
    .from(savedIdeas)
    .where(and(eq(savedIdeas.userId, user.id), eq(savedIdeas.repoId, repoId)))
    .limit(1);
  if (existing.length > 0) return Response.json({ ok: true, alreadySaved: true });

  // Cap per-user saves so a single account can't bloat the table.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(savedIdeas)
    .where(eq(savedIdeas.userId, user.id));
  if (count >= MAX_SAVED) {
    return Response.json(
      { error: `Saved ideas limit reached (${MAX_SAVED}).` },
      { status: 400 },
    );
  }

  const note =
    typeof body.note === "string" ? body.note.slice(0, MAX_NOTE_LEN) : undefined;
  await db.insert(savedIdeas).values({ userId: user.id, repoId, note });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  const repoId = new URL(request.url).searchParams.get("repoId");
  if (!isValidEntityId(repoId)) {
    return Response.json({ error: "valid repoId required" }, { status: 400 });
  }
  const db = getDb();
  await db
    .delete(savedIdeas)
    .where(and(eq(savedIdeas.userId, user.id), eq(savedIdeas.repoId, repoId)));
  return Response.json({ ok: true });
}
