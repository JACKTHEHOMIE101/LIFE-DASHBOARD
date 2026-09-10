"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Flag, Pencil, Plus } from "lucide-react";
import type { Milestone, Project, Task } from "@/db/schema";
import type { PaletteArea, PaletteProject } from "@/lib/domain/search-types";
import { PROJECT_STATUS_LABEL } from "@/lib/domain/labels";
import { toggleMilestone, addMilestone } from "@/lib/actions/projects";
import { ProjectForm } from "./project-form";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskRow } from "@/components/tasks/task-row";
import { Meter } from "@/components/ui/charts";
import {
  AreaDot, Badge, Button, Card, CardHeader, DemoBadge, DetailRow, EmptyState, Input,
} from "@/components/ui/primitives";
import { cn, formatDate, pluralise, relativeDay } from "@/lib/utils";

type DetailProject = Project & {
  areaName: string | null;
  areaColor: string | null;
  goalTitle: string | null;
  tasks: Task[];
  milestones: Milestone[];
  taskTotal: number;
  taskDone: number;
  progress: number;
  daysInactive: number | null;
  isStalled: boolean;
};

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const done = Boolean(milestone.completedAt);

  return (
    <li className={cn("flex items-center gap-3 py-2", pending && "opacity-60")}>
      <button
        type="button"
        aria-label={done ? `Reopen ${milestone.title}` : `Complete ${milestone.title}`}
        aria-pressed={done}
        onClick={() =>
          startTransition(async () => {
            await toggleMilestone(milestone.id, !done);
            router.refresh();
          })
        }
        className="-m-2 flex size-9 shrink-0 items-center justify-center p-2"
      >
        <span
          className={cn(
            "flex size-[18px] items-center justify-center rounded-md border transition-colors",
            done ? "border-positive bg-positive text-white" : "border-border-strong",
          )}
        >
          {done ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </button>

      <span className={cn("min-w-0 flex-1 truncate text-sm", done ? "text-ink-subtle line-through" : "text-ink")}>
        {milestone.title}
      </span>

      {milestone.dueDate ? (
        <span className="shrink-0 text-[12px] text-ink-subtle">{formatDate(milestone.dueDate)}</span>
      ) : null}
    </li>
  );
}

export function ProjectDetail({
  project,
  lifeAreas,
  projects,
  goals,
}: {
  project: DetailProject;
  lifeAreas: PaletteArea[];
  projects: PaletteProject[];
  goals: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newMilestone, setNewMilestone] = useState("");
  const [, startTransition] = useTransition();

  const open = project.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const done = project.tasks.filter((t) => t.status === "done");

  return (
    <>
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{project.title}</h1>
              {project.isDemo ? <DemoBadge /> : null}
              <Badge tone={project.status === "active" ? "accent" : "neutral"}>
                {PROJECT_STATUS_LABEL[project.status]}
              </Badge>
            </div>
            {project.objective ? (
              <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{project.objective}</p>
            ) : null}
          </div>

          <Button size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Meter
            value={project.progress / 100}
            tone={project.isStalled ? "caution" : "accent"}
            className="max-w-xs"
            label="Project progress"
          />
          <span className="shrink-0 text-[13px] text-ink-muted tabular" data-numeric>
            {project.progress}% · {project.taskDone}/{project.taskTotal}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Tasks"
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingTask(null);
                    setTaskOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              }
            />
            {project.tasks.length === 0 ? (
              <EmptyState
                title="No tasks yet"
                description="A project without a next action is where things quietly stall."
              />
            ) : (
              <div className="border-t border-border px-5">
                <ul className="divide-y divide-border">
                  {open.map((task) => (
                    <li key={task.id}>
                      <TaskRow
                        task={{ ...task, projectTitle: null, areaName: null, areaColor: null }}
                        showProject={false}
                        onSelect={() => {
                          setEditingTask(task);
                          setTaskOpen(true);
                        }}
                      />
                    </li>
                  ))}
                </ul>

                {done.length > 0 ? (
                  <details className="border-t border-border py-2">
                    <summary className="cursor-pointer py-1 text-[12px] text-ink-subtle hover:text-ink-muted">
                      {done.length} completed
                    </summary>
                    <ul className="divide-y divide-border">
                      {done.map((task) => (
                        <li key={task.id}>
                          <TaskRow
                            task={{ ...task, projectTitle: null, areaName: null, areaColor: null }}
                            showProject={false}
                            compact
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Milestones" />
            <div className="border-t border-border px-5 py-2">
              {project.milestones.length === 0 ? (
                <p className="py-3 text-[13px] text-ink-subtle">
                  No milestones. Useful for longer projects where progress is not just a task count.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {project.milestones.map((m) => (
                    <MilestoneRow key={m.id} milestone={m} />
                  ))}
                </ul>
              )}

              <form
                className="flex gap-2 border-t border-border py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = newMilestone.trim();
                  if (!title) return;
                  setNewMilestone("");
                  startTransition(async () => {
                    await addMilestone(project.id, title);
                    router.refresh();
                  });
                }}
              >
                <Input
                  value={newMilestone}
                  onChange={(e) => setNewMilestone(e.target.value)}
                  placeholder="Add a milestone"
                  aria-label="New milestone"
                  className="h-8 py-0 text-[13px]"
                />
                <Button type="submit" size="sm" disabled={!newMilestone.trim()}>
                  <Flag className="size-3.5" />
                  Add
                </Button>
              </form>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-border border-t border-border px-5 py-1">
              <DetailRow label="Status">{PROJECT_STATUS_LABEL[project.status]}</DetailRow>
              <DetailRow label="Life area">
                {project.areaName ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AreaDot color={project.areaColor ?? "slate"} />
                    {project.areaName}
                  </span>
                ) : (
                  <span className="text-ink-subtle">None</span>
                )}
              </DetailRow>
              <DetailRow label="Goal">
                {project.goalTitle ? (
                  <Link href="/goals" className="text-accent hover:underline">
                    {project.goalTitle}
                  </Link>
                ) : (
                  <span className="text-ink-subtle">Not linked</span>
                )}
              </DetailRow>
              <DetailRow label="Deadline">
                {project.deadline ? (
                  `${formatDate(project.deadline)} · ${relativeDay(project.deadline)}`
                ) : (
                  <span className="text-ink-subtle">None</span>
                )}
              </DetailRow>
              <DetailRow label="Last activity">
                {project.daysInactive === null
                  ? "Never"
                  : project.daysInactive === 0
                    ? "Today"
                    : `${pluralise(project.daysInactive, "day")} ago`}
              </DetailRow>
              <DetailRow label="Source">
                {project.provider ? `Imported from ${project.provider}` : "Created here"}
              </DetailRow>
            </dl>
          </Card>

          {project.description ? (
            <Card>
              <CardHeader title="Description" />
              <p className="border-t border-border px-5 py-4 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                {project.description}
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <ProjectForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        lifeAreas={lifeAreas}
        goals={goals}
        project={project}
      />
      <TaskForm
        open={taskOpen}
        onClose={() => {
          setTaskOpen(false);
          setEditingTask(null);
        }}
        projects={projects}
        lifeAreas={lifeAreas}
        task={editingTask}
        defaultProjectId={project.id}
      />
    </>
  );
}
