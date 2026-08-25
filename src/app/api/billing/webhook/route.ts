import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/schema";

export const dynamic = "force-dynamic";

// POST /api/billing/webhook — Stripe event sink. Verifies the signature with
// STRIPE_WEBHOOK_SECRET, then flips the plan on subscription lifecycle events.
// The plan is ONLY ever mutated here (server-side, signature-verified); the
// Better Auth `plan` field has input:false so no client call can set it.

async function setPlan(userId: string, plan: "free" | "pro"): Promise<void> {
  const db = getDb();
  await db.update(user).set({ plan }).where(eq(user.id, userId));
}

export async function POST(request: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !webhookSecret) {
    return Response.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const stripe = new Stripe(key);
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.userId;
      if (userId) await setPlan(userId, "pro");
      break;
    }
    case "customer.subscription.deleted": {
      // Subscription ended: find the user via the checkout metadata stored on
      // the subscription's customer email lookup is unreliable, so we stored
      // userId in the checkout metadata; Stripe copies it to the subscription
      // only if configured — fall back to scanning by email.
      const sub = event.data.object as Stripe.Subscription;
      const userId = (sub.metadata?.userId as string | undefined) ?? null;
      if (userId) {
        await setPlan(userId, "free");
      } else if (typeof sub.customer === "string") {
        const customer = await stripe.customers.retrieve(sub.customer);
        if (!customer.deleted && customer.email) {
          const db = getDb();
          await db.update(user).set({ plan: "free" }).where(eq(user.email, customer.email));
        }
      }
      break;
    }
    default:
      break;
  }

  return Response.json({ received: true });
}
