/** Where to land after signing in when nothing (or nothing safe) was asked for. */
export const DEFAULT_AFTER_AUTH = "/chat";

/* Pages that would loop or make no sense as a destination after signing in */
const AUTH_PAGES = ["/sign-in", "/sign-up", "/sso-callback", "/verify-email"];

/**
 * Turns a redirect_url query value into a same-origin path, or the default. Rejects other origins,
 * protocol-relative and backslash tricks ("//evil", "/\\evil"), and non-http schemes, so it can't be an open redirect.
 */
export function safeRedirect(raw: string | null | undefined, origin: string): string {
  if (!raw) return DEFAULT_AFTER_AUTH;
  let url: URL;
  try { url = new URL(raw, origin); } catch { return DEFAULT_AFTER_AUTH; }
  if (url.origin !== origin || (url.protocol !== "http:" && url.protocol !== "https:")) return DEFAULT_AFTER_AUTH;
  if (AUTH_PAGES.some((page) => url.pathname === page || url.pathname.startsWith(`${page}/`))) return DEFAULT_AFTER_AUTH;
  return `${url.pathname}${url.search}${url.hash}`;
}
