// Next.js instrumentation hook — runs once when the server process boots.
// Starts the internal ingestion scheduler on the Node runtime (not edge).
// Belt-and-braces: scheduler.ts also self-starts idempotently from the DB
// init path (getDb) in case the hook doesn't fire on `next start`.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
