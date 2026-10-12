"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { endNotice } from "@/app/actions";

export function TakeDown({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn ghost small" disabled={pending}
      onClick={() => { if (confirm(`Take down "${title}"? It stops showing to staff. The read record is kept.`)) start(async () => { const r = await endNotice(id); if (!r.ok) alert(r.error); router.refresh(); }); }}>
      Take down
    </button>
  );
}
