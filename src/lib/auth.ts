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
