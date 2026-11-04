import type { Metadata } from "next";
import SettingsView from "@/components/SettingsView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.settings.title, robots: { index: false } };
}

export default function SettingsPage() {
  return <SettingsView />;
}
