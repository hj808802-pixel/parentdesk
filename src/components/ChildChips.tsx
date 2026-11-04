"use client";

import type { Child } from "@/lib/store";

// Small coloured name tags. `selected` + `onToggle` turn them into a picker.
export default function ChildChips({
  childrenList,
  ids,
  selected,
  onToggle,
  emptyLabel,
}: {
  childrenList: Child[];
  ids?: string[];
  selected?: string[];
  onToggle?: (id: string) => void;
  emptyLabel?: string;
}) {
  const picker = Boolean(onToggle);
  const shown = picker ? childrenList : childrenList.filter((c) => ids?.includes(c.id));
  if (!picker && shown.length === 0) return emptyLabel ? <span className="text-xs text-zinc-500">{emptyLabel}</span> : null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((c) => {
        const on = picker ? selected?.includes(c.id) : true;
        const style = on ? { backgroundColor: c.color, color: "#fff", borderColor: c.color } : { borderColor: c.color, color: c.color };
        const cls = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";
        return picker ? (
          <button key={c.id} type="button" aria-pressed={on} onClick={() => onToggle?.(c.id)} className={cls} style={style}>
            {c.name}
          </button>
        ) : (
          <span key={c.id} className={cls} style={style}>
            {c.name}
          </span>
        );
      })}
    </span>
  );
}
