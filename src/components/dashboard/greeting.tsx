import { CloudSun } from "lucide-react";
import { formatLongDate } from "@/lib/utils";

function greetingFor(hour: number) {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Weather is integration-shaped rather than faked: the slot exists, says
 * plainly that nothing is connected, and will render a real reading once a
 * provider adapter fills it.
 */
function WeatherSlot({ reading }: { reading?: { summary: string; temperature: string } }) {
  if (!reading) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px] text-ink-subtle"
        title="No weather provider connected"
      >
        <CloudSun className="size-4" />
        No weather connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
      <CloudSun className="size-4" />
      {reading.temperature} · {reading.summary}
    </span>
  );
}

export function Greeting({ name, now }: { name: string; now: Date }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {greetingFor(now.getHours())}, {name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{formatLongDate(now)}</p>
      </div>
      <WeatherSlot />
    </div>
  );
}
