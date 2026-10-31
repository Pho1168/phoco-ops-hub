import type { Metadata, Viewport } from "next";
import "./globals.css";
import { requestBrand } from "@/lib/brand-service";

/** Named after the business of the site in use (PHO & CO or Cafe La Viet); "Ops Hub" before anyone signs in. */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await requestBrand();
  const name = brand ? `${brand.name} Ops Hub` : "Ops Hub";
  return {
    title: name,
    description: `Checklists, food safety and shift handover${brand ? ` for ${brand.name}` : ""}`,
    manifest: `/manifest.webmanifest${brand && brand.id !== "phoco" ? `?b=${brand.id}` : ""}`,
    icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: brand?.name ?? "Ops Hub", statusBarStyle: "default" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const brand = await requestBrand();
  return { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: brand?.colours?.brand ?? "#2C6E63", colorScheme: "light" };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
