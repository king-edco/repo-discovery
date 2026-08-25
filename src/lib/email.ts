// Transactional email via the Resend REST API (plain fetch — no SDK needed).
// No-op (returns false) when RESEND_API_KEY is not configured, so the app
// works without email in dev. Set EMAIL_FROM to a verified sender, e.g.
// "Foundry <noreply@yourdomain.com>".

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[email] resend HTTP ${res.status}:`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[email] send failed:", (err as Error).message);
    return false;
  }
}

/** Owner inbox for user feedback. Configure via FEEDBACK_INBOX_EMAIL. */
export function feedbackInbox(): string | null {
  return process.env.FEEDBACK_INBOX_EMAIL ?? null;
}
