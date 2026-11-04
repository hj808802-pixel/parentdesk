import { addDays, nextWeekday, startOfWeek, weekday } from "./dates";

// The bundled sample newsletter, used by "Try with a sample". It is generated for the
// family's "today" so its weekdays and dates always agree, the way a real newsletter
// would when it arrives. public/sample-notice.png shows the same letter for one week.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function label(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${DAYS[weekday(iso)]}, ${MONTHS[m - 1]} ${d}`;
}

export function sampleDates(todayIso: string) {
  const friday = nextWeekday(addDays(todayIso, 3), 5);
  const wednesday = addDays(friday, -2);
  const tuesdayAfter = nextWeekday(addDays(friday, 1), 2);
  const thursdayAfter = addDays(tuesdayAfter, 2);
  const monday = nextWeekday(addDays(todayIso, 1), 1);
  const breakThursday = addDays(thursdayAfter, 7);
  return { weekOf: startOfWeek(addDays(todayIso, 1), 1), friday, wednesday, tuesdayAfter, thursdayAfter, monday, breakThursday, breakFriday: addDays(breakThursday, 1) };
}

export function sampleNotice(todayIso: string): string {
  const d = sampleDates(todayIso);
  const [, wm, wd] = d.weekOf.split("-").map(Number);
  return `Subject: Room 12 News - Week of ${MONTHS[wm - 1]} ${wd}

Oak Street Elementary - Room 12 News

Hello families,

Field trip to the Science Museum: ${label(d.friday)}. Bus leaves at 8:30 AM sharp. Please pack a bag lunch and a water bottle. Permission slip and $12 due by ${label(d.wednesday)}.

Picture Day is ${label(d.tuesdayAfter)}. Order forms went home today.

Parent-teacher conferences: ${label(d.thursdayAfter)}, 3:30-7:00 PM. Sign up online by Monday.

Reminder: library books are due every Monday. PE is Tuesdays and Thursdays - sneakers please!

No school ${label(d.breakThursday)} and ${label(d.breakFriday)} (fall break).

Thank you!
Ms. Rivera`;
}
