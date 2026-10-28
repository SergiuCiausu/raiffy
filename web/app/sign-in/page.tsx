import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/AuthScreen";
import "@/styles/generated/auth.css";

export const metadata: Metadata = {
  title: "Sign in · Raiffy",
  description: "Concept sign-in page for Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function SignInPage() {
  return <AuthScreen initialFlow="login" />;
}
