import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getNotificationPreferences } from "@/lib/domain/notifications";
import { NotificationPreferencesView } from "@/components/settings/notification-preferences";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Notification preferences" };

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const prefs = await getNotificationPreferences(user.id);

  return (
    <div className="animate-in">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Settings
      </Link>

      <PageHeader
        title="Notification preferences"
        description="Most things should stay quiet. Turn on only what you would genuinely want to be interrupted for."
      />

      <NotificationPreferencesView
        preferences={prefs.map((p) => ({
          category: p.category,
          channel: p.channel,
          enabled: p.enabled,
          priorityThreshold: p.priorityThreshold,
          leadMinutes: p.leadMinutes,
        }))}
        settings={{
          quietHoursEnabled: user.settings.quietHoursEnabled,
          quietHoursStart: user.settings.quietHoursStart,
          quietHoursEnd: user.settings.quietHoursEnd,
          criticalBypassesQuietHours: user.settings.criticalBypassesQuietHours,
          morningBriefingEnabled: user.settings.morningBriefingEnabled,
          morningBriefingTime: user.settings.morningBriefingTime,
          eveningBriefingEnabled: user.settings.eveningBriefingEnabled,
          eveningBriefingTime: user.settings.eveningBriefingTime,
        }}
      />
    </div>
  );
}
