import type { Dict } from "./i18n";
import { fmt } from "./i18n";

// How a class is written for parents and teachers: "Grade 3, class 2" in the UI language.
// Client-safe (no Node); the room records keep grade and class as free text.

export function gradeClassLabel(t: Dict, grade: string, classLabel: string): string {
  if (grade && classLabel) return fmt(t.teach.gradeClass, { g: grade, c: classLabel });
  if (grade) return fmt(t.teach.gradeOnly, { g: grade });
  if (classLabel) return fmt(t.teach.classOnly, { c: classLabel });
  return "";
}

// "Hanbit Elementary (Seoul Gangnam)": the place tells two schools of one name apart.
export function schoolLabel(s: { school: string; region?: string; city?: string }): string {
  const place = [s.region, s.city].filter(Boolean).join(" ");
  return s.school ? (place ? `${s.school} (${place})` : s.school) : "";
}

// "<school (place)> · <grade/class> · <room name>", skipping what is empty and a room name
// that only repeats the class.
export function roomLine(t: Dict, room: { school: string; region?: string; city?: string; grade: string; classLabel: string; name: string }): string {
  const cls = gradeClassLabel(t, room.grade, room.classLabel);
  const parts = [schoolLabel(room), cls];
  if (room.name && room.name !== cls) parts.push(room.name);
  return parts.filter(Boolean).join(" · ");
}
