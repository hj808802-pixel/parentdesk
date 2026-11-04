import type { MetadataRoute } from "next";

// Installable on a phone home screen ("Add to Home Screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ParentDesk: school notices into your family calendar",
    short_name: "ParentDesk",
    description:
      "Snap a photo of the newsletter or paste the class message and get the dates, forms, fees and things to bring, sorted by child, with a calendar feed.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#4f46e5",
    lang: "en",
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
