import Link from "next/link";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Bell, ChevronRight, Smartphone } from "lucide-react";
import { db } from "@/db";
import { timeBudgets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai/chief-of-staff";
import { pushConfigured } from "@/lib/notifications/push";
import { SettingsView } from "@/components/settings/settings-view";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Settings" };

const LINKS = [
  {
    href: "/settings/notifications",
    label: "Notification preferences",
    description: "Categories, channels, quiet hours and briefings",
    Icon: Bell,
  },
  {
    href: "/settings/devices",
    label: "Devices",
    description: "Which phones and browsers receive push, and revoke any of them",
    Icon: Smartphone,
  },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const budgets = await db.select().from(timeBudgets).where(eq(timeBudgets.userId, user.id));

  return (
    <div className="animate-in">
      <PageHeader title="Settings" description="Your account, your data, and how the system behaves." />

      <div className="space-y-5">
        <Card>
          <CardHeader title="More settings" />
          <ul className="divide-y divide-border border-t border-border">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-sunken"
                >
                  <link.Icon className="size-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{link.label}</span>
                    <span className="block text-[12px] text-ink-subtle">{link.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <SettingsView
          name={user.name}
          email={user.email}
          timezone={user.timezone}
          theme={user.settings.theme}
          weekStartsOn={user.settings.weekStartsOn}
          demoDataPresent={user.settings.demoDataPresent}
          budgets={Object.fromEntries(
            budgets.map((b) => [b.category, Math.round((b.intendedMinutesPerWeek / 60) * 10) / 10]),
          )}
          aiEnabled={aiConfigured()}
          pushEnabled={pushConfigured()}
        />
      </div>
    </div>
  );
}
