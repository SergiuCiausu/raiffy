"use client";

import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState, type ReactNode } from "react";

/** One Convex client per browser tab. The deployment URL is public by design (NEXT_PUBLIC_CONVEX_URL). */
export function ConvexClientProvider({ url, children }: { url: string; children: ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(url));
  return <ConvexProviderWithClerk client={client} useAuth={useAuth}><AuthenticatedChat>{children}</AuthenticatedChat></ConvexProviderWithClerk>;
}

function AuthenticatedChat({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <main className="agent-setup" role="status">Connecting your secure chat…</main>;
  if (!isAuthenticated) return <main className="agent-setup"><h1>Sign in to chat</h1><p>Your conversations are private to your account.</p><Link href="/sign-in">Sign in</Link></main>;
  return children;
}
