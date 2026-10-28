import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin", "latin-ext"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Raiffy",
  description: "Concept: Raiffy, an AI financial assistant for Raiffeisen Bank Romania customers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
