import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fear & Greed • Crypto Panel",
  description: "Fear & Greed sentiment + Risk panel for crypto charts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}