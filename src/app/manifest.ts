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
    // Android: "Share" from any app (a screenshot, a photo, a message) lands on /api/share
    // and is added to the family. iOS does not support share targets for web apps.
    share_target: {
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "files", accept: ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] }],
      },
    },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
