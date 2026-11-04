import type { Metadata } from "next";
import SourcesView from "@/components/SourcesView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.sources.title, robots: { index: false } };
}

export default function SourcesPage() {
  return <SourcesView />;
}
