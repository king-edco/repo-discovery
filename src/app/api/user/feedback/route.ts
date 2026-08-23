import { getFeedback, setFeedback, removeFeedback } from "@/lib/recommendation";
import { isValidEntityId, isValidUserId, parseJsonBody } from "@/lib/security";

export const dynamic = "force-dynamic";

const MAX_REASON_LEN = 280;

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("userId");
  if (!isValidUserId(userId)) {
    return Response.json({ error: "valid userId required" }, { status: 400 });
  }
  return Response.json(getFeedback(userId));
}

export async function POST(request: Request) {
  const body = (await parseJsonBody(request)) as {
    userId?: unknown;
    repoId?: unknown;
    feedback?: unknown;
    reason?: unknown;
  } | null;
  if (body === null) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId : null;
  const repoId = typeof body.repoId === "string" ? body.repoId : null;
  const feedback = body.feedback;
  if (
    !isValidUserId(userId) ||
    !isValidEntityId(repoId) ||
    (feedback !== "like" && feedback !== "dislike")
  ) {
    return Response.json(
      { error: "valid userId, repoId and feedback ('like' | 'dislike') required" },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON_LEN) : undefined;
  setFeedback(userId, repoId, feedback, reason);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const sp = new URL(request.url).searchParams;
  const userId = sp.get("userId");
  const repoId = sp.get("repoId");
  if (!isValidUserId(userId) || !isValidEntityId(repoId)) {
    return Response.json({ error: "valid userId, repoId required" }, { status: 400 });
  }
  removeFeedback(userId, repoId);
  return Response.json({ ok: true });
}
