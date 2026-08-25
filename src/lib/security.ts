// Shared security helpers for API routes and components.

/**
 * Return `url` only if it is an absolute http(s) URL, else null. External
 * data (HN/StackExchange/Currents/Wikidata/GitHub) is rendered into `href`s;
 * without this check a `javascript:` or `data:` URL in a source record would
 * execute in the user's browser on click.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Anonymous user ids are `u_<uuid>`; accept that plus short opaque ids. */
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidUserId(userId: string | null | undefined): userId is string {
  return typeof userId === "string" && USER_ID_RE.test(userId);
}

/** Repo ids are GitHub numeric ids stored as strings; demand/competitor ids
 *  are namespaced ("hackernews:123", "Q305936"). Cap length defensively. */
export function isValidEntityId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 128;
}

/** Parse a JSON request body, returning null on malformed input instead of
 *  throwing (which would surface as an unhandled 500). */
export async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Guard for privileged operations (e.g. forcing AI enrichment regeneration,
 * which spends paid Gemini quota). The operation is allowed only when the
 * server has ENRICHMENT_ADMIN_KEY configured AND the request carries the
 * matching `x-admin-key` header. When the env var is unset the operation is
 * always denied — a key you never set cannot be guessed.
 */
export function isAdminRequest(request: Request): boolean {
  const key = process.env.ENRICHMENT_ADMIN_KEY;
  if (!key) return false;
  const provided = request.headers.get("x-admin-key");
  // Constant-time-ish comparison without leaking length via early exit timing.
  if (!provided || provided.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) {
    diff |= provided.charCodeAt(i) ^ key.charCodeAt(i);
  }
  return diff === 0;
}
