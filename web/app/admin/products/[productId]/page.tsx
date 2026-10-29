import type { Metadata } from "next";
import { AdminPage, type StaffMe } from "@/components/staff/AdminPage";
import { ProductDetail } from "@/components/staff/ProductDetail";

export const metadata: Metadata = { title: "Product · Raiffy Admin" };

type Params = Promise<{ productId: string }>;

/* admin.html#products/<id> over convex/adminViews.ts product, read-only. Params resolve inside AdminPage's Suspense. */
export default function ProductPage({ params }: { params: Params }) {
  return <AdminPage loading="Loading the product…">{(me) => <Product me={me} params={params} />}</AdminPage>;
}

async function Product({ me, params }: { me: StaffMe; params: Params }) {
  const { productId } = await params;
  return <ProductDetail me={me} productId={decodeURIComponent(productId)} />;
}
