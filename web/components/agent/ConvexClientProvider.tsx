"use client";

import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usersApi } from "@/lib/users-api";
import { errorInfo, logChatError, logChatWarning } from "@/lib/chat-log";

/** One Convex client per browser tab. The deployment URL is public by design (NEXT_PUBLIC_CONVEX_URL). */
export function ConvexClientProvider({ url, children }: { url: string; children: ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(url));
  return <ConvexProviderWithClerk client={client} useAuth={useAuth}><AuthenticatedChat>{children}</AuthenticatedChat></ConvexProviderWithClerk>;
}

const SLOW_CONNECT_MS = 10_000;

function AuthenticatedChat({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const ensureUser = useMutation(usersApi.ensure);
  // Clerk has a session but Convex rejected its token (no "convex" JWT template, or CLERK_JWT_ISSUER_DOMAIN doesn't match)
  const rejected = !isLoading && !isAuthenticated && clerkLoaded && !!isSignedIn;

  // Mirror the user into Convex on first authenticated use (CLAUDE.md: don't rely on webhooks alone)
  useEffect(() => {
    if (isAuthenticated) ensureUser({}).catch((error) => logChatError("users:ensure failed", errorInfo(error)));
  }, [isAuthenticated, ensureUser]);

  useEffect(() => {
    if (!isLoading) return;
    const t = window.setTimeout(() => logChatWarning(`still connecting to Convex after ${SLOW_CONNECT_MS / 1000}s`), SLOW_CONNECT_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if (rejected) logChatError("signed in to Clerk, but Convex rejected the session token", { check: "Clerk JWT template named 'convex'; Convex env CLERK_JWT_ISSUER_DOMAIN" });
    else if (!isLoading && !isAuthenticated && clerkLoaded) logChatWarning("no session: showing the sign-in prompt");
  }, [rejected, isLoading, isAuthenticated, clerkLoaded]);

  if (isLoading) return <main className="agent-setup" role="status">Connecting your secure chat…</main>;
  // Linking to /sign-in here would loop: the sign-in page sees the Clerk session and sends the visitor back
  if (rejected) return (
    <main className="agent-setup" role="alert">
      <h1>We couldn’t verify your session</h1>
      <p>Sign out and sign in again to continue. Your conversations are safe.</p>
      <button type="button" className="agent-retry" onClick={() => void signOut({ redirectUrl: "/sign-in" })}>Sign out and sign in again</button>
    </main>
  );
  if (!isAuthenticated) return <main className="agent-setup"><h1>Sign in to chat</h1><p>Your conversations are private to your account.</p><Link href="/sign-in">Sign in</Link></main>;
  return children;
}
