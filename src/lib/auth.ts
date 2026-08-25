import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "@/db";
import { schema } from "@/db/schema";

// Better Auth server config. Email/password always on; GitHub/Google OAuth
// are enabled only when their env keys are configured, so the app boots
// cleanly without them (the login page hides the missing providers).
//
// Sessions are persistent: 30-day expiry, refreshed daily on activity, stored
// in an httpOnly cookie by Better Auth. Set BETTER_AUTH_SECRET in production
// (it signs the session cookies) and BETTER_AUTH_URL to the public origin.
//
// Base URL strategy. The app sits behind a reverse proxy (the platform's
// preview hosts, or nginx/Caddy in prod), where the browser's origin differs
// from the request URL Next sees — so a static baseURL alone fails Better
// Auth's CSRF origin check with "Invalid origin".
//
// - BETTER_AUTH_URL set (production): static baseURL, single known origin.
// - Otherwise (local dev, preview hosts): dynamic baseURL — the origin is
//   derived per-request from the Host/x-forwarded-host header and validated
//   against allowedHosts. Loopback hosts are always allowed; extra preview
//   hosts can be added via BETTER_AUTH_ALLOWED_HOSTS (comma-separated,
//   wildcards supported, e.g. "*.prod-runtime.example.com").
// trustedProxyHeaders is enabled because the platform proxy terminates TLS
// and forwards x-forwarded-host/proto; in self-hosted prod this is only
// exploitable if the proxy is misconfigured to forward client-supplied
// headers — a documented deployment requirement.

const staticBaseURL = process.env.BETTER_AUTH_URL;

const extraHosts = (process.env.BETTER_AUTH_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const baseURL = staticBaseURL ?? {
  allowedHosts: ["localhost", "127.0.0.1", "*.prod-runtime.all-hands.dev", ...extraHosts],
  protocol: "auto" as const,
  fallback: "http://localhost:3000",
};

const socialProviders: Record<
  string,
  { clientId: string; clientSecret: string }
> = {};
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
  baseURL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders,
  user: {
    additionalFields: {
      // "free" | "pro". input:false so signup/updates can never set it —
      // only the Stripe webhook (server-side) upgrades a plan.
      plan: {
        type: "string",
        required: false,
        defaultValue: "free",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh at most once a day
  },
  advanced: {
    // Trust x-forwarded-host/proto from the platform proxy (see note above).
    trustedProxyHeaders: true,
  },
  // Built-in rate limiting (in-memory). Sign-in/up are credential-attack
  // surfaces, so they're capped tighter than the default bucket.
  rateLimit: {
    enabled: true,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

/** OAuth providers with both env keys configured — drives the login UI. */
export function configuredOAuthProviders(): Array<"github" | "google"> {
  const out: Array<"github" | "google"> = [];
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) out.push("github");
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) out.push("google");
  return out;
}
