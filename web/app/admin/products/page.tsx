import type { Metadata } from "next";
import { AdminPage } from "@/components/staff/AdminPage";
import { ProductsList } from "@/components/staff/ProductsList";

export const metadata: Metadata = { title: "Products · Raiffy Admin" };

/* admin.html#products over convex/adminViews.ts products, read-only */
export default function ProductsPage() {
  return <AdminPage loading="Loading products…">{(me) => <ProductsList me={me} />}</AdminPage>;
}
