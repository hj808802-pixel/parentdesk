import type { Metadata } from "next";
import { Suspense } from "react";
import JoinView from "@/components/JoinView";
import { getDict } from "@/lib/i18n";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// Two flows share this page: a partner's invite link (?i=) and a teacher's room link (?r=).
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = getDict((await params).locale);
  const room = (await searchParams).r;
  return { title: room ? t.join.roomTitle : t.join.title, robots: { index: false } };
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinView />
    </Suspense>
  );
}
