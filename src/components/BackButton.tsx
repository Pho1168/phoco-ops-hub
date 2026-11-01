"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

/**
 * The back arrow at the start of every screen's top bar (phone and desktop): goes back one step, like the browser's
 * back button. Opened fresh with nothing to go back to (a link, the installed app), it goes to the home screen.
 */
export function BackButton() {
  const router = useRouter();
  return (
    <button type="button" className="pill-btn top-back" aria-label="Back" onClick={() => {
      if (window.history.length > 1) router.back(); else router.push("/");
    }}><Icon name="back" /></button>
  );
}
