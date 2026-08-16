import { getInterests, setInterests } from "@/lib/recommendation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  return Response.json(getInterests(userId));
}

export async function POST(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  const topics = (await request.json()) as string[];
  if (!Array.isArray(topics)) return Response.json({ error: "topics must be an array" }, { status: 400 });
  setInterests(userId, topics);
  return Response.json({ ok: true, count: topics.length });
}
