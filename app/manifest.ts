import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arciin",
    short_name: "Arciin",
    description: "Your server, your control.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "portrait-primary",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/assets/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/assets/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Dashboard",
        url: "/dashboard",
        description: "Go to overview",
      },
      {
        name: "Files",
        url: "/files",
        description: "Browse all files",
      },
      {
        name: "Upload",
        url: "/uploads",
        description: "Upload files",
      },
    ],
  }
}
