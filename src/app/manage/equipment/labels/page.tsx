import { headers } from "next/headers";
import QRCode from "qrcode";
import { store } from "@/lib/data";
import { requireManager } from "@/lib/session";
import { pickSite } from "../../load";
import { PrintButton } from "@/app/manage/records/PrintButton";

export const dynamic = "force-dynamic";

/** Printable QR labels: one per piece of kit. Scanning opens its page to see how to use it or report a problem. */
export default async function Labels(props: { searchParams: Promise<{ site?: string }> }) {
  const searchParams = await props.searchParams;
  const ctx = await requireManager();
  const { site } = await pickSite(ctx.managed, searchParams.site, ctx.site.id);
  const items = await store().equipment(site.id);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "phoco-ops-hub.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const labels = await Promise.all(items.map(async (eq) => ({
    eq, svg: await QRCode.toString(`${proto}://${host}/equipment/${eq.id}`, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#22272A", light: "#FFFFFF" } }),
  })));

  return (
    <main className="wide labels-page">
      <div className="row wrap no-print" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <div className="eyebrow">Equipment · {site.name}</div>
          <h1 className="h-display">QR labels</h1>
          <div className="muted">Print, cut out and stick each label on its equipment. Scanning one opens that equipment in the app, to see how to use it or report a problem. The codes point to {host}.</div>
        </div>
        <PrintButton />
      </div>
      {labels.length === 0 && <div className="card muted">No equipment at {site.name} yet.</div>}
      <div className="labels">
        {labels.map(({ eq, svg }) => (
          <div key={eq.id} className="label">
            <div className="label-qr" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="label-text">
              <div className="logo" style={{ color: "var(--brand)", fontSize: 14 }}>PHO &amp; CO</div>
              <div className="strong" style={{ fontSize: 16, lineHeight: 1.2 }}>{eq.name}</div>
              {eq.location && <div className="muted" style={{ fontSize: 12 }}>{eq.location}</div>}
              <div style={{ fontSize: 12, marginTop: 4 }}>Not working? Scan to report it.</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
