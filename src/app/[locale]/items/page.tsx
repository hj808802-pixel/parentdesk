import type { Metadata } from "next";
import ItemsView from "@/components/ItemsView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.items.title, robots: { index: false } };
}

export default function ItemsPage() {
  return <ItemsView />;
}
