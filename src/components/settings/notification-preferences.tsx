"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import type { NotificationCategory, NotificationPriority } from "@/db/schema";
import { updateNotificationPreference, updateQuietHours } from "@/lib/actions/notifications";
import { Button, Card, CardHeader, Input, Label, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const CATEGORY_COPY: Record<NotificationCategory, { label: string; hint: string }> = {
  tasks: { label: "Tasks", hint: "Due reminders and a daily overdue roll-up" },
  calendar: { label: "Calendar", hint: "Upcoming events and conflicts" },
  projects: { label: "Projects", hint: "Deadlines, stalls and milestones" },
  goals: { label: "Goals", hint: "Deadlines and goals losing momentum" },
  health: { label: "Health", hint: "Trends that move meaningfully" },
  finance: { label: "Finance", hint: "Unusual spending and account issues" },
  relationships: { label: "Relationships", hint: "Important dates and follow-ups you planned" },
  ai: { label: "AI", hint: "Weekly reviews and detected patterns" },
  system: { label: "System", hint: "Reviews due and sync problems" },
};

/** Lead-time presets per category, in minutes. */
const LEAD_PRESETS: Partial<Record<NotificationCategory, { label: string; value: number[] }[]>> = {
  tasks: [
    { label: "1 day + 3 hours", value: [1440, 180] },
    { label: "3 hours + 30 min", value: [180, 30] },
    { label: "30 minutes only", value: [30] },
  ],
  calendar: [
    { label: "60 + 15 minutes", value: [60, 15] },
    { label: "15 minutes", value: [15] },
    { label: "At start", value: [0] },
  ],
  goals: [
    { label: "30, 7 and 1 day", value: [43200, 10080, 1440] },
    { label: "7 and 1 day", value: [10080, 1440] },
  ],
};

type Pref = {
  category: NotificationCategory;
  channel: "inapp" | "push" | "email";
  enabled: boolean;
  priorityThreshold: NotificationPriority;
  leadMinutes: number[];
};

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      Save
    </Button>
  );
}

export function NotificationPreferencesView({
  preferences,
  settings,
}: {
  preferences: Pref[];
  settings: {
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    criticalBypassesQuietHours: boolean;
    morningBriefingEnabled: boolean;
    morningBriefingTime: string;
    eveningBriefingEnabled: boolean;
    eveningBriefingTime: string;
  };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [quietState, quietAction] = useActionState(updateQuietHours, null);

  const categories = [...new Set(preferences.map((p) => p.category))];
  const find = (category: NotificationCategory, channel: Pref["channel"]) =>
    preferences.find((p) => p.category === category && p.channel === channel);

  const update = (
    category: NotificationCategory,
    channel: Pref["channel"],
    values: Partial<Pick<Pref, "enabled" | "priorityThreshold" | "leadMinutes">>,
  ) =>
    startTransition(async () => {
      await updateNotificationPreference(category, channel, values);
      router.refresh();
    });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="By category"
          description="In-app appears in the notification centre. Push interrupts you on your devices."
        />
        <ul className="divide-y divide-border border-t border-border">
          {categories.map((category) => {
            const inapp = find(category, "inapp");
            const push = find(category, "push");
            const presets = LEAD_PRESETS[category];

            return (
              <li key={category} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{CATEGORY_COPY[category].label}</p>
                    <p className="text-[12px] text-ink-subtle">{CATEGORY_COPY[category].hint}</p>
                  </div>

                  <div className="flex items-center gap-5">
                    <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                      In-app
                      <Toggle
                        checked={inapp?.enabled ?? false}
                        label={`In-app notifications for ${CATEGORY_COPY[category].label}`}
                        onChange={(enabled) => update(category, "inapp", { enabled })}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                      Push
                      <Toggle
                        checked={push?.enabled ?? false}
                        label={`Push notifications for ${CATEGORY_COPY[category].label}`}
                        onChange={(enabled) => update(category, "push", { enabled })}
                      />
                    </label>
                  </div>
                </div>

                {push?.enabled ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                    <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                      Only push when at least
                      <Select
                        value={push.priorityThreshold}
                        onChange={(e) =>
                          update(category, "push", {
                            priorityThreshold: e.target.value as NotificationPriority,
                          })
                        }
                        aria-label={`Minimum priority for ${CATEGORY_COPY[category].label}`}
                        className="h-7 w-auto py-0 text-[12px]"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </Select>
                    </label>

                    {presets ? (
                      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                        Remind me
                        <Select
                          value={JSON.stringify(push.leadMinutes)}
                          onChange={(e) =>
                            update(category, "push", { leadMinutes: JSON.parse(e.target.value) })
                          }
                          aria-label={`Reminder timing for ${CATEGORY_COPY[category].label}`}
                          className="h-7 w-auto py-0 text-[12px]"
                        >
                          {presets.map((preset) => (
                            <option key={preset.label} value={JSON.stringify(preset.value)}>
                              {preset.label} before
                            </option>
                          ))}
                          {!presets.some(
                            (p) => JSON.stringify(p.value) === JSON.stringify(push.leadMinutes),
                          ) ? (
                            <option value={JSON.stringify(push.leadMinutes)}>Custom</option>
                          ) : null}
                        </Select>
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Quiet hours and briefings"
          description="Anything suppressed during quiet hours waits rather than disappearing."
        />
        <form action={quietAction} className="space-y-4 border-t border-border px-5 py-4">
          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              name="quietHoursEnabled"
              defaultChecked={settings.quietHoursEnabled}
              className="size-4 accent-[var(--color-accent)]"
            />
            Enable quiet hours
          </label>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="q-start">From</Label>
              <Input id="q-start" name="quietHoursStart" type="time" defaultValue={settings.quietHoursStart} />
            </div>
            <div>
              <Label htmlFor="q-end">Until</Label>
              <Input id="q-end" name="quietHoursEnd" type="time" defaultValue={settings.quietHoursEnd} />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              name="criticalBypassesQuietHours"
              defaultChecked={settings.criticalBypassesQuietHours}
              className="size-4 accent-[var(--color-accent)]"
            />
            Let critical notifications through anyway
          </label>

          <div className="space-y-3.5 border-t border-border pt-4">
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                name="morningBriefingEnabled"
                defaultChecked={settings.morningBriefingEnabled}
                className="size-4 accent-[var(--color-accent)]"
              />
              Morning briefing
            </label>
            <div className="max-w-40">
              <Label htmlFor="q-morning">Delivered at</Label>
              <Input id="q-morning" name="morningBriefingTime" type="time" defaultValue={settings.morningBriefingTime} />
            </div>

            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                name="eveningBriefingEnabled"
                defaultChecked={settings.eveningBriefingEnabled}
                className="size-4 accent-[var(--color-accent)]"
              />
              Evening summary
            </label>
            <div className="max-w-40">
              <Label htmlFor="q-evening">Delivered at</Label>
              <Input id="q-evening" name="eveningBriefingTime" type="time" defaultValue={settings.eveningBriefingTime} />
            </div>
          </div>

          {quietState && "ok" in quietState && quietState.ok ? (
            <p className="text-[13px] text-positive">Saved.</p>
          ) : null}
          {quietState && "error" in quietState && quietState.error ? (
            <p role="alert" className="text-[13px] text-critical">
              {quietState.error}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Submit />
          </div>
        </form>
      </Card>
    </div>
  );
}
