import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";

// Initialize Clerk; protected resources enforce auth themselves, including direct navigations.
const initializeClerk = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  return initializeClerk(request, event);
}
export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
