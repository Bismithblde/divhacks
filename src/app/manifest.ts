import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Wrap",
    short_name: "Wrap",
    description: "A map-first NYC route autopilot that adapts to disruptions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icons/wrap-light.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/wrap-dark.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
  };
}
