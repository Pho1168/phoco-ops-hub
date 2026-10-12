import Image from "next/image";
import { Icon } from "@/components/Icon";
import type { Photo, SopBody } from "@/lib/domain/library";

/** A step's photo, served to signed-in people only. */
export function StepPhoto({ photo, alt }: { photo: Photo; alt: string }) {
  return <Image className="sop-photo" src={`/api/media/${photo.id}`} width={photo.w} height={photo.h} alt={alt} unoptimized />;
}

/** The SOP itself: what it's for, then the numbered steps with their warnings and photos. */
export function SopView({ body, title }: { body: SopBody; title: string }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      {body.purpose && <section className="card stack" style={{ gap: 6 }} aria-label="Purpose"><h2 className="h-sec">What it&apos;s for</h2><div className="sop-purpose">{body.purpose}</div></section>}
      <ol className="sop-steps" aria-label={`Steps: ${title}`}>
        {body.steps.map((s, i) => (
          <li key={i} className="sop-step">
            <span className="sop-num" aria-hidden="true">{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <span className="sr-only">Step {i + 1}: </span>
              <div className="sop-text">{s.text}</div>
              {s.warning && <div className="sop-warn" role="note"><Icon name="alert" /><span>{s.warning}</span></div>}
              {s.photo && <StepPhoto photo={s.photo} alt={`Step ${i + 1}`} />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
