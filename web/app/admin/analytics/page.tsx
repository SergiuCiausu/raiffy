import type { Metadata } from "next";
import { AdminPage } from "@/components/staff/AdminPage";
import { AnalyticsDashboard } from "@/components/staff/AnalyticsDashboard";

export const metadata: Metadata = { title: "Analytics · Raiffy Admin" };

/* admin.html#analytics over convex/analytics.ts summary */
export default function AnalyticsPage() {
  return <AdminPage loading="Loading analytics…">{(me) => <AnalyticsDashboard me={me} />}</AdminPage>;
}
