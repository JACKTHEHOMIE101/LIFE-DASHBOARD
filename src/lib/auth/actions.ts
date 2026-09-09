"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { provisionUserDefaults } from "@/lib/onboarding";
import { seedDemoData } from "@/lib/demo/seed-demo";
import { clearSessionCookie, createSessionCookie } from "./session";
import { hasAnyUser } from "./index";

export type AuthState = { error?: string } | undefined;

const credentials = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters."),
});

const signUpSchema = credentials.extend({
  name: z.string().min(1, "What should we call you?").max(80),
  demoData: z.boolean(),
});

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
    demoData: formData.get("demoData") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { name, email, password, demoData } = parsed.data;

  // This is a personal Life OS: the first account owns the instance, and
  // further self-signup is closed rather than left open to the internet.
  if (await hasAnyUser()) {
    return { error: "This Life OS already has an owner. Sign in instead." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash, timezone: "UTC" })
    .returning();

  await provisionUserDefaults(db, user.id);
  if (demoData) await seedDemoData(db, user.id);

  await createSessionCookie({ userId: user.id, email: user.email });
  redirect("/");
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  // Never reveal which half was wrong.
  const invalid = { error: "Email or password is incorrect." };
  if (!parsed.success) return invalid;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  if (!user || user.deletedAt) {
    // Burn comparable time so a missing account is not detectable by timing.
    await bcrypt.compare(
      parsed.data.password,
      "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7QwSj4S1sHnQ8sCFyD1cnPZ0GYqM2Zm",
    );
    return invalid;
  }

  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return invalid;

  await createSessionCookie({ userId: user.id, email: user.email });
  redirect("/");
}

export async function signOut() {
  await clearSessionCookie();
  redirect("/login");
}
