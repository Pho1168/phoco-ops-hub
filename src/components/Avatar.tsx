import { initials } from "@/lib/domain/names";
import type { Tone } from "@/lib/domain/login";

/** Someone's initials in a circle, coloured by lane: amber for front of house, teal for kitchen and production, green for leads. */
export function Avatar({ name, tone, size, className = "" }: { name: string; tone?: Tone; size?: number; className?: string }) {
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined;
  return <span className={`avatar ${tone ? `tone-${tone}` : ""} ${className}`.trim()} style={style} aria-hidden>{initials(name)}</span>;
}
