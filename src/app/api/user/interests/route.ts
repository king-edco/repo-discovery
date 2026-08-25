import { getInterests, setInterests } from "@/lib/recommendation";
import { isValidUserId, parseJsonBody } from "@/lib/security";

export const dynamic = "force-dynamic";

const MAX_TOPICS = 50;
const MAX_TOPIC_LEN = 64;

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!isValidUserId(userId)) {
    return Response.json({ error: "valid userId required" }, { status: 400 });
  }
  return Response.json(getInterests(userId));
}

export async function POST(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!isValidUserId(userId)) {
    return Response.json({ error: "valid userId required" }, { status: 400 });
  }
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
  setInterests(userId, topics);
  return Response.json({ ok: true, count: topics.length });
}
