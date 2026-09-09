"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { signalDismissals, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";

/** Hides a signal until the underlying condition changes and produces a new key. */
export async function dismissSignal(signalKey: string) {
  const user = await requireUser();
  await db
    .insert(signalDismissals)
    .values({ userId: user.id, signalKey, dismissedAt: new Date(), snoozedUntil: null })
    .onConflictDoUpdate({
      target: [signalDismissals.userId, signalDismissals.signalKey],
      set: { dismissedAt: new Date(), snoozedUntil: null },
    });
  revalidatePath("/");
}

export async function snoozeSignal(signalKey: string, days: number) {
  const user = await requireUser();
  const until = new Date(Date.now() + days * 86_400_000);
  await db
    .insert(signalDismissals)
    .values({ userId: user.id, signalKey, snoozedUntil: until, dismissedAt: null })
    .onConflictDoUpdate({
      target: [signalDismissals.userId, signalDismissals.signalKey],
      set: { snoozedUntil: until, dismissedAt: null },
    });
  revalidatePath("/");
}

/** Turns a signal into something actionable, then stops showing the warning. */
export async function createTaskFromSignal(signalKey: string, title: string) {
  const user = await requireUser();
  await db.insert(tasks).values({
    userId: user.id,
    title,
    priority: "should",
    dueDate: new Date(Date.now() + 2 * 86_400_000),
    origin: "user",
  });
  await db
    .insert(signalDismissals)
    .values({ userId: user.id, signalKey, dismissedAt: new Date() })
    .onConflictDoUpdate({
      target: [signalDismissals.userId, signalDismissals.signalKey],
      set: { dismissedAt: new Date() },
    });
  revalidatePath("/");
  revalidatePath("/tasks");
}

export async function restoreSignal(signalKey: string) {
  const user = await requireUser();
  await db
    .delete(signalDismissals)
    .where(and(eq(signalDismissals.userId, user.id), eq(signalDismissals.signalKey, signalKey)));
  revalidatePath("/");
}
