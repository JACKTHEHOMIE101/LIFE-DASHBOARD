import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser, hasAnyUser } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  if (await getCurrentUser()) redirect("/");

  // Once an owner exists this instance is closed. Say so plainly rather than
  // showing a signup form that will always fail.
  if (await hasAnyUser()) {
    return (
      <div className="animate-in text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">This Life OS is set up</h1>
        <p className="mt-2 text-sm text-ink-muted">
          It already has an owner, so new accounts are closed. If this is yours, sign in. If you
          have lost your password, reset it from the server with{" "}
          <code className="rounded bg-surface-sunken px-1 py-0.5 text-[12px]">npm run db:seed</code>{" "}
          or by updating the record directly.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm text-accent hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-ink">
          L
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Set up your Life OS</h1>
        <p className="mt-1 text-sm text-ink-muted">
          One account owns this instance. Everything stays in your own database.
        </p>
      </div>

      <AuthForm mode="signup" />
    </div>
  );
}
