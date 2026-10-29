import type { Metadata } from "next";
import "@/styles/generated/auth.css";
import { AuthScreen } from "@/components/auth/AuthScreen";

export const metadata: Metadata = {
  title: "Sign in · Raiffy",
  description: "Concept sign-in page for Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function SignInPage() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <AuthScreen initialFlow="login" />
    : <main className="agent-setup"><h1>Sign-in setup is incomplete</h1><p>Authentication must be configured before you can access private chat.</p></main>;
}
