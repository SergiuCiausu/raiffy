import type { Metadata } from "next";
import { AdminHome } from "@/components/staff/AdminHome";
import { AdminPage } from "@/components/staff/AdminPage";

export const metadata: Metadata = { title: "Home · Raiffy Admin" };

/* admin.html#home over convex/adminViews.ts home: the admin area's first page */
export default function AdminHomePage() {
  return <AdminPage loading="Loading…">{(me) => <AdminHome me={me} />}</AdminPage>;
}
