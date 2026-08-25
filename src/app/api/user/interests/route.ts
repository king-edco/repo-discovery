import { getInterests, setInterests } from "@/lib/recommendation";
import { parseJsonBody } from "@/lib/security";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_TOPICS = 50;
const MAX_TOPIC_LEN = 64;

// Interests belong to the signed-in user — the userId always comes from the
// session, never from a client-supplied parameter.

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;
  return Response.json(getInterests(user.id));
}

export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const body = await parseJsonBody(request);
  if (body === null) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: "topics must be an array" }, { status: 400 });
  }
  // Bound what we persist: without caps, arbitrary-length strings and huge
  // arrays would let anyone bloat the database one request at a time.
  const topics = [
    ...new Set(
      body
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase().slice(0, MAX_TOPIC_LEN))
        .filter((t) => t.length > 0),
    ),
  ].slice(0, MAX_TOPICS);
  setInterests(user.id, topics);
  return Response.json({ ok: true, count: topics.length });
}
