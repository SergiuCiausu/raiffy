/*
 * One console line per thing that goes wrong on /chat, so a broken session or reply can be traced from the browser
 * console (client) or the `pnpm dev` terminal (server). Never pass message text or personal data: ids, names and
 * error messages only.
 */

export type ChatLogDetail = Record<string, unknown>;

/** The error's name and message, without a stack or payload that could carry customer text. */
export function errorInfo(error: unknown): ChatLogDetail {
  if (error instanceof Error) return { error: error.name, message: error.message, ...("digest" in error ? { digest: error.digest } : {}) };
  return { error: String(error) };
}

// Time and path only in the browser: on the server this can run while Next prerenders, where reading the clock is
// an error (Cache Components), and the dev terminal already shows when and which route.
function line(scope: string, where: string, detail: ChatLogDetail) {
  return [`[${scope}] ${where}`, {
    ...(typeof window !== "undefined" ? { at: new Date().toISOString(), path: window.location.pathname } : {}),
    ...detail,
  }] as const;
}

export function logChatError(where: string, detail: ChatLogDetail = {}) {
  console.error(...line("chat", where, detail));
}

/** For expected but notable events: a redirect, a slow connection. */
export function logChatWarning(where: string, detail: ChatLogDetail = {}, scope = "chat") {
  console.warn(...line(scope, where, detail));
}
