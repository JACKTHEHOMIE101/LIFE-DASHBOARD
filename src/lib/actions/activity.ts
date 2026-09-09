"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, projects } from "@/db/schema";

/**
 * Projects carry a denormalised `lastActivityAt` so "stalled" is a cheap
 * indexed read rather than a scan across tasks, notes and events. Anything that
 * counts as progress on a project calls through here.
 */
export async function recordActivity(userId: string, projectId: string) {
  await db
    .update(projects)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

/** Append-only trail. Used for AI-initiated writes and security-relevant events. */
export async function audit(
  userId: string,
  action: string,
  options: {
    actor?: "user" | "ai" | "system";
    entityType?: string;
    entityId?: string;
    meta?: Record<string, unknown>;
  } = {},
) {
  await db.insert(auditLog).values({
    userId,
    action,
    actor: options.actor ?? "user",
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
    meta: options.meta ?? null,
  });
}
