import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser, hasAnyUser } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  // A fresh instance has no owner yet, so send the first visitor to setup.
  if (!(await hasAnyUser())) redirect("/setup");

  return (
    <div className="animate-in">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-ink">
          L
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-muted">Sign in to your Life OS.</p>
      </div>

      <AuthForm mode="signin" />

      <p className="mt-6 text-center text-[13px] text-ink-subtle">
        Lost access?{" "}
        <Link href="/setup" className="text-accent hover:underline">
          Recovery options
        </Link>
      </p>
    </div>
  );
}
