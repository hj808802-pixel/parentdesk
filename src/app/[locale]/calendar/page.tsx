import type { Metadata } from "next";
import CalendarView from "@/components/CalendarView";
import { getDict } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDict((await params).locale);
  return { title: t.calendar.title, robots: { index: false } };
}

// The month view.
export default function CalendarPage() {
  return <CalendarView />;
}
