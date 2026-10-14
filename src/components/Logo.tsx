const SRC = { symbol: "/brand/logo-symbol.png", stacked: "/brand/logo-stacked.png", wide: "/brand/logo-wide.png" } as const;

/** The PHO & CO logo: the hat-and-bowl symbol, the stacked lock-up or the wide one. Plain PNGs under public/brand. */
export function Logo({ kind = "symbol", className = "" }: { kind?: keyof typeof SRC; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={SRC[kind]} alt="PHO & CO" />;
}
