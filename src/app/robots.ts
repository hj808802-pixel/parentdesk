import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://parentdesk-app.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/items", "/*/items", "/sources", "/*/sources", "/settings", "/*/settings"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
