import type { Metadata } from "next";
import "@/styles/generated/auth.css";
import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Create account · Raiffy",
  description: "Concept sign-up page for Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function SignUpPage() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <main className="agent-setup"><Suspense><SignUp routing="hash" /></Suspense></main>
    : <main className="agent-setup"><h1>Sign-up setup is incomplete</h1><p>Authentication must be configured before an account can be created.</p></main>;
}
