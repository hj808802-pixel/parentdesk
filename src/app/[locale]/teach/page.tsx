import type { Metadata } from "next";
import TeachView from "@/components/TeachView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.teach.title, description: t.teach.lead };
}

export default function TeachPage() {
  return <TeachView />;
}
