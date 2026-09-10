"use client";

import {
  createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore,
} from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "lifeos-theme";

/**
 * Runs before first paint so the page never flashes the wrong theme. Kept as a
 * string because it has to be inlined into the document head.
 */
export const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("${STORAGE_KEY}");
    var choice = stored || document.documentElement.dataset.themeDefault || "system";
    var dark = choice === "dark" ||
      (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

function resolve(choice: ThemeChoice) {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const ThemeContext = createContext<{
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}>({ choice: "system", setChoice: () => {} });

export function ThemeProvider({
  children,
  defaultChoice = "system",
}: {
  children: React.ReactNode;
  defaultChoice?: ThemeChoice;
}) {
  /**
   * The stored preference is genuinely external state, so it is read through
   * useSyncExternalStore rather than copied into React state by an effect.
   * Subscribing to `storage` also keeps other tabs in step for free.
   */
  const stored = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    () => (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? defaultChoice,
    () => defaultChoice,
  );

  // A choice made in this tab does not raise a `storage` event, so it is held
  // locally until the next read agrees.
  const [local, setLocal] = useState<ThemeChoice | null>(null);
  const choice = local ?? stored;

  useEffect(() => {
    document.documentElement.dataset.theme = resolve(choice);
    if (choice !== "system") return;
    // Follow the OS while the user has not made an explicit choice.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.dataset.theme = resolve("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocal(next);
  }, []);

  return <ThemeContext value={{ choice, setChoice }}>{children}</ThemeContext>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { choice, setChoice } = useTheme();
  return (
    <div
      className={cn("inline-flex rounded-lg border border-border bg-surface p-0.5", className)}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          onClick={() => setChoice(value)}
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-colors",
            choice === value
              ? "bg-surface-sunken text-ink"
              : "text-ink-subtle hover:text-ink-muted",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
