import Link from "next/link";
import {
  CalendarDaysIcon, ChartColumnIcon, CircleDashedIcon, GitPullRequestArrowIcon, InboxIcon, LayoutDashboardIcon,
  PackageIcon, ScrollTextIcon, SlidersHorizontalIcon, SmileIcon, TrendingUpIcon, UsersIcon, type LucideIcon,
} from "lucide-react";
import { ADMIN_NAV, CONSOLE_NAV } from "@/lib/staff-nav";

/*
 * The two sidebars, each in its prototype's markup: admin.html's .nav-item list and console.html's plain links.
 * Links come from lib/staff-nav.ts, where a test keeps each area inside itself. "Back to chat" is not a nav row:
 * StaffShell renders it as a button in the sidebar footer.
 */

const ICONS: Record<string, LucideIcon> = {
  users: UsersIcon, inbox: InboxIcon, "trending-up": TrendingUpIcon, "layout-dashboard": LayoutDashboardIcon, package: PackageIcon,
  "sliders-horizontal": SlidersHorizontalIcon, "chart-column": ChartColumnIcon, "scroll-text": ScrollTextIcon,
  "git-pull-request-arrow": GitPullRequestArrowIcon, "calendar-days": CalendarDaysIcon, smile: SmileIcon,
};

export function AdminNav({ current, counts = {} }: { current: string; counts?: Record<string, number> }) {
  return (
    <>
      <span className="grp eyebrow">Admin</span>
      {ADMIN_NAV.work.map((l) => {
        const Icon = ICONS[l.icon] ?? CircleDashedIcon;
        return <Link key={l.id} className="nav-item" href={l.href} aria-current={l.id === current ? "page" : undefined}><Icon aria-hidden="true" /><span>{l.label}</span>{counts[l.id] !== undefined && <small>{counts[l.id]}</small>}</Link>;
      })}
      {ADMIN_NAV.later.length > 0 && <span className="grp eyebrow">Later</span>}
      {ADMIN_NAV.later.map((l) => {
        const Icon = ICONS[l.icon] ?? CircleDashedIcon;
        return <span key={l.label} className="nav-item is-later" aria-disabled="true"><Icon aria-hidden="true" /><span>{l.label}</span><small>soon</small></span>;
      })}
    </>
  );
}

export function ConsoleNav({ current, due = {} }: { current: string | null; due?: Record<string, number> }) {
  return (
    <>
      <span className="grp eyebrow">Work</span>
      {CONSOLE_NAV.work.map((l) => {
        const Icon = ICONS[l.icon] ?? CircleDashedIcon;
        const n = due[l.id] ?? 0;
        return <Link key={l.id} href={l.href} aria-current={l.id === current ? "page" : undefined}><Icon aria-hidden="true" /><span>{l.label}</span>{n > 0 && <small className="due" aria-label={`${n} need attention`}>{n}</small>}</Link>;
      })}
      <span className="grp eyebrow">Later in the console</span>
      {CONSOLE_NAV.later.map((l) => <span key={l.label} className="later"><CircleDashedIcon aria-hidden="true" />{l.label}</span>)}
    </>
  );
}
