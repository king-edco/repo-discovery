// Notification digest: for every signed-up user with interests, create an
// in-app notification listing the newest repos matching their interests.
// Idempotent per day — re-running the same day does not create duplicates
// (the body is compared against today's digests).
//
// Run manually (`pnpm notify-digest`) or on a cron (e.g. daily). No external
// services required — notifications live in the `notifications` table and
// show up in the bell.

import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { notifications, repos, user, userInterests } from "../db/schema";

const MAX_REPOS_PER_DIGEST = 5;
const RECENT_DAYS = 7;

function main() {
  const db = getDb();

  const users = db.select({ id: user.id }).from(user).all();
  let created = 0;

  const since = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  for (const u of users) {
    const interests = db
      .select({ topic: userInterests.topic })
      .from(userInterests)
      .where(eq(userInterests.user_id, u.id))
      .all()
      .map((r) => r.topic);
    if (interests.length === 0) continue;

    // Recent repos whose topics JSON contains any interest. The topics column
    // is a JSON string, so a LIKE on the quoted topic is a pragmatic match
    // (same trick used by the recommendation engine's interestMatch).
    const matches = db
      .select({ id: repos.id, fullName: repos.full_name })
      .from(repos)
      .where(
        sql`${repos.ingested_at} >= ${since} AND (${sql.join(
          interests.map(
            (t) => sql`${repos.topics} LIKE ${'%"' + t.replace(/"/g, "") + '"%'}`,
          ),
          sql` OR `,
        )})`,
      )
      .orderBy(desc(repos.ingested_at))
      .limit(MAX_REPOS_PER_DIGEST)
      .all();
    if (matches.length === 0) continue;

    const body = matches.map((m) => m.fullName).join(", ");

    // Skip if an identical digest was already created today.
    const existing = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        sql`${notifications.userId} = ${u.id} AND ${notifications.type} = 'digest' AND ${notifications.body} = ${body} AND ${notifications.createdAt} >= ${today}`,
      )
      .get();
    if (existing) continue;

    db.insert(notifications)
      .values({
        userId: u.id,
        type: "digest",
        title: `${matches.length} new repo${matches.length > 1 ? "s" : ""} match your interests`,
        body,
        repoId: matches[0].id,
      })
      .run();
    created++;
  }

  console.log(`notify-digest: ${created} notification(s) created for ${users.length} user(s).`);
}

main();
