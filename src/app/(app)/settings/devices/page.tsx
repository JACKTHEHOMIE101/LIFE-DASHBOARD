import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { pushConfigured } from "@/lib/notifications/push";
import { DevicesView } from "@/components/settings/devices-view";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Devices" };

export default async function DevicesPage() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.userId, user.id))
    .orderBy(desc(devices.lastActiveAt));

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
        title="Devices"
        description="Every browser or phone registered for push. Removing one revokes it immediately."
      />

      <DevicesView
        devices={rows.map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          notificationsEnabled: d.notificationsEnabled,
          hasSubscription: Boolean(d.pushEndpoint),
          lastActiveAt: d.lastActiveAt.toISOString(),
        }))}
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        pushConfigured={pushConfigured()}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
