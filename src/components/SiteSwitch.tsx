"use client";

import { useTransition } from "react";
import { switchSite } from "@/app/actions";

/**
 * For owners and operations managers: which site (and so which business) they're working at, from any screen.
 * Sites are grouped by business; picking one moves the session there and stays on the same screen.
 */
export function SiteSwitch({ current, groups }: { current: string; groups: { name: string; sites: { id: string; name: string }[] }[] }) {
  const [pending, start] = useTransition();
  return (
    <label className="site-switch" title="Switch site">
      <span className="sr-only">Working at</span>
      <select value={current} disabled={pending} aria-label="Working at"
        onChange={(e) => { const id = e.target.value; start(() => switchSite(id, `${window.location.pathname}${window.location.search}`)); }}>
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
