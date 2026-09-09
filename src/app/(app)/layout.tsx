import { requireUser } from "@/lib/auth";
import { countUnreadNotifications } from "@/lib/domain/notifications";
import { CommandPaletteProvider } from "@/components/shell/command-palette-context";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { ThemeProvider } from "@/components/shell/theme";
import { TopBar } from "@/components/shell/topbar";
import { GlobalOverlays } from "@/components/shell/global-overlays";
import { ServiceWorkerRegistration } from "@/components/shell/service-worker";
import { getPaletteData } from "@/lib/domain/search";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, paletteData] = await Promise.all([
    countUnreadNotifications(user.id),
    getPaletteData(user.id),
  ]);

  return (
    <ThemeProvider defaultChoice={user.settings.theme}>
      <CommandPaletteProvider>
        <div className="flex min-h-dvh bg-canvas">
          <Sidebar userName={user.name} userEmail={user.email} />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar unreadCount={unread} />
            {/* Bottom padding clears the mobile tab bar and floating add button. */}
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 lg:px-8 lg:pt-6 lg:pb-12">
              {children}
            </main>
          </div>

          <MobileTabs />
          <GlobalOverlays projects={paletteData.projects} lifeAreas={paletteData.lifeAreas} />
          <ServiceWorkerRegistration />
        </div>
      </CommandPaletteProvider>
    </ThemeProvider>
  );
}
