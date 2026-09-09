import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listGoals } from "@/lib/domain/goals";
import { getPaletteData } from "@/lib/domain/search";
import { GoalsView } from "@/components/goals/goals-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [goals, palette] = await Promise.all([
    listGoals(user.id, { statuses: ["active", "paused", "achieved"] }),
    getPaletteData(user.id),
  ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Goals"
        description="Life area to goal to project to task. Progress is measured against where you started, not zero."
      />
      <GoalsView goals={goals} lifeAreas={palette.lifeAreas} openNew={params.new === "1"} />
    </div>
  );
}
