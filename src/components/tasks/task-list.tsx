"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckSquare, Plus } from "lucide-react";
import type { TaskWithContext } from "@/lib/domain/tasks";
import type { PaletteArea, PaletteProject } from "@/lib/domain/search-types";
import { TaskRow } from "./task-row";
import { TaskForm } from "./task-form";
import { Button, Card, EmptyState, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const VIEWS = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "overdue", label: "Overdue" },
  { value: "unscheduled", label: "Unscheduled" },
  { value: "all", label: "All open" },
  { value: "completed", label: "Completed" },
] as const;

const DURATIONS = [
  { value: "", label: "Any length" },
  { value: "15", label: "Under 15 min" },
  { value: "20", label: "Under 20 min" },
  { value: "30", label: "Under 30 min" },
  { value: "60", label: "Under an hour" },
];

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  today: { title: "Nothing due today", description: "Your day is clear. That is allowed." },
  upcoming: { title: "Nothing scheduled ahead", description: "No tasks have a future due date." },
  overdue: { title: "Nothing overdue", description: "You are caught up." },
  unscheduled: { title: "Everything has a date", description: "No undated tasks are waiting." },
  completed: { title: "Nothing completed yet", description: "Finished tasks will collect here." },
  all: { title: "No open tasks", description: "Add one with quick capture or the button above." },
};

export function TaskList({
  tasks,
  projects,
  lifeAreas,
  openNew,
}: {
  tasks: TaskWithContext[];
  projects: PaletteProject[];
  lifeAreas: PaletteArea[];
  openNew?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [formOpen, setFormOpen] = useState(Boolean(openNew));
  const [editing, setEditing] = useState<TaskWithContext | null>(null);

  const view = params.get("view") ?? "today";

  /** Filters live in the URL so a filtered view is shareable and survives refresh. */
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("new");
    router.push(`${pathname}?${next.toString()}`);
  }

  const empty = EMPTY_COPY[view] ?? EMPTY_COPY.all;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Task views">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              href={`${pathname}?view=${v.value}`}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                view === v.value
                  ? "bg-surface font-medium text-ink shadow-card"
                  : "text-ink-muted hover:bg-surface hover:text-ink",
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            aria-label="Filter by duration"
            value={params.get("maxMinutes") ?? ""}
            onChange={(e) => setParam("maxMinutes", e.target.value)}
            className="h-8 w-auto py-0 text-[13px]"
          >
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by energy"
            value={params.get("energy") ?? ""}
            onChange={(e) => setParam("energy", e.target.value)}
            className="h-8 w-auto py-0 text-[13px]"
          >
            <option value="">Any energy</option>
            <option value="low">Low energy</option>
            <option value="medium">Medium energy</option>
            <option value="high">High energy</option>
          </Select>

          <Select
            aria-label="Filter by project"
            value={params.get("projectId") ?? ""}
            onChange={(e) => setParam("projectId", e.target.value)}
            className="h-8 w-auto max-w-40 py-0 text-[13px]"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            New task
          </Button>
        </div>
      </div>

      <Card>
        {tasks.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="size-5" />}
            title={empty.title}
            description={empty.description}
          />
        ) : (
          <ul className="divide-y divide-border px-5">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskRow
                  task={task}
                  onSelect={(t) => {
                    setEditing(t);
                    setFormOpen(true);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {tasks.length > 0 ? (
        <p className="mt-3 text-[12px] text-ink-subtle">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </p>
      ) : null}

      <TaskForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        projects={projects}
        lifeAreas={lifeAreas}
        task={editing}
      />
    </>
  );
}
