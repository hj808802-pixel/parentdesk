import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The upload input may open the camera on phones; nothing else is needed.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  turbopack: {
    // A stray package-lock.json in the home directory would otherwise move the root up.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The extractor reads the country notes from disk at request time; make sure they ship
  // with the serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/api/extract": ["./knowledge/**/*"],
    "/api/inbound": ["./knowledge/**/*"],
    "/api/share": ["./knowledge/**/*"],
    "/api/google/scan": ["./knowledge/**/*"],
    "/api/cron/scan": ["./knowledge/**/*"],
    "/api/teacher/rooms/[id]/post": ["./knowledge/**/*"],
    "/api/health": ["./knowledge/**/*"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
