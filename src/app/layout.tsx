import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ServiceWorker } from "@/components/service-worker";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const switzer = localFont({
  src: [
    {
      path: "../../public/fonts/switzer-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/switzer-500.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/fonts/switzer-600.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-switzer",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NYC closure map | DivHacks",
  description:
    "Explore official NYC event and construction closure schedules on a walking-first map.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "DivHacks" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${switzer.variable} antialiased`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
