"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Download, FlaskConical, Loader2, Trash2 } from "lucide-react";
import {
  deleteAccount, exportUserData, loadDemoData, removeDemoData,
  updateProfile, updateTimeBudgets, type SettingsState,
} from "@/lib/actions/settings";
import {
  Badge, Button, Card, CardHeader, Input, Label, Select,
} from "@/components/ui/primitives";
import { useTheme, type ThemeChoice } from "@/components/shell/theme";

const BUDGET_FIELDS = [
  { key: "deep_work", label: "Deep work" },
  { key: "meetings", label: "Meetings" },
  { key: "health", label: "Health" },
  { key: "relationships", label: "Relationships" },
  { key: "personal_growth", label: "Personal growth" },
];

function Submit({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      {label}
    </Button>
  );
}

export function SettingsView({
  name,
  email,
  timezone,
  theme,
  weekStartsOn,
  demoDataPresent,
  budgets,
  aiEnabled,
  pushEnabled,
}: {
  name: string;
  email: string;
  timezone: string;
  theme: ThemeChoice;
  weekStartsOn: number;
  demoDataPresent: boolean;
  budgets: Record<string, number>;
  aiEnabled: boolean;
  pushEnabled: boolean;
}) {
  const router = useRouter();
  const { setChoice } = useTheme();
  const [profileState, profileAction] = useActionState<SettingsState, FormData>(updateProfile, {});
  const [budgetState, budgetAction] = useActionState<SettingsState, FormData>(updateTimeBudgets, {});
  const [confirmation, setConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const json = await exportUserData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `life-os-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <>
      <Card>
        <CardHeader title="Profile" />
        <form action={profileAction} className="space-y-3.5 border-t border-border px-5 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="s-name">Name</Label>
              <Input id="s-name" name="name" defaultValue={name} required />
            </div>
            <div>
              <Label htmlFor="s-email">Email</Label>
              <Input id="s-email" value={email} disabled readOnly />
            </div>
            <div>
              <Label htmlFor="s-tz">Timezone</Label>
              <Input id="s-tz" name="timezone" defaultValue={timezone} placeholder="Europe/London" />
            </div>
            <div>
              <Label htmlFor="s-week">Week starts on</Label>
              <Select id="s-week" name="weekStartsOn" defaultValue={String(weekStartsOn)}>
                <option value="1">Monday</option>
                <option value="0">Sunday</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="s-theme">Theme</Label>
              <Select
                id="s-theme"
                name="theme"
                defaultValue={theme}
                onChange={(e) => setChoice(e.target.value as ThemeChoice)}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </div>
          </div>

          {profileState?.error ? (
            <p role="alert" className="text-[13px] text-critical">
              {profileState.error}
            </p>
          ) : null}
          {profileState?.ok ? <p className="text-[13px] text-positive">Saved.</p> : null}

          <div className="flex justify-end">
            <Submit />
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Time intentions"
          description="Hours per week you mean to spend. Analytics compares actuals against these."
        />
        <form action={budgetAction} className="space-y-3.5 border-t border-border px-5 py-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-3">
            {BUDGET_FIELDS.map((field) => (
              <div key={field.key}>
                <Label htmlFor={`b-${field.key}`}>{field.label}</Label>
                <Input
                  id={`b-${field.key}`}
                  name={`budget_${field.key}`}
                  type="number"
                  min={0}
                  max={168}
                  step={0.5}
                  defaultValue={budgets[field.key] ?? 0}
                />
              </div>
            ))}
          </div>
          {budgetState?.ok ? <p className="text-[13px] text-positive">Saved.</p> : null}
          <div className="flex justify-end">
            <Submit />
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Connected services" />
        <ul className="divide-y divide-border border-t border-border px-5">
          <li className="flex items-center justify-between gap-3 py-3 text-sm">
            <span>
              <span className="block text-ink">AI Chief of Staff</span>
              <span className="block text-[12px] text-ink-subtle">
                Set ANTHROPIC_API_KEY in .env to enable reasoning over your data
              </span>
            </span>
            <Badge tone={aiEnabled ? "positive" : "neutral"}>
              {aiEnabled ? "Connected" : "Not configured"}
            </Badge>
          </li>
          <li className="flex items-center justify-between gap-3 py-3 text-sm">
            <span>
              <span className="block text-ink">Push notifications</span>
              <span className="block text-[12px] text-ink-subtle">
                Run npm run generate:vapid and add the keys to .env
              </span>
            </span>
            <Badge tone={pushEnabled ? "positive" : "neutral"}>
              {pushEnabled ? "Configured" : "Not configured"}
            </Badge>
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Sample data"
          description="A realistic example life so nothing is empty before your own data arrives."
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
          <FlaskConical className="size-4 text-ink-subtle" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-muted">
            {demoDataPresent
              ? "Sample data is loaded. Every demo record is labelled, and removing it leaves anything you created untouched."
              : "No sample data is loaded."}
          </p>
          {demoDataPresent ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await removeDemoData();
                  router.refresh();
                })
              }
            >
              Remove sample data
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await loadDemoData();
                  router.refresh();
                })
              }
            >
              Load sample data
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Your data" />
        <div className="space-y-4 border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-ink-muted">
              Export everything as JSON. Passwords and integration secrets are never included.
            </p>
            <Button size="sm" onClick={download} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              Export
            </Button>
          </div>

          <div className="rounded-lg border border-critical/25 bg-critical-soft/30 p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <AlertTriangle className="size-4 text-critical" />
              Delete everything
            </p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Permanently removes your account and every record in it. This cannot be undone.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="Type: delete my data"
                aria-label="Type delete my data to confirm"
                className="max-w-56"
              />
              <Button
                size="md"
                variant="danger"
                disabled={pending || confirmation.trim().toLowerCase() !== "delete my data"}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteAccount(confirmation);
                    if (result.error) setDeleteError(result.error);
                    else window.location.href = "/login";
                  })
                }
              >
                <Trash2 className="size-3.5" />
                Delete my account
              </Button>
            </div>
            {deleteError ? (
              <p role="alert" className="mt-2 text-[13px] text-critical">
                {deleteError}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </>
  );
}
