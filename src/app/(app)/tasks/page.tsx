import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listTasks, type TaskFilter } from "@/lib/domain/tasks";
import { getPaletteData } from "@/lib/domain/search";
import { TaskList } from "@/components/tasks/task-list";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const filter: TaskFilter = {
    view: (one("view") as TaskFilter["view"]) ?? "today",
    projectId: one("projectId"),
    lifeAreaId: one("lifeAreaId"),
    energy: one("energy") as TaskFilter["energy"],
    priority: one("priority") as TaskFilter["priority"],
    maxMinutes: one("maxMinutes") ? Number(one("maxMinutes")) : undefined,
  };

  const [tasks, palette] = await Promise.all([
    listTasks(user.id, filter),
    getPaletteData(user.id),
  ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Tasks"
        description="Filter by what you actually have right now: time, energy, or project."
      />
      <TaskList
        tasks={tasks}
        projects={palette.projects}
        lifeAreas={palette.lifeAreas}
        openNew={one("new") === "1"}
      />
    </div>
  );
}
