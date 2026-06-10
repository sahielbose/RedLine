import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RedLine — regulatory watch for small business",
  description:
    "Ingest every bill and rule moving through U.S. government, score what threatens your business, and get a cited, plain-English brief.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
