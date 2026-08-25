import { getFeedback, setFeedback, removeFeedback } from "@/lib/recommendation";
import { isValidEntityId, parseJsonBody } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { feedbackInbox, sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const MAX_REASON_LEN = 280;

// Feedback belongs to the signed-in user — the userId always comes from the
// session. Reasons are also forwarded to the owner inbox (FEEDBACK_INBOX_EMAIL)
// when email is configured.

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;
  return Response.json(getFeedback(user.id));
}

export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const body = (await parseJsonBody(request)) as {
    repoId?: unknown;
    feedback?: unknown;
    reason?: unknown;
  } | null;
  if (body === null) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const repoId = typeof body.repoId === "string" ? body.repoId : null;
  const feedback = body.feedback;
  if (
    !isValidEntityId(repoId) ||
    (feedback !== "like" && feedback !== "dislike")
  ) {
    return Response.json(
      { error: "valid repoId and feedback ('like' | 'dislike') required" },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON_LEN) : undefined;
  setFeedback(user.id, repoId, feedback, reason);

  // Forward written feedback to the product owner. Fire-and-forget: email
  // failures must not fail the request.
  if (reason) {
    const inbox = feedbackInbox();
    if (inbox) {
      void sendEmail({
        to: inbox,
        subject: `[Foundry] User feedback (${feedback}) on repo ${repoId}`,
        text: `User: ${user.name} <${user.email}> (${user.id})\nRepo: ${repoId}\nFeedback: ${feedback}\n\n${reason}`,
      });
    }
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;
  const repoId = new URL(request.url).searchParams.get("repoId");
  if (!isValidEntityId(repoId)) {
    return Response.json({ error: "valid repoId required" }, { status: 400 });
  }
  removeFeedback(user.id, repoId);
  return Response.json({ ok: true });
}
