import type { Metadata } from "next";
import { Suspense } from "react";
import JoinView from "@/components/JoinView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.join.title, robots: { index: false } };
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinView />
    </Suspense>
  );
}
