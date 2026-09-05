import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./product.css";

export const metadata: Metadata = {
  title: { default: "Aster · AI Inbox", template: "%s · Aster" },
  description:
    "Conversations, thoughtful replies, and a clear space to review your drafts.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
