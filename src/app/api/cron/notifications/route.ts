import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { userSettings } from "@/db/schema";
import { deliverDueNotifications } from "@/lib/notifications/engine";
import { generateNotifications } from "@/lib/notifications/generators";

/**
 * The scheduler.
 *
 * Everything in the notification system is idempotent, so this can be called as
 * often as you like: generation upserts by dedupe key and delivery only touches
 * rows that are due, undelivered and not snoozed. Running it every fifteen
 * minutes is what turns the notification centre from a list you have to
 * remember to open into something that actually reaches your phone.
 *
 * Protected by a shared secret rather than a session, because the caller is a
 * cron job with no user. Without CRON_SECRET set the route refuses to run at
 * all — an open endpoint that writes notifications is not something to leave
 * lying around by accident.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 },
    );
  }

  // Vercel Cron sends the secret as a bearer token.
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  const started = Date.now();
  const rows = await db
    .select({ id: users.id, weekStartsOn: userSettings.weekStartsOn })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(isNull(users.deletedAt));

  const results: { userId: string; created: number; delivered: number; suppressed: number }[] = [];

  for (const user of rows) {
    try {
      const { created } = await generateNotifications(user.id, user.weekStartsOn ?? 1);
      const { delivered, suppressed } = await deliverDueNotifications(user.id);
      results.push({ userId: user.id, created, delivered, suppressed });
    } catch (error) {
      // One user failing must not stop the rest, and the run must still report.
      results.push({ userId: user.id, created: 0, delivered: 0, suppressed: 0 });
      console.error(`notification run failed for ${user.id}`, error);
    }
  }

  return Response.json({
    ok: true,
    users: results.length,
    created: results.reduce((n, r) => n + r.created, 0),
    delivered: results.reduce((n, r) => n + r.delivered, 0),
    suppressedByQuietHours: results.reduce((n, r) => n + r.suppressed, 0),
    ms: Date.now() - started,
  });
}

export const dynamic = "force-dynamic";
