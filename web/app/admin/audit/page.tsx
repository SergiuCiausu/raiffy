import type { Metadata } from "next";
import { AdminPage } from "@/components/staff/AdminPage";
import { AuditLog } from "@/components/staff/AuditLog";

export const metadata: Metadata = { title: "Audit log · Raiffy Admin" };

/* admin.html#audit over convex/adminViews.ts audit */
export default function AuditPage() {
  return <AdminPage loading="Loading the audit log…">{(me) => <AuditLog me={me} />}</AdminPage>;
}
