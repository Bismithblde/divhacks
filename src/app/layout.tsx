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
  title: "Wrap | NYC route autopilot",
  description:
    "Find a way across New York City, then adapt when transit or street conditions change.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Wrap" },
  icons: {
    icon: { url: "/icons/wrap-tab.jpg", type: "image/jpeg" },
    shortcut: { url: "/icons/wrap-tab.jpg", type: "image/jpeg" },
    apple: { url: "/icons/wrap-light.png", type: "image/png" },
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${switzer.variable} antialiased`}
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("blockednyc-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){}})();`,
          }}
        />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
