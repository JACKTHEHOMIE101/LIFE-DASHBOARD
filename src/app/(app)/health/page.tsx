import type { Metadata } from "next";
import { HeartPulse } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getHealthOverview, getWorkoutStats } from "@/lib/domain/health";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { Sparkline, StatTile, TrendIndicator } from "@/components/ui/charts";

export const metadata: Metadata = { title: "Health" };

export default async function HealthPage() {
  const user = await requireUser();
  const [metrics, workouts] = await Promise.all([
    getHealthOverview(user.id),
    getWorkoutStats(user.id),
  ]);

  const connected = metrics.filter((m) => m.hasData);
  const missing = metrics.filter((m) => !m.hasData);

  return (
    <div className="animate-in">
      <PageHeader
        title="Health"
        description="Trends only. This shows what your data does, and never interprets it as a medical conclusion."
      />

      {connected.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HeartPulse className="size-5" />}
            title="No health data connected"
            description="Connect Apple Health, Oura, Garmin, Fitbit or Whoop to see sleep, recovery and activity trends here."
            action={
              <LinkButton href="/integrations" size="sm" variant="primary">
                Connect a provider
              </LinkButton>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((metric) => (
              <Card key={metric.kind} className="p-4">
                <StatTile
                  label={`${metric.label} · 7-day average`}
                  value={metric.formatted ?? "—"}
                  delta={
                    metric.deltaFormatted ? (
                      <TrendIndicator
                        direction={metric.direction}
                        goodDirection={metric.goodDirection}
                      >
                        {metric.deltaFormatted} vs prior week
                      </TrendIndicator>
                    ) : (
                      <span className="text-[13px] text-ink-subtle">Steady week on week</span>
                    )
                  }
                  chart={
                    <Sparkline
                      values={metric.series.map((s) => s.value)}
                      tone={
                        metric.direction === "flat"
                          ? "muted"
                          : metric.goodDirection === "neutral"
                            ? "accent"
                            : metric.direction === metric.goodDirection
                              ? "positive"
                              : "caution"
                      }
                      width={200}
                      height={36}
                      className="w-full"
                      label={`${metric.label} over the last 30 days`}
                    />
                  }
                  sub={`${metric.series.length} days recorded`}
                />
              </Card>
            ))}
          </div>

          <Card className="mt-5">
            <CardHeader
              title="Training"
              description="Last 28 days against the 28 before it"
            />
            {workouts.hasData ? (
              <div className="grid grid-cols-2 gap-5 border-t border-border px-5 py-4 sm:grid-cols-4">
                <StatTile
                  label="Workouts"
                  value={workouts.count}
                  delta={
                    workouts.count !== workouts.priorCount ? (
                      <TrendIndicator
                        direction={workouts.count > workouts.priorCount ? "up" : "down"}
                      >
                        {workouts.count > workouts.priorCount ? "+" : ""}
                        {workouts.count - workouts.priorCount} vs prior
                      </TrendIndicator>
                    ) : undefined
                  }
                />
                <StatTile label="Per week" value={workouts.perWeek} />
                <StatTile label="Total time" value={`${Math.round(workouts.totalMinutes / 60)}h`} />
                <StatTile label="Distance" value={`${workouts.distanceKm} km`} />
              </div>
            ) : (
              <EmptyState title="No workouts recorded" description="Log one in Fitness, or connect Strava or Garmin." />
            )}
          </Card>
        </>
      )}

      {missing.length > 0 && connected.length > 0 ? (
        <Card className="mt-5">
          <CardHeader title="Not connected" />
          <ul className="border-t border-border px-5 py-3.5 text-[13px] text-ink-subtle">
            {missing.map((m) => (
              <li key={m.kind} className="py-0.5">
                {m.label} — no readings recorded
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="mt-5 text-[12px] text-ink-subtle">
        Life OS is not a medical device and gives no medical advice. Anything unusual or persistent
        is a conversation to have with a clinician, not with a dashboard.
      </p>
    </div>
  );
}
