import type { Metadata } from "next";
import PricingView from "@/components/PricingView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.pricing.title, description: t.pricing.lead };
}

export default function PricingPage() {
  return <PricingView />;
}
