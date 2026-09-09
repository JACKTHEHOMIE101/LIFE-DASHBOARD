import {
  Activity, BarChart3, BookOpen, Brain, CalendarDays, CheckSquare, ClipboardList,
  Compass, Dumbbell, FolderKanban, Heart, Home, Layers, NotebookPen, Plug,
  Repeat, Settings, Target, Users, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Short label for the mobile tab bar, where horizontal space is scarce. */
  short?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * One navigation model drives the desktop sidebar, the mobile "More" page and
 * the command palette, so a new area only ever has to be added in one place.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Today",
    items: [
      { href: "/", label: "Dashboard", icon: Home, short: "Home" },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/chief-of-staff", label: "Chief of Staff", icon: Brain, short: "AI" },
    ],
  },
  {
    label: "Direction",
    items: [
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/life-areas", label: "Life Areas", icon: Layers },
      { href: "/reviews", label: "Reviews", icon: ClipboardList },
    ],
  },
  {
    label: "Life",
    items: [
      { href: "/health", label: "Health", icon: Heart },
      { href: "/fitness", label: "Fitness", icon: Dumbbell },
      { href: "/finances", label: "Finances", icon: Wallet },
      { href: "/relationships", label: "Relationships", icon: Users },
      { href: "/habits", label: "Habits", icon: Repeat },
      { href: "/journal", label: "Journal", icon: NotebookPen },
      { href: "/notes", label: "Notes", icon: BookOpen },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Mobile leads with the five things worth opening a phone for. Everything else
 * lives one tap deeper under More, rather than being crushed into a tab bar.
 */
export const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, short: "Calendar" },
  { href: "/chief-of-staff", label: "Chief of Staff", icon: Brain, short: "AI" },
  { href: "/more", label: "More", icon: Compass },
];

const MOBILE_TAB_HREFS = new Set(MOBILE_TABS.map((t) => t.href));

/** Everything that is not already a mobile tab, grouped for the More page. */
export const MORE_GROUPS: NavGroup[] = NAV_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.filter((item) => !MOBILE_TAB_HREFS.has(item.href)),
})).filter((group) => group.items.length > 0);

export const NOTIFICATIONS_ITEM: NavItem = {
  href: "/notifications",
  label: "Notifications",
  icon: Activity,
};

export function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
