import type { Metadata } from "next";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { goals, lifeAreas, projects, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { areaDirection, getLifePulse } from "@/lib/domain/pulse";
import { LifeAreasView } from "@/components/life-areas/life-areas-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Life Areas" };

export default async function LifeAreasPage() {
  const user = await requireUser();

  const [areas, pulse, projectCounts, goalCounts, taskCounts] = await Promise.all([
    db
      .select()
      .from(lifeAreas)
      .where(and(eq(lifeAreas.userId, user.id), isNull(lifeAreas.deletedAt)))
      .orderBy(lifeAreas.sortOrder),
    getLifePulse(user.id),
    db
      .select({ areaId: projects.lifeAreaId, n: count() })
      .from(projects)
      .where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)))
      .groupBy(projects.lifeAreaId),
    db
      .select({ areaId: goals.lifeAreaId, n: count() })
      .from(goals)
      .where(and(eq(goals.userId, user.id), isNull(goals.deletedAt)))
      .groupBy(goals.lifeAreaId),
    db
      .select({ areaId: tasks.lifeAreaId, n: count() })
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), isNull(tasks.deletedAt)))
      .groupBy(tasks.lifeAreaId),
  ]);

  const byId = <T extends { areaId: string | null; n: number }>(rows: T[]) =>
    new Map(rows.filter((r) => r.areaId).map((r) => [r.areaId as string, r.n]));

  const pulseById = new Map(pulse.map((p) => [p.areaId, p]));

  return (
    <div className="animate-in">
      <PageHeader
        title="Life Areas"
        description="The top level of the hierarchy. Everything below rolls up into one of these."
      />
      <LifeAreasView
        areas={areas.map((area) => {
          const p = pulseById.get(area.id);
          return {
            ...area,
            projectCount: byId(projectCounts).get(area.id) ?? 0,
            goalCount: byId(goalCounts).get(area.id) ?? 0,
            taskCount: byId(taskCounts).get(area.id) ?? 0,
            status: p?.status ?? "no_data",
            statusLabel: p?.statusLabel ?? "Not tracked yet",
            headline: p?.headline ?? "",
            direction: p ? areaDirection(p) : ("flat" as const),
          };
        })}
      />
    </div>
  );
}
