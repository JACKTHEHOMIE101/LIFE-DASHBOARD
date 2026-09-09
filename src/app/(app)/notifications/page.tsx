import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listNotifications } from "@/lib/domain/notifications";
import { generateNotifications } from "@/lib/notifications/generators";
import { deliverDueNotifications } from "@/lib/notifications/engine";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();

  // Regenerating on view keeps the centre current without a background worker.
  // Both calls are idempotent, so this is safe on every render.
  await generateNotifications(user.id, user.settings.weekStartsOn);
  await deliverDueNotifications(user.id);

  const items = await listNotifications(user.id, { includeRead: true, limit: 100 });

  return (
    <div className="animate-in">
      <PageHeader
        title="Notifications"
        description="Reminders you asked for, events the system found, and insights drawn from your data — kept separate on purpose."
      />
      <NotificationCenter notifications={items} />
    </div>
  );
}

export const dynamic = "force-dynamic";
