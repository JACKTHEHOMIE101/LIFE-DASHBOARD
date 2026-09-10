import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getTimeAnalytics, type TimePeriod } from "@/lib/domain/analytics";
import { getCompletionSeries, getTaskCounts } from "@/lib/domain/tasks";
import { listProjects } from "@/lib/domain/projects";
import { listGoals } from "@/lib/domain/goals";
import { listHabits } from "@/lib/domain/habits";
import { getMetricTrend, getWorkoutStats } from "@/lib/domain/health";
import { getCashflow } from "@/lib/domain/finances";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MiniBars, Meter, RankedBars, StatTile, TrendIndicator } from "@/components/ui/charts";
import { cn, formatDuration, formatMoney, mean, pct } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

const PERIODS: TimePeriod[] = ["week", "month", "quarter"];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const raw = Array.isArray(params.period) ? params.period[0] : params.period;
  const period = (PERIODS.includes(raw as TimePeriod) ? raw : "week") as TimePeriod;

  const [time, completion, counts, projects, goals, habits, sleep, workouts, cashflow] =
    await Promise.all([
      getTimeAnalytics(user.id, period, user.settings.weekStartsOn),
      getCompletionSeries(user.id, 28),
      getTaskCounts(user.id),
      listProjects(user.id, { statuses: ["active"] }),
      listGoals(user.id, { statuses: ["active"] }),
      listHabits(user.id),
      getMetricTrend(user.id, "sleep_minutes"),
      getWorkoutStats(user.id),
      getCashflow(user.id, 6),
    ]);

  const completedTotal = completion.reduce((sum, d) => sum + d.value, 0);
  const recent14 = completion.slice(-14).reduce((s, d) => s + d.value, 0);
  const prior14 = completion.slice(0, 14).reduce((s, d) => s + d.value, 0);
  const goalsWithProgress = goals.filter((g) => g.progress !== null);
  const currentMonth = cashflow.at(-1);
  // Habits without enough history are excluded rather than dragging the average down.
  const scoredHabits = habits.filter((h) => h.consistency !== null);

  return (
    <div className="animate-in">
      <PageHeader
        title="Analytics"
        description="Trends worth acting on. Anything with too little data says so rather than drawing a line through nothing."
      />

      <nav className="mb-5 flex gap-1" aria-label="Period">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/analytics?period=${p}`}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[13px] capitalize transition-colors",
              period === p
                ? "bg-surface font-medium text-ink shadow-card"
                : "text-ink-muted hover:bg-surface hover:text-ink",
            )}
          >
            This {p}
          </Link>
        ))}
      </nav>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <StatTile
            label="Tasks completed"
            value={completedTotal}
            sub="Last 28 days"
            delta={
              prior14 > 0 && recent14 !== prior14 ? (
                <TrendIndicator direction={recent14 > prior14 ? "up" : "down"}>
                  {pct(((recent14 - prior14) / prior14) * 100, 0)} vs prior fortnight
                </TrendIndicator>
              ) : undefined
            }
          />
        </Card>
        <Card className="p-4">
          <StatTile
            label="Open tasks"
            value={counts.open}
            sub={counts.overdue > 0 ? `${counts.overdue} overdue` : "None overdue"}
          />
        </Card>
        <Card className="p-4">
          <StatTile
            label="Active projects"
            value={projects.length}
            sub={
              projects.filter((p) => p.isStalled).length > 0
                ? `${projects.filter((p) => p.isStalled).length} stalled`
                : "All moving"
            }
          />
        </Card>
        <Card className="p-4">
          <StatTile
            label="Habit consistency"
            value={
              scoredHabits.length
                ? `${Math.round(mean(scoredHabits.map((h) => h.consistency as number)) * 100)}%`
                : habits.length
                  ? "Too new"
                  : "No habits"
            }
            sub={scoredHabits.length ? "Average across habits" : undefined}
          />
        </Card>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Where time went"
            description={`Intended versus actual, this ${period}`}
          />
          <div className="border-t border-border px-5 py-4">
            {!time.hasData ? (
              <EmptyState
                title="No time data for this period"
                description="Time is measured from calendar events and timed focus sessions, so connect a calendar or start a focus session."
              />
            ) : (
              <ul className="space-y-3.5">
                {time.categories
                  .filter((c) => c.actualMinutes > 0 || c.intendedMinutes)
                  .map((c) => {
                    const target = c.intendedMinutes ?? 0;
                    const ratio = target > 0 ? c.actualMinutes / target : 0;
                    return (
                      <li key={c.category}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="text-ink">{c.label}</span>
                          <span className="text-ink-muted tabular" data-numeric>
                            {formatDuration(c.actualMinutes)}
                            {c.intendedMinutes !== null ? (
                              <span className="text-ink-subtle">
                                {" "}
                                / {formatDuration(c.intendedMinutes)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <Meter
                          value={target > 0 ? Math.min(ratio, 1) : c.actualMinutes > 0 ? 1 : 0}
                          tone={
                            target === 0
                              ? "muted"
                              : ratio >= 0.85
                                ? "positive"
                                : ratio >= 0.5
                                  ? "accent"
                                  : "caution"
                          }
                          size="sm"
                          label={`${c.label} time`}
                        />
                        {c.varianceMinutes !== null && Math.abs(c.varianceMinutes) > 30 ? (
                          <p className="mt-1 text-[11px] text-ink-subtle">
                            {c.varianceMinutes > 0 ? "Over" : "Under"} intention by{" "}
                            {formatDuration(Math.abs(c.varianceMinutes))}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            )}
            <p className="mt-4 border-t border-border pt-3 text-[11px] text-ink-subtle">
              Measured from calendar events and recorded focus sessions, not from every waking
              minute. Set your intentions in Settings.
            </p>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Task completion" description="Per day, last 28 days" />
            <div className="border-t border-border px-5 py-4">
              <MiniBars
                data={completion.map((d) => ({ label: d.label, value: d.value }))}
                height={72}
                formatValue={(v) => `${v} completed`}
              />
              <div className="mt-2 flex justify-between text-[11px] text-ink-subtle">
                <span>4 weeks ago</span>
                <span>Today</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Goal progress" />
            {goalsWithProgress.length === 0 ? (
              <EmptyState
                title="No measurable goals"
                description="Add a metric to a goal and its progress becomes something you can chart."
              />
            ) : (
              <div className="border-t border-border px-5 py-4">
                <RankedBars
                  data={goalsWithProgress.map((g) => ({
                    label: g.title,
                    value: Math.round((g.progress ?? 0) * 100),
                    tone: g.isNeglected || g.behindSchedule ? "caution" : "accent",
                    note:
                      g.timeElapsed !== null
                        ? `${Math.round(g.timeElapsed * 100)}% of the time to target used`
                        : undefined,
                  }))}
                  formatValue={(v) => `${v}%`}
                />
              </div>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Health and training" />
          <div className="grid grid-cols-2 gap-5 border-t border-border px-5 py-4">
            <StatTile
              label="Sleep"
              value={sleep.hasData ? (sleep.formatted ?? "—") : "Not connected"}
              delta={
                sleep.deltaFormatted ? (
                  <TrendIndicator direction={sleep.direction} goodDirection="up">
                    {sleep.deltaFormatted}
                  </TrendIndicator>
                ) : undefined
              }
            />
            <StatTile
              label="Workouts per week"
              value={workouts.hasData ? workouts.perWeek : "None"}
              sub={workouts.hasData ? "Last 28 days" : undefined}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Money" description="Last 6 months" />
          {cashflow.length === 0 ? (
            <EmptyState title="No transactions" description="Connect an account to see cash flow." />
          ) : (
            <div className="border-t border-border px-5 py-4">
              <div className="grid grid-cols-2 gap-5">
                <StatTile
                  label="Savings rate"
                  value={
                    currentMonth?.savingsRate != null
                      ? `${Math.round(currentMonth.savingsRate * 100)}%`
                      : "No data"
                  }
                  sub="This month"
                />
                <StatTile
                  label="Average monthly spend"
                  value={formatMoney(mean(cashflow.map((m) => m.expenseMinor)))}
                />
              </div>
              <div className="mt-4">
                <MiniBars
                  data={cashflow.map((m) => ({ label: m.month, value: m.expenseMinor }))}
                  height={48}
                  tone="muted"
                  formatValue={(v) => formatMoney(v)}
                />
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-subtle">
                  <span>{cashflow[0]?.month}</span>
                  <span>{cashflow.at(-1)?.month}</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
