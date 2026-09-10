import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  goals, lifeAreas, milestones, projectGoals, projects, tasks,
  type Milestone, type Project, type ProjectStatus,
} from "@/db/schema";
import { daysBetween } from "@/lib/utils";

export { PROJECT_STATUS_LABEL } from "./labels";

/** A project with no activity for this long is treated as stalled. */
export const STALL_THRESHOLD_DAYS = 14;

export type ProjectSummary = Project & {
  areaName: string | null;
  areaColor: string | null;
  /** Title of the primary goal. */
  goalTitle: string | null;
  /** Every goal this project contributes to, primary first. */
  goalTitles: string[];
  taskTotal: number;
  taskDone: number;
  progress: number;
  daysInactive: number | null;
  isStalled: boolean;
  nextAction: { id: string; title: string; dueDate: Date | null } | null;
  nextMilestone: Milestone | null;
};

/**
 * Project progress is the share of its tasks that are done.
 *
 * A project with no tasks reports 0 rather than 100: "nothing to do" and
 * "nothing planned yet" are different states, and rounding the second up to
 * complete would quietly hide unstarted work.
 */
export function computeProgress(done: number, total: number) {
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

export async function listProjects(
  userId: string,
  options: { statuses?: ProjectStatus[]; lifeAreaId?: string; limit?: number } = {},
): Promise<ProjectSummary[]> {
  const statuses = options.statuses ?? ["planning", "active", "on_hold"];
  const conditions = [
    eq(projects.userId, userId),
    isNull(projects.deletedAt),
    inArray(projects.status, statuses),
  ];
  if (options.lifeAreaId) conditions.push(eq(projects.lifeAreaId, options.lifeAreaId));

  const rows = await db
    .select({
      project: projects,
      areaName: lifeAreas.name,
      areaColor: lifeAreas.color,
      goalTitle: goals.title,
    })
    .from(projects)
    .leftJoin(lifeAreas, eq(lifeAreas.id, projects.lifeAreaId))
    .leftJoin(goals, eq(goals.id, projects.goalId))
    .where(and(...conditions))
    .orderBy(asc(projects.deadline), desc(projects.lastActivityAt))
    .limit(options.limit ?? 100);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.project.id);

  // Counts, next actions, milestones and extra goal links in four queries
  // rather than four per project.
  const [counts, nextActions, upcomingMilestones, extraGoals] = await Promise.all([
    db
      .select({
        projectId: tasks.projectId,
        total: count(),
        done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
      })
      .from(tasks)
      .where(and(inArray(tasks.projectId, ids), isNull(tasks.deletedAt)))
      .groupBy(tasks.projectId),
    db
      .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, ids),
          isNull(tasks.deletedAt),
          inArray(tasks.status, ["todo", "in_progress"]),
        ),
      )
      .orderBy(asc(tasks.dueDate), asc(tasks.sortOrder)),
    db
      .select()
      .from(milestones)
      .where(and(inArray(milestones.projectId, ids), isNull(milestones.completedAt), isNull(milestones.deletedAt)))
      .orderBy(asc(milestones.dueDate)),
    db
      .select({ projectId: projectGoals.projectId, title: goals.title })
      .from(projectGoals)
      .innerJoin(goals, eq(goals.id, projectGoals.goalId))
      .where(and(inArray(projectGoals.projectId, ids), isNull(goals.deletedAt))),
  ]);

  const countMap = new Map(counts.map((c) => [c.projectId, c]));
  const nextActionMap = new Map<string, (typeof nextActions)[number]>();
  for (const action of nextActions) {
    if (action.projectId && !nextActionMap.has(action.projectId)) {
      nextActionMap.set(action.projectId, action);
    }
  }
  const milestoneMap = new Map<string, Milestone>();
  for (const m of upcomingMilestones) {
    if (!milestoneMap.has(m.projectId)) milestoneMap.set(m.projectId, m);
  }

  const extraGoalMap = new Map<string, string[]>();
  for (const link of extraGoals) {
    extraGoalMap.set(link.projectId, [...(extraGoalMap.get(link.projectId) ?? []), link.title]);
  }

  const now = new Date();
  return rows.map(({ project, areaName, areaColor, goalTitle }) => {
    const c = countMap.get(project.id);
    const total = Number(c?.total ?? 0);
    const done = Number(c?.done ?? 0);
    const daysInactive = project.lastActivityAt ? daysBetween(project.lastActivityAt, now) : null;
    const action = nextActionMap.get(project.id);

    return {
      ...project,
      areaName,
      areaColor,
      goalTitle,
      // Primary first, then the rest, with no duplicate if it is also linked.
      goalTitles: [
        ...(goalTitle ? [goalTitle] : []),
        ...(extraGoalMap.get(project.id) ?? []).filter((t) => t !== goalTitle),
      ],
      taskTotal: total,
      taskDone: done,
      progress: computeProgress(done, total),
      daysInactive,
      isStalled:
        project.status === "active" &&
        daysInactive !== null &&
        daysInactive >= STALL_THRESHOLD_DAYS,
      nextAction: action ? { id: action.id, title: action.title, dueDate: action.dueDate } : null,
      nextMilestone: milestoneMap.get(project.id) ?? null,
    };
  });
}

export async function getProject(userId: string, projectId: string) {
  const [row] = await db
    .select({
      project: projects,
      areaName: lifeAreas.name,
      areaColor: lifeAreas.color,
      goalTitle: goals.title,
      goalId: goals.id,
    })
    .from(projects)
    .leftJoin(lifeAreas, eq(lifeAreas.id, projects.lifeAreaId))
    .leftJoin(goals, eq(goals.id, projects.goalId))
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);

  if (!row) return null;

  const [projectTasks, projectMilestones, extraGoals] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.status), asc(tasks.dueDate), asc(tasks.sortOrder)),
    db
      .select()
      .from(milestones)
      .where(and(eq(milestones.projectId, projectId), isNull(milestones.deletedAt)))
      .orderBy(asc(milestones.sortOrder), asc(milestones.dueDate)),
    db
      .select({ title: goals.title })
      .from(projectGoals)
      .innerJoin(goals, eq(goals.id, projectGoals.goalId))
      .where(and(eq(projectGoals.projectId, projectId), isNull(goals.deletedAt))),
  ]);

  const done = projectTasks.filter((t) => t.status === "done").length;
  const daysInactive = row.project.lastActivityAt
    ? daysBetween(row.project.lastActivityAt, new Date())
    : null;

  return {
    ...row.project,
    areaName: row.areaName,
    areaColor: row.areaColor,
    goalTitle: row.goalTitle,
    goalTitles: [
      ...(row.goalTitle ? [row.goalTitle] : []),
      ...extraGoals.map((g) => g.title).filter((t) => t !== row.goalTitle),
    ],
    tasks: projectTasks,
    milestones: projectMilestones,
    taskTotal: projectTasks.length,
    taskDone: done,
    progress: computeProgress(done, projectTasks.length),
    daysInactive,
    isStalled:
      row.project.status === "active" &&
      daysInactive !== null &&
      daysInactive >= STALL_THRESHOLD_DAYS,
  };
}

export async function getStalledProjects(userId: string) {
  const all = await listProjects(userId, { statuses: ["active"] });
  return all.filter((p) => p.isStalled);
}
