"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { users, userSettings, timeBudgets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { clearSessionCookie } from "@/lib/auth/session";
import { clearDemoData, seedDemoData } from "@/lib/demo/seed-demo";
import { audit } from "./activity";

export type SettingsState = { ok?: boolean; error?: string };

const profileSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(80),
  timezone: z.string().trim().max(60),
  theme: z.enum(["light", "dark", "system"]),
  weekStartsOn: z.coerce.number().int().min(0).max(1),
});

export async function updateProfile(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") ?? "UTC",
    theme: formData.get("theme") ?? "system",
    weekStartsOn: formData.get("weekStartsOn") ?? 1,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  await db
    .update(users)
    .set({ name: parsed.data.name, timezone: parsed.data.timezone })
    .where(eq(users.id, user.id));

  await db
    .update(userSettings)
    .set({ theme: parsed.data.theme, weekStartsOn: parsed.data.weekStartsOn })
    .where(eq(userSettings.userId, user.id));

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}

/** Weekly time intentions, used by the intended-versus-actual analytics. */
export async function updateTimeBudgets(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const categories = ["deep_work", "meetings", "health", "relationships", "personal_growth"];

  for (const category of categories) {
    const hours = Number(formData.get(`budget_${category}`) ?? 0);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) continue;
    await db
      .insert(timeBudgets)
      .values({ userId: user.id, category, intendedMinutesPerWeek: Math.round(hours * 60) })
      .onConflictDoUpdate({
        target: [timeBudgets.userId, timeBudgets.category],
        set: { intendedMinutesPerWeek: Math.round(hours * 60) },
      });
  }

  revalidatePath("/settings");
  revalidatePath("/analytics");
  return { ok: true };
}

export async function loadDemoData() {
  const user = await requireUser();
  await clearDemoData(db, user.id);
  await seedDemoData(db, user.id);
  await audit(user.id, "demo.load", { actor: "user" });
  revalidatePath("/", "layout");
}

export async function removeDemoData() {
  const user = await requireUser();
  await clearDemoData(db, user.id);
  await audit(user.id, "demo.clear", { actor: "user" });
  revalidatePath("/", "layout");
}

/**
 * Full export of everything belonging to this user.
 *
 * The password hash is never included, and integration credential references
 * are stripped: an export should be safe to store outside the app.
 */
export async function exportUserData(): Promise<string> {
  const user = await requireUser();

  const tables = {
    lifeAreas: schema.lifeAreas,
    goals: schema.goals,
    projects: schema.projects,
    milestones: schema.milestones,
    tasks: schema.tasks,
    events: schema.events,
    people: schema.people,
    interactions: schema.interactions,
    habits: schema.habits,
    habitEntries: schema.habitEntries,
    journalEntries: schema.journalEntries,
    notes: schema.notes,
    metrics: schema.metrics,
    workouts: schema.workouts,
    financialAccounts: schema.financialAccounts,
    transactions: schema.transactions,
    reviews: schema.reviews,
    notifications: schema.notifications,
    aiConversations: schema.aiConversations,
    aiMessages: schema.aiMessages,
    focusSessions: schema.focusSessions,
    timeBudgets: schema.timeBudgets,
  } as const;

  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    user: { name: user.name, email: user.email, timezone: user.timezone },
    settings: user.settings,
  };

  for (const [key, table] of Object.entries(tables)) {
    data[key] = await db.select().from(table).where(eq(table.userId, user.id));
  }

  // Integrations are exported without any pointer to stored secrets.
  const integrationRows = await db
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.userId, user.id));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured out so the secret pointer never reaches an export
  data.integrations = integrationRows.map(({ credentialRef, ...rest }) => rest);

  await audit(user.id, "data.export", { actor: "user" });
  return JSON.stringify(data, null, 2);
}

/** Irreversible. Cascades remove every child row, then the session is cleared. */
export async function deleteAccount(confirmation: string): Promise<SettingsState> {
  const user = await requireUser();
  if (confirmation.trim().toLowerCase() !== "delete my data") {
    return { error: 'Type "delete my data" exactly to confirm.' };
  }

  await audit(user.id, "account.delete", { actor: "user" });
  await db.delete(users).where(eq(users.id, user.id));
  await clearSessionCookie();
  return { ok: true };
}
