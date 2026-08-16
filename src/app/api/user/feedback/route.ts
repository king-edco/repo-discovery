import { getFeedback, setFeedback, removeFeedback } from "@/lib/recommendation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  return Response.json(getFeedback(userId));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    userId: string;
    repoId: string;
    feedback: "like" | "dislike";
    reason?: string;
  };
  if (!body.userId || !body.repoId || !body.feedback) {
    return Response.json({ error: "userId, repoId, feedback required" }, { status: 400 });
  }
  setFeedback(body.userId, body.repoId, body.feedback, body.reason);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const sp = new URL(request.url).searchParams;
  const userId = sp.get("userId");
  const repoId = sp.get("repoId");
  if (!userId || !repoId) return Response.json({ error: "userId, repoId required" }, { status: 400 });
  removeFeedback(userId, repoId);
  return Response.json({ ok: true });
}
