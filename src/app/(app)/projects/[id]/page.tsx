import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getProject } from "@/lib/domain/projects";
import { getPaletteData } from "@/lib/domain/search";
import { listGoals } from "@/lib/domain/goals";
import { ProjectDetail } from "@/components/projects/project-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await params;
  const project = await getProject(user.id, id);
  return { title: project?.title ?? "Project" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [project, palette, goals] = await Promise.all([
    getProject(user.id, id),
    getPaletteData(user.id),
    listGoals(user.id, { statuses: ["active", "paused"] }),
  ]);

  if (!project) notFound();

  return (
    <div className="animate-in">
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Projects
      </Link>

      {project.isStalled ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-caution/30 bg-caution-soft/50 px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" />
          <p className="text-[13px] text-ink-muted">
            <span className="font-medium text-ink">This project has stalled.</span> Nothing has
            moved on it for {project.daysInactive} days. Completing a task or ticking a milestone
            clears the flag.
          </p>
        </div>
      ) : null}

      <ProjectDetail
        project={project}
        lifeAreas={palette.lifeAreas}
        projects={palette.projects}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
