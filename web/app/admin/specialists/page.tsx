import type { Metadata } from "next";
import "@/styles/generated/console.css";
import { AdminPage } from "@/components/staff/AdminPage";
import { SpecialistsAdmin } from "@/components/staff/SpecialistsAdmin";

export const metadata: Metadata = { title: "Specialists · Raiffy Admin" };

/* Who customers can book, over convex/bookings.ts specialists; the hours sheet reuses console.html's styles */
export default function SpecialistsPage() {
  return <AdminPage loading="Loading specialists…">{(me) => <SpecialistsAdmin me={me} />}</AdminPage>;
}
