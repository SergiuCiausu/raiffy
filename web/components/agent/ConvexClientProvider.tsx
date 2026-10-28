"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

/** One Convex client per browser tab. The deployment URL is public by design (NEXT_PUBLIC_CONVEX_URL). */
export function ConvexClientProvider({ url, children }: { url: string; children: ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(url));
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
