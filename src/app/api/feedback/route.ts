import { parseJsonBody } from "@/lib/security";
import { requireUser } from "@/lib/session";
import { emailConfigured, feedbackInbox, sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LEN = 2000;

// POST /api/feedback — general product feedback, forwarded to the owner inbox
// (FEEDBACK_INBOX_EMAIL) via Resend. Requires auth so the email carries a
// real sender identity and can't be used as an anonymous spam relay.

export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  const body = (await parseJsonBody(request)) as { message?: unknown } | null;
  if (body === null) {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : "";
  if (message.length < 3) {
    return Response.json({ error: "message required (min 3 chars)" }, { status: 400 });
  }

  const inbox = feedbackInbox();
  if (!inbox || !emailConfigured()) {
    return Response.json({ error: "Feedback inbox is not configured." }, { status: 503 });
  }

  const sent = await sendEmail({
    to: inbox,
    subject: `[Foundry] Product feedback from ${user.name}`,
    text: `From: ${user.name} <${user.email}> (${user.id})\n\n${message}`,
  });
  if (!sent) {
    return Response.json({ error: "Could not send feedback right now." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
