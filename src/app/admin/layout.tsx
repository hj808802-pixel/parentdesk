import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = { title: "ParentDesk admin", robots: { index: false, follow: false } };

// The operator console lives outside the locale tree (English only, never indexed).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  );
}
