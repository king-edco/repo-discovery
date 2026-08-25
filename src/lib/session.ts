import { headers } from "next/headers";
import { auth, type Session } from "@/lib/auth";

export type SessionUser = Session["user"] & { plan?: string };

/** Current session (user + session) or null. Server-side only. */
export async function getSession(): Promise<Session | null> {
  return auth.api.getSession({ headers: await headers() });
}

/** Current user or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const s = await getSession();
  return (s?.user as SessionUser | undefined) ?? null;
}

export function isPro(user: { plan?: string } | null | undefined): boolean {
  return user?.plan === "pro";
}

/**
 * Standard API guard. Returns the user, or a 401/403 Response to send back.
 * Usage:
 *   const { user, error } = await requireUser({ pro: true });
 *   if (error) return error;
 */
export async function requireUser(opts: { pro?: boolean } = {}): Promise<
  { user: SessionUser; error: null } | { user: null; error: Response }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      user: null,
      error: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  if (opts.pro && !isPro(user)) {
    return {
      user: null,
      error: Response.json(
        { error: "This feature requires the Pro plan.", upgrade: true },
        { status: 403 },
      ),
    };
  }
  return { user, error: null };
}
