"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, FolderKanban, Plus } from "lucide-react";
import type { ProjectSummary } from "@/lib/domain/projects";
import type { PaletteArea } from "@/lib/domain/search-types";
import { ProjectForm } from "./project-form";
import { Meter } from "@/components/ui/charts";
import { AreaDot, Badge, Button, Card, DemoBadge, EmptyState } from "@/components/ui/primitives";
import { cn, formatDate, pluralise, relativeDay } from "@/lib/utils";

function ProjectCard({ project }: { project: ProjectSummary }) {
  const overdue = project.deadline && project.deadline < new Date() && project.status !== "completed";

  return (
    <Card interactive className="p-4">
      <Link href={`/projects/${project.id}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-medium text-ink">{project.title}</h3>
              {project.isDemo ? <DemoBadge /> : null}
              {project.isStalled ? (
                <Badge tone="caution">
                  <AlertTriangle className="size-2.5" />
                  Stalled
                </Badge>
              ) : null}
            </div>
            {project.objective ? (
              <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{project.objective}</p>
            ) : null}
          </div>

          <span className="shrink-0 text-[13px] font-medium text-ink tabular" data-numeric>
            {project.progress}%
          </span>
        </div>

        <Meter
          value={project.progress / 100}
          tone={project.isStalled ? "caution" : "accent"}
          size="sm"
          className="mt-3"
          label={`${project.title} progress`}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-subtle">
          {project.areaName ? (
            <span className="inline-flex items-center gap-1.5">
              <AreaDot color={project.areaColor ?? "slate"} />
              {project.areaName}
            </span>
          ) : null}
          <span>
            {project.taskDone}/{project.taskTotal} tasks
          </span>
          {project.deadline ? (
            <span className={cn(overdue && "font-medium text-critical")}>
              {overdue ? `Overdue ${formatDate(project.deadline)}` : `Due ${relativeDay(project.deadline)}`}
            </span>
          ) : null}
          {project.daysInactive !== null && !project.isStalled ? (
            <span>Active {project.daysInactive === 0 ? "today" : `${pluralise(project.daysInactive, "day")} ago`}</span>
          ) : null}
        </div>

        {project.goalTitles.length > 0 ? (
          <p className="mt-2 text-[12px] text-ink-subtle">
            Serves {project.goalTitles.join(" · ")}
          </p>
        ) : null}

        {project.nextAction ? (
          <p className="mt-2.5 truncate border-t border-border pt-2.5 text-[12px] text-ink-muted">
            <span className="text-ink-subtle">Next:</span> {project.nextAction.title}
          </p>
        ) : project.status === "active" ? (
          <p className="mt-2.5 border-t border-border pt-2.5 text-[12px] text-caution">
            No next action defined
          </p>
        ) : null}
      </Link>
    </Card>
  );
}

export function ProjectCards({
  projects,
  lifeAreas,
  goals,
  openNew,
}: {
  projects: ProjectSummary[];
  lifeAreas: PaletteArea[];
  goals: { id: string; title: string }[];
  openNew?: boolean;
}) {
  const [formOpen, setFormOpen] = useState(Boolean(openNew));
  const stalled = projects.filter((p) => p.isStalled);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          {projects.length} active
          {stalled.length > 0 ? ` · ${stalled.length} stalled` : ""}
        </p>
        <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="size-3.5" />
          New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title="No projects yet"
            description="A project is anything with more than one step and an end state. Goals give them direction; tasks move them."
            action={
              <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                Create your first project
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <ProjectForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        lifeAreas={lifeAreas}
        goals={goals}
      />
    </>
  );
}
