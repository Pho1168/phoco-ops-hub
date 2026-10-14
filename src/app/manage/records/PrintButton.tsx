"use client";

export function PrintButton({ className = "btn small" }: { className?: string }) {
  return <button type="button" className={className} onClick={() => window.print()}>Print or save as PDF</button>;
}
