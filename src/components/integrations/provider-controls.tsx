"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Unplug } from "lucide-react";
import { disconnectProvider, syncProvider } from "@/lib/actions/integrations";
import { Button, buttonClass } from "@/components/ui/primitives";

/**
 * Connect, sync and disconnect for one provider.
 *
 * Connect is a plain link rather than a button with an action behind it,
 * because the destination is Google's own consent page — the user should be
 * able to see where they are going before they go there.
 */
export function ProviderControls({
  provider,
  connectHref,
  connected,
  ready,
}: {
  provider: string;
  connectHref: string;
  connected: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setFailed(!result.ok);
      setMessage(result.message);
      router.refresh();
    });
  }

  if (!ready) {
    return (
      <p className="text-[12px] text-ink-subtle">
        Needs <code className="rounded bg-surface px-1">GOOGLE_CLIENT_ID</code> and{" "}
        <code className="rounded bg-surface px-1">GOOGLE_CLIENT_SECRET</code> on the server
      </p>
    );
  }

  if (!connected) {
    return (
      <a href={connectHref} className={buttonClass({ variant: "primary", size: "sm" })}>
        Connect
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => syncProvider(provider))}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Sync now
        </Button>

        {confirming ? (
          <>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                run(() => disconnectProvider(provider));
              }}
            >
              Confirm
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(true)}>
            <Unplug className="size-3.5" />
            Disconnect
          </Button>
        )}
      </div>

      {confirming ? (
        <p className="max-w-64 text-right text-[12px] text-ink-subtle">
          This revokes access at Google and removes imported events from your calendar.
        </p>
      ) : null}

      {message ? (
        <p className={`max-w-64 text-right text-[12px] ${failed ? "text-critical" : "text-positive"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
