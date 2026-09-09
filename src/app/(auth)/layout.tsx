import { ThemeProvider } from "@/components/shell/theme";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </ThemeProvider>
  );
}
