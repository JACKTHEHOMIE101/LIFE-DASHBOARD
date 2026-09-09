import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userSettings } from "@/db/schema";
import { readSession } from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  settings: typeof userSettings.$inferSelect;
};

/**
 * Deduped per request: a page and all of its server components resolve the
 * session once, not once per component that happens to need the user.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession();
  if (!session) return null;

  const rows = await db
    .select()
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.id, session.userId))
    .limit(1);

  const row = rows[0];
  if (!row || row.users.deletedAt) return null;

  // A user row can predate its settings row if signup was interrupted.
  const settings =
    row.user_settings ??
    (await db.insert(userSettings).values({ userId: row.users.id }).returning())[0];

  return {
    id: row.users.id,
    email: row.users.email,
    name: row.users.name,
    timezone: row.users.timezone,
    settings,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function hasAnyUser(): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}
