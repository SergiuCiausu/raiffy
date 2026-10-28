import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

const geist = Geist({ variable: "--font-geist", subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "latin-ext"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Concept: Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const content = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/chat" signUpFallbackRedirectUrl="/chat">{children}</ClerkProvider>
    : children;
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} data-scroll-behavior="smooth">
      <body>{content}</body>
    </html>
  );
}
