import type { Metadata } from "next";
import HomeView from "@/components/HomeView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.home.title, robots: { index: false } };
}

// The week: every open item by day, with "needs your action" first.
export default function WeekPage() {
  return <HomeView />;
}
