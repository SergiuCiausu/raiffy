import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { atLeast, parseRole, type Role } from "@/lib/roles";

/*
 * Initialize Clerk, and send people away from staff areas they can't use. This is a convenience redirect only:
 * every page, server action and Convex function checks the role itself, including on direct requests.
 */
const STAFF_AREAS: [ReturnType<typeof createRouteMatcher>, Role][] = [
  [createRouteMatcher(["/admin(.*)"]), "admin"],
  [createRouteMatcher(["/console(.*)"]), "operator"],
];

const initializeClerk = clerkMiddleware(async (auth, request) => {
  const min = STAFF_AREAS.find(([matches]) => matches(request))?.[1];
  if (!min) return;
  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  if (!atLeast(parseRole(sessionClaims?.metadata?.role), min)) return NextResponse.redirect(new URL("/chat", request.url));
}, { signInUrl: "/sign-in", signUpUrl: "/sign-up" }); // our own pages, not Clerk's hosted Account Portal

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  return initializeClerk(request, event);
}
export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
