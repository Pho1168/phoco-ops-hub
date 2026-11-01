"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icon } from "./Icon";

/** Loads the screen again from the app's records (e.g. the rota just sent from the sheet), without leaving it. */
export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn ghost small" disabled={pending} aria-busy={pending} onClick={() => start(() => router.refresh())}>
      <Icon name="refresh" />{pending ? "Refreshing…" : label}
    </button>
  );
}
