import Link from "next/link";
import { CheckCircle2, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getAttentionSignals } from "@/lib/domain/attention";
import { analyseEvents, getTodayEvents, findFreeSlots } from "@/lib/domain/calendar";
import { getTodaysHabits } from "@/lib/domain/habits";
import { areaDirection, getLifePulse } from "@/lib/domain/pulse";
import { getTaskCounts, getTodaysPriorities, PRIORITY_LABEL } from "@/lib/domain/tasks";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { Greeting } from "@/components/dashboard/greeting";
import { HabitsStrip } from "@/components/dashboard/habits-strip";
import { LifePulse } from "@/components/dashboard/life-pulse";
import { TodaySchedule } from "@/components/dashboard/today-schedule";
import { TaskRow } from "@/components/tasks/task-row";
import { Card, CardHeader, EmptyState, LinkButton } from "@/components/ui/primitives";
import { DemoNotice } from "@/components/shell/demo-notice";
import { formatDuration, startOfDay } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [priorities, counts, todayEvents, pulse, signals, habits] = await Promise.all([
    getTodaysPriorities(user.id, 5),
    getTaskCounts(user.id),
    getTodayEvents(user.id),
    getLifePulse(user.id),
    getAttentionSignals(user.id, user.settings.weekStartsOn),
    getTodaysHabits(user.id),
  ]);

  const dayAnalytics = analyseEvents(todayEvents, startOfDay(now), 1);
  // Only count windows still ahead of us, so "free time" means time you have.
  const remainingFree = findFreeSlots(todayEvents, now, { minMinutes: 30 })
    .filter((slot) => slot.end > now)
    .reduce((sum, slot) => sum + Math.round((slot.end.getTime() - Math.max(slot.start.getTime(), now.getTime())) / 60_000), 0);

  const grouped = {
    must: priorities.filter((t) => t.priority === "must"),
    should: priorities.filter((t) => t.priority === "should"),
    could: priorities.filter((t) => t.priority === "could"),
  };

  return (
    <div className="animate-in">
      <Greeting name={user.name.split(" ")[0]} now={now} />

      {user.settings.demoDataPresent ? <DemoNotice className="mb-5" /> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Today's priorities"
              description={
                counts.completedToday > 0
                  ? `${counts.completedToday} done today · ${counts.open} open in total`
                  : `${counts.open} open in total`
              }
              action={
                <Link href="/tasks" className="text-[12px] text-ink-muted hover:text-ink">
                  All tasks
                </Link>
              }
            />

            {priorities.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="size-5" />}
                title="Nothing is due today"
                description="Your day is clear. Pick something from upcoming work, or leave it clear on purpose."
                action={
                  <LinkButton href="/tasks?view=upcoming" size="sm">
                    See what is next
                  </LinkButton>
                }
              />
            ) : (
              <div className="border-t border-border px-5 pb-2">
                {(["must", "should", "could"] as const).map((priority) =>
                  grouped[priority].length ? (
                    <section key={priority} className="border-b border-border py-1 last:border-0">
                      <h3 className="pt-2.5 text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
                        {PRIORITY_LABEL[priority]}
                      </h3>
                      {grouped[priority].map((task) => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </section>
                  ) : null,
                )}
              </div>
            )}
          </Card>

          <AttentionPanel signals={signals} />
        </div>

        <div className="space-y-5">
          <TodaySchedule events={todayEvents} freeMinutes={remainingFree} />

          <LifePulse areas={pulse.map((area) => ({ ...area, direction: areaDirection(area) }))} />

          <HabitsStrip habits={habits} />

          <Card interactive className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Ask your Chief of Staff</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {dayAnalytics.meetingMinutes > 0
                    ? `${formatDuration(dayAnalytics.meetingMinutes)} of meetings today`
                    : "No meetings today"}
                  {remainingFree > 0 ? ` · ${formatDuration(remainingFree)} free left` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {["What should I focus on today?", "What's slipping?", "Plan my day"].map(
                    (prompt) => (
                      <Link
                        key={prompt}
                        href={`/chief-of-staff?ask=${encodeURIComponent(prompt)}`}
                        className="rounded-md border border-border px-2 py-1 text-[12px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
                      >
                        {prompt}
                      </Link>
                    ),
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
