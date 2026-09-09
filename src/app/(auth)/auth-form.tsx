"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { signIn, signUp, type AuthState } from "@/lib/auth/actions";
import { Button, Input, Label } from "@/components/ui/primitives";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? "Working…" : label}
    </Button>
  );
}

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const action = mode === "signup" ? signUp : signIn;
  const [state, formAction] = useActionState<AuthState, FormData>(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {mode === "signup" ? (
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" autoComplete="name" required placeholder="Alex" />
        </div>
      ) : null}

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={10}
          placeholder={mode === "signup" ? "At least 10 characters" : "••••••••••"}
        />
      </div>

      {mode === "signup" ? (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface-sunken p-3">
          <input
            type="checkbox"
            name="demoData"
            defaultChecked
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span className="text-[13px] text-ink-muted">
            <span className="font-medium text-ink">Start with sample data.</span> Fills your Life OS
            with a realistic example life so nothing is empty. Clearly labelled, and removable in
            one click from Settings.
          </span>
        </label>
      ) : null}

      {state?.error ? (
        <p role="alert" className="text-[13px] text-critical">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label={mode === "signup" ? "Create my Life OS" : "Sign in"} />
    </form>
  );
}
