import { NextResponse, type NextRequest } from "next/server";
import { BRANDS, isBrandId } from "@/lib/domain/brand";

/** The installable app's name for the business (`?b=clv`); PHO & CO otherwise. Icons are shared until each has its own. */
export function GET(req: NextRequest) {
  const b = req.nextUrl.searchParams.get("b");
  const brand = BRANDS[isBrandId(b) ? b : "phoco"];
  const body = {
    name: `${brand.name} Ops Hub`,
    short_name: brand.name,
    start_url: "/",
    display: "standalone",
    background_color: "#F2EEE8",
    theme_color: brand.colours?.brand ?? "#2C6E63",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  return new NextResponse(JSON.stringify(body), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
