import type { Metadata } from "next";
import { Suspense } from "react";
import JoinView from "@/components/JoinView";
import { getDict } from "@/lib/i18n";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// Three flows share this page: a partner's invite link (?i=), a teacher's room link (?r=),
// and, with neither, "find your class" (search the school, enter the class code).
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = getDict((await params).locale);
  const sp = await searchParams;
  return { title: sp.r ? t.join.roomTitle : sp.i ? t.join.title : t.join.findTitle, robots: { index: false } };
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinView />
    </Suspense>
  );
}
