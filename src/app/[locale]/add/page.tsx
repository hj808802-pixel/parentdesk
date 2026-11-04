import type { Metadata } from "next";
import { Suspense } from "react";
import AddNotice from "@/components/AddNotice";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.add.title };
}

export default function AddPage() {
  return (
    <Suspense fallback={null}>
      <AddNotice />
    </Suspense>
  );
}
