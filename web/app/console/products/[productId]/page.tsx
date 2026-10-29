import type { Metadata } from "next";
import { Suspense } from "react";
import { currentUser } from "@clerk/nextjs/server";
import "@/styles/generated/console.css";
import { ConvexClientProvider } from "@/components/agent/ConvexClientProvider";
import { ProductConsole } from "@/components/staff/ConsoleProducts";
import { requirePageRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Product · Raiffy Console" };

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
type Params = Promise<{ productId: string }>;

export default function ProductPage({ params }: { params: Params }) {
  if (!CONVEX_URL || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <main className="agent-setup"><h1>Setup is incomplete</h1><p>Authentication must be configured first.</p></main>;
  }
  return (
    <Suspense fallback={<main className="agent-setup" role="status">Loading the product…</main>}>
      <Product url={CONVEX_URL} params={params} />
    </Suspense>
  );
}

/* console.html#products/<id> for operators and admins; Convex checks the role again for every read and change */
async function Product({ url, params }: { url: string; params: Params }) {
  const caller = await requirePageRole("operator");
  const [{ productId }, user] = await Promise.all([params, currentUser()]);
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Specialist";
  return (
    <div className="pg-console">
      <ConvexClientProvider url={url}><ProductConsole me={{ name, role: caller.role }} productId={decodeURIComponent(productId)} /></ConvexClientProvider>
    </div>
  );
}
