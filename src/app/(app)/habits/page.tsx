import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listHabits } from "@/lib/domain/habits";
import { listGoals } from "@/lib/domain/goals";
import { getPaletteData } from "@/lib/domain/search";
import { HabitsView } from "@/components/habits/habits-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Habits" };

export default async function HabitsPage() {
  const user = await requireUser();
  const [habits, goals, palette] = await Promise.all([
    listHabits(user.id),
    listGoals(user.id, { statuses: ["active"] }),
    getPaletteData(user.id),
  ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Habits"
        description="A few habits tracked honestly beats a long list you quietly stop looking at."
      />
      <HabitsView
        habits={habits}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
        lifeAreas={palette.lifeAreas}
      />
    </div>
  );
}
