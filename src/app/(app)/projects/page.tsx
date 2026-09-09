import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/lib/domain/projects";
import { listGoals } from "@/lib/domain/goals";
import { getPaletteData } from "@/lib/domain/search";
import { ProjectCards } from "@/components/projects/project-cards";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [projects, goals, palette] = await Promise.all([
    listProjects(user.id),
    listGoals(user.id, { statuses: ["active", "paused"] }),
    getPaletteData(user.id),
  ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Projects"
        description="Outcomes with more than one step. Anything without activity for two weeks is flagged."
      />
      <ProjectCards
        projects={projects}
        lifeAreas={palette.lifeAreas}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
        openNew={params.new === "1"}
      />
    </div>
  );
}
