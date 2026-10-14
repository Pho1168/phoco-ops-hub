"use client";

import { useEffect, useState } from "react";
import { londonHM } from "@/lib/domain/time";

/** The time in London, kept up to date. Empty until the page has loaded, so the server and browser agree. */
export function Clock({ className = "top-clock" }: { className?: string }) {
  const [hm, setHm] = useState("");
  useEffect(() => {
    const tick = () => setHm(londonHM(Date.now()));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  return <time className={className} aria-label={hm ? `The time is ${hm}` : undefined}>{hm}</time>;
}
