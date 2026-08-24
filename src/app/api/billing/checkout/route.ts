import Stripe from "stripe";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// POST /api/billing/checkout — create a Stripe Checkout session for the Pro
// plan ($10/mo) and return its URL. The client redirects there; Stripe calls
// /api/billing/webhook on payment, which flips user.plan to "pro".
// Returns 503 when Stripe isn't configured so the UI can show "coming soon".

function appUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  const key = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!key || !priceId) {
    return Response.json(
      { error: "Billing is not configured yet." },
      { status: 503 },
    );
  }

  const stripe = new Stripe(key);
  const base = appUrl(request);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    // The webhook uses this to find the user to upgrade.
    metadata: { userId: user.id },
    customer_email: user.email,
    success_url: `${base}/settings?upgraded=1`,
    cancel_url: `${base}/settings?upgrade=cancelled`,
  });

  return Response.json({ url: session.url });
}
