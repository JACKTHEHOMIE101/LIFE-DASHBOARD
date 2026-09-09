import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Lock, Plug } from "lucide-react";
import { db } from "@/db";
import { integrations, syncRecords } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { AUTH_LABEL, DOMAIN_LABEL, providersByDomain } from "@/lib/integrations/registry";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [connected, recentSyncs] = await Promise.all([
    db.select().from(integrations).where(eq(integrations.userId, user.id)),
    db
      .select()
      .from(syncRecords)
      .where(eq(syncRecords.userId, user.id))
      .orderBy(desc(syncRecords.startedAt))
      .limit(10),
  ]);

  const byProvider = new Map(connected.map((i) => [i.provider, i]));
  const domains = providersByDomain();

  return (
    <div className="animate-in">
      <PageHeader
        title="Integrations"
        description="Providers feed a normalised model. Nothing in the app is coupled to any one of them."
      />

      <Card className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
          <div className="text-[13px] text-ink-muted">
            <p className="font-medium text-ink">How credentials are handled</p>
            <p className="mt-1">
              Tokens are held server-side and referenced by an opaque pointer; the database stores no
              secret and the browser never receives one. Each provider lists exactly what it reads
              before you connect it, and disconnecting revokes access and deletes the reference.
            </p>
          </div>
        </div>
      </Card>

      <Card className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <Plug className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
          <div className="text-[13px] text-ink-muted">
            <p className="font-medium text-ink">Adapters are not implemented yet</p>
            <p className="mt-1">
              The framework is complete: normalised models, provider/external-id provenance on every
              imported record, incremental sync cursors, sync history and error reporting. What is
              missing is the per-provider code and OAuth credentials. Until then, sample data and
              anything you enter by hand behave identically throughout the app.
            </p>
          </div>
        </div>
      </Card>

      <div className="space-y-5">
        {[...domains.entries()].map(([domain, providers]) => (
          <Card key={domain}>
            <CardHeader title={DOMAIN_LABEL[domain]} />
            <ul className="divide-y divide-border border-t border-border">
              {providers.map((provider) => {
                const record = byProvider.get(provider.id);
                return (
                  <li key={provider.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">{provider.name}</span>
                          <Badge tone={record?.status === "connected" ? "positive" : "neutral"}>
                            {record?.status === "connected" ? "Connected" : "Not connected"}
                          </Badge>
                          <Badge tone="neutral">{AUTH_LABEL[provider.authKind]}</Badge>
                          {provider.incremental ? (
                            <Badge tone="neutral" title="Supports incremental sync">
                              Incremental
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[12px] text-ink-subtle">{provider.description}</p>

                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-[12px] text-ink-subtle hover:text-ink-muted">
                            What it would read
                          </summary>
                          <ul className="mt-1 space-y-0.5 pl-4 text-[12px] text-ink-subtle">
                            {provider.reads.map((line) => (
                              <li key={line} className="list-disc">
                                {line}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>

                      <span className="shrink-0 text-[12px] text-ink-subtle">
                        {record?.lastSyncAt
                          ? `Synced ${formatDate(record.lastSyncAt)}`
                          : "Adapter not built"}
                      </span>
                    </div>

                    {record?.lastError ? (
                      <p className="mt-2 text-[12px] text-critical">{record.lastError}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}

        <Card>
          <CardHeader title="Sync history" description="The last ten sync runs across all providers" />
          {recentSyncs.length === 0 ? (
            <p className="border-t border-border px-5 py-4 text-[13px] text-ink-subtle">
              No syncs have run. Sync history records what changed, how long it took, and any error,
              so a failing integration is visible rather than silent.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border px-5">
              {recentSyncs.map((sync) => (
                <li key={sync.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                  <span className="text-ink-muted">
                    {formatDate(sync.startedAt)} · {sync.mode}
                  </span>
                  <span className="text-ink-subtle">
                    {sync.created} created, {sync.updated} updated, {sync.deleted} removed
                  </span>
                  <Badge tone={sync.status === "success" ? "positive" : sync.status === "failed" ? "critical" : "neutral"}>
                    {sync.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
