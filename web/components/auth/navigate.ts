import type { useRouter } from "next/navigation";
import { safeRedirect } from "@/lib/redirect";

// Clerk's decorateUrl can return an absolute URL (Safari cookie refresh); those need a full navigation
export function goTo(router: ReturnType<typeof useRouter>, url: string) {
  if (url.startsWith("http")) window.location.href = url;
  else router.push(url);
}

/** Where the visitor was headed (?redirect_url=, set by the proxy), checked to be on this site. Client only. */
export function destination(): string {
  return safeRedirect(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin);
}

/** Carries that destination through Clerk's round trips, so the callback pages finish where the visitor was going */
export function withDestination(path: string): string {
  return `${path}?redirect_url=${encodeURIComponent(destination())}`;
}
