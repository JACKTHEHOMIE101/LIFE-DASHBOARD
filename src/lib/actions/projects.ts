"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { goals, milestones, projectGoals, projects } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export type ProjectState = { ok?: boolean; error?: string; id?: string };

const optional = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

const schema = z.object({
  title: z.string().trim().min(1, "Give the project a title.").max(200),
  description: z.string().trim().max(4000).nullable(),
  objective: z.string().trim().max(500).nullable(),
  status: z.enum(["planning", "active", "on_hold", "completed", "archived"]),
  deadline: z.string().nullable(),
  lifeAreaId: z.string().nullable(),
  goalId: z.string().nullable(),
});

function parse(formData: FormData) {
  return schema.safeParse({
    title: formData.get("title"),
    description: optional(formData.get("description")),
    objective: optional(formData.get("objective")),
    status: formData.get("status") ?? "active",
    deadline: optional(formData.get("deadline")),
    lifeAreaId: optional(formData.get("lifeAreaId")),
    goalId: optional(formData.get("goalId")),
  });
}

/**
 * Replaces the set of extra goals a project serves.
 *
 * The primary goal lives on `projects.goalId` and is excluded here, so the two
 * can never disagree about which goal is the headline one.
 */
async function setExtraGoals(
  userId: string,
  projectId: string,
  goalIds: string[],
  primaryGoalId: string | null,
) {
  const wanted = [...new Set(goalIds.filter((g) => g && g !== primaryGoalId))];

  await db
    .delete(projectGoals)
    .where(and(eq(projectGoals.userId, userId), eq(projectGoals.projectId, projectId)));

  if (wanted.length === 0) return;

  // Only link goals the user actually owns.
  const owned = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.userId, userId), inArray(goals.id, wanted)));

  if (owned.length === 0) return;

  await db
    .insert(projectGoals)
    .values(owned.map((g) => ({ userId, projectId, goalId: g.id })))
    .onConflictDoNothing();
}

export async function createProject(_prev: ProjectState, formData: FormData): Promise<ProjectState> {
  const user = await requireUser();
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  const [project] = await db
    .insert(projects)
    .values({
      userId: user.id,
      title: d.title,
      description: d.description,
      objective: d.objective,
      status: d.status,
      deadline: d.deadline ? new Date(d.deadline) : null,
      lifeAreaId: d.lifeAreaId,
      goalId: d.goalId,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      origin: "user",
    })
    .returning();

  await setExtraGoals(user.id, project.id, formData.getAll("extraGoalIds").map(String), d.goalId);

  revalidatePath("/projects");
  revalidatePath("/");
  return { ok: true, id: project.id };
}

export async function updateProject(_prev: ProjectState, formData: FormData): Promise<ProjectState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  await db
    .update(projects)
    .set({
      title: d.title,
      description: d.description,
      objective: d.objective,
      status: d.status,
      deadline: d.deadline ? new Date(d.deadline) : null,
      lifeAreaId: d.lifeAreaId,
      goalId: d.goalId,
      // Editing a project is itself activity, so it stops reading as stalled.
      lastActivityAt: new Date(),
      completedAt: d.status === "completed" ? new Date() : null,
    })
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)));

  await setExtraGoals(user.id, id, formData.getAll("extraGoalIds").map(String), d.goalId);

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/");
  return { ok: true, id };
}

export async function archiveProject(projectId: string) {
  const user = await requireUser();
  await db
    .update(projects)
    .set({ status: "archived" })
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  revalidatePath("/projects");
}

export async function addMilestone(projectId: string, title: string, dueDate?: string) {
  const user = await requireUser();
  if (!title.trim()) return;
  await db.insert(milestones).values({
    userId: user.id,
    projectId,
    title: title.trim(),
    dueDate: dueDate ? new Date(dueDate) : null,
    origin: "user",
  });
  await db
    .update(projects)
    .set({ lastActivityAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
  revalidatePath(`/projects/${projectId}`);
}

export async function toggleMilestone(milestoneId: string, done: boolean) {
  const user = await requireUser();
  const [updated] = await db
    .update(milestones)
    .set({ completedAt: done ? new Date() : null })
    .where(and(eq(milestones.id, milestoneId), eq(milestones.userId, user.id)))
    .returning();

  if (updated) {
    await db
      .update(projects)
      .set({ lastActivityAt: new Date() })
      .where(eq(projects.id, updated.projectId));
    revalidatePath(`/projects/${updated.projectId}`);
  }
  revalidatePath("/projects");
}
