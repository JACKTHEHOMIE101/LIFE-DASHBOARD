import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Dumbbell } from "lucide-react";
import { db } from "@/db";
import { exerciseSets, exercises } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getWorkoutStats } from "@/lib/domain/health";
import { Card, CardHeader, DemoBadge, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { MiniBars, StatTile } from "@/components/ui/charts";
import { addDays, formatDate, formatDuration, isoDate, startOfDay, titleCase } from "@/lib/utils";

export const metadata: Metadata = { title: "Fitness" };

export default async function FitnessPage() {
  const user = await requireUser();
  const stats = await getWorkoutStats(user.id);

  const workoutIds = stats.workouts.map((w) => w.id);
  const exerciseRows = workoutIds.length
    ? await db
        .select()
        .from(exercises)
        .where(inArray(exercises.workoutId, workoutIds))
        .orderBy(exercises.sortOrder)
    : [];

  const setRows = exerciseRows.length
    ? await db
        .select()
        .from(exerciseSets)
        .where(inArray(exerciseSets.exerciseId, exerciseRows.map((e) => e.id)))
        .orderBy(exerciseSets.setNumber)
    : [];

  const setsByExercise = new Map<string, typeof setRows>();
  for (const set of setRows) {
    setsByExercise.set(set.exerciseId, [...(setsByExercise.get(set.exerciseId) ?? []), set]);
  }
  const exercisesByWorkout = new Map<string, typeof exerciseRows>();
  for (const ex of exerciseRows) {
    exercisesByWorkout.set(ex.workoutId, [...(exercisesByWorkout.get(ex.workoutId) ?? []), ex]);
  }

  /**
   * Personal records are the heaviest single set ever recorded per movement.
   * Only computed from what is actually logged, so an unlogged lift never
   * appears as a regression.
   */
  const records = new Map<string, number>();
  for (const ex of exerciseRows) {
    for (const set of setsByExercise.get(ex.id) ?? []) {
      if (set.weightKg && set.weightKg > (records.get(ex.name) ?? 0)) {
        records.set(ex.name, set.weightKg);
      }
    }
  }

  // Weekly workout counts over the last 12 weeks.
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = startOfDay(addDays(new Date(), -((11 - i) * 7 + 6)));
    const end = addDays(start, 7);
    const count = stats.workouts.filter((w) => w.startedAt >= start && w.startedAt < end).length;
    return { label: isoDate(start), value: count };
  });

  return (
    <div className="animate-in">
      <PageHeader
        title="Fitness"
        description="Workouts, sets and personal records, plus how often you actually train."
      />

      {!stats.hasData ? (
        <Card>
          <EmptyState
            icon={<Dumbbell className="size-5" />}
            title="No workouts logged"
            description="Connect Strava, Garmin, Apple Health or Fitbit to import training automatically."
            action={
              <LinkButton href="/integrations" size="sm" variant="primary">
                Connect a provider
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Card>
              <CardHeader title="Frequency" description="Workouts per week, last 12 weeks" />
              <div className="border-t border-border px-5 py-4">
                <MiniBars data={weeks} height={64} formatValue={(v) => `${v} workouts`} />
                <div className="mt-2 flex justify-between text-[11px] text-ink-subtle">
                  <span>12 weeks ago</span>
                  <span>This week</span>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Recent workouts" description="Last 28 days" />
              <ul className="divide-y divide-border border-t border-border">
                {stats.workouts.map((workout) => {
                  const exs = exercisesByWorkout.get(workout.id) ?? [];
                  return (
                    <li key={workout.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-medium text-ink">
                          {workout.name}
                          {workout.isDemo ? <DemoBadge /> : null}
                        </span>
                        <span className="text-[12px] text-ink-subtle">
                          {formatDate(workout.startedAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12px] text-ink-muted">
                        {titleCase(workout.type)}
                        {workout.durationMinutes ? ` · ${formatDuration(workout.durationMinutes)}` : ""}
                        {workout.distanceMeters
                          ? ` · ${(workout.distanceMeters / 1000).toFixed(1)} km`
                          : ""}
                        {workout.avgHeartRate ? ` · ${workout.avgHeartRate} bpm avg` : ""}
                      </p>

                      {exs.length > 0 ? (
                        <ul className="mt-2 space-y-0.5">
                          {exs.map((ex) => (
                            <li key={ex.id} className="text-[12px] text-ink-subtle">
                              <span className="text-ink-muted">{ex.name}</span>{" "}
                              {(setsByExercise.get(ex.id) ?? [])
                                .map((s) =>
                                  s.weightKg ? `${s.reps}×${s.weightKg}kg` : `${s.reps} reps`,
                                )
                                .join(", ")}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Last 28 days" />
              <div className="grid grid-cols-2 gap-5 border-t border-border px-5 py-4">
                <StatTile label="Workouts" value={stats.count} />
                <StatTile label="Per week" value={stats.perWeek} />
                <StatTile label="Time" value={`${Math.round(stats.totalMinutes / 60)}h`} />
                <StatTile label="Distance" value={`${stats.distanceKm} km`} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Personal records" description="Heaviest recorded set" />
              {records.size === 0 ? (
                <EmptyState title="No lifts logged" description="Strength sets show up here once recorded." />
              ) : (
                <ul className="divide-y divide-border border-t border-border px-5">
                  {[...records.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, weight]) => (
                      <li key={name} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                        <span className="text-ink-muted">{name}</span>
                        <span className="font-medium text-ink tabular" data-numeric>
                          {weight} kg
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
