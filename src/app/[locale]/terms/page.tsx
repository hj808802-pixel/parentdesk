import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.legal.termsTitle };
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
