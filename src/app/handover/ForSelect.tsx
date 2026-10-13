"use client";

import type { PickGroup } from "@/lib/domain/assign";

/**
 * Who a handover item is for: anyone, then the people working that shift (with their times), then everyone else at
 * the site. `current` names whoever it's for now if they're no longer on the list (they've left the site or are
 * frozen), so it shows until someone picks again.
 */
export function ForSelect({ value, current, pick, label, onChange, disabled, id }: {
  value: string; current?: string; pick: PickGroup[]; label: string; onChange: (to: string | null) => void; disabled?: boolean; id?: string;
}) {
  const known = !value || pick.some((g) => g.people.some((p) => p.id === value));
  return (
    <select id={id} value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Anyone</option>
      {!known && <option value={value}>{current ?? "Someone"} (not here now)</option>}
      {pick.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.people.map((p) => <option key={p.id} value={p.id}>{p.times ? `${p.name} · ${p.times}` : p.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** A short name for an item, for a screen reader label: "For: Cook rice". */
export const forLabelOf = (title: string) => `For: ${title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title}`;
