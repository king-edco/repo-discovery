import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_LIST = 50;

// GET /api/notifications — latest notifications + unread count for the
// signed-in user. POST { id? } — mark one (or all) as read.

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;

  const db = getDb();
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(MAX_LIST);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));

  return Response.json({ notifications: items, unread: count });
}

export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body = mark all read
  }
  const id = (body as { id?: unknown }).id;
  const db = getDb();
  if (typeof id === "number" && Number.isInteger(id) && id > 0) {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
  } else {
    await db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.userId, user.id));
  }
  return Response.json({ ok: true });
}
