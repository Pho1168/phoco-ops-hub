"use client";

import { useEffect, useState, useTransition } from "react";
import { disableReminders, enableReminders } from "@/app/actions";

type State = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

function keyToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function RemindersToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState(ios && !standalone ? "ios-install" : "unsupported"); return; }
      if (Notification.permission === "denied") { setState("blocked"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = () => start(async () => {
    setErr("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
      const r = await enableReminders(sub.toJSON());
      if (!r.ok) { setErr(r.error); await sub.unsubscribe(); return; }
      setState("on");
    } catch {
      setErr("This phone couldn't turn on notifications. Try again, or check the browser's notification settings.");
    }
  });
  const turnOff = () => start(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await disableReminders(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
  });

  if (state === "checking") return null;
  return (
    <section className={`alert ${state === "on" ? "good" : ""}`} style={{ alignItems: "flex-start" }}>
      <div className="grow stack" style={{ gap: 6 }}>
        {state === "on" && <><div className="strong">Reminders are on</div><div style={{ fontSize: 13 }}>The evening before each shift (18:00) and when your rota changes.</div></>}
        {state === "off" && <><div className="strong">Get reminders on this phone</div><div style={{ fontSize: 13 }}>A message the evening before each shift, and when your rota changes. Nothing between 22:00 and 08:00.</div></>}
        {state === "blocked" && <><div className="strong">Notifications are blocked</div><div style={{ fontSize: 13 }}>Allow notifications for this site in your browser settings, then reload this page.</div></>}
        {state === "ios-install" && <><div className="strong">On iPhone: add to Home Screen first</div><div style={{ fontSize: 13 }}>Tap Share, then &quot;Add to Home Screen&quot;. Open PHO &amp; CO from your home screen and turn reminders on there.</div></>}
        {state === "unsupported" && <><div className="strong">This browser can&apos;t show reminders</div><div style={{ fontSize: 13 }}>Use Chrome on Android, or Safari on iPhone after adding to Home Screen. Your messages still appear below.</div></>}
        {err && <div className="err" role="alert">{err}</div>}
      </div>
      {state === "off" && <button className="btn accent small" type="button" disabled={pending} onClick={turnOn}>Turn on</button>}
      {state === "on" && <button className="btn ghost small" type="button" disabled={pending} onClick={turnOff}>Turn off</button>}
    </section>
  );
}
