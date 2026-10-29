import type { Metadata } from "next";
import { AdminPage } from "@/components/staff/AdminPage";
import { RulesPage } from "@/components/staff/RulesPage";

export const metadata: Metadata = { title: "Rules · Raiffy Admin" };

/* admin.html#rules over convex/adminViews.ts rules, read-only */
export default function Rules() {
  return <AdminPage loading="Loading rules…">{(me) => <RulesPage me={me} />}</AdminPage>;
}
