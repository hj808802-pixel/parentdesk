import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
// Everything the app loads comes from its own origin (fonts are self-hosted, images are its
// own or picked by the user). Inline scripts stay allowed because the framework emits them;
// the rest shuts out foreign scripts, frames, plugins and form targets.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
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
    "/api/hook/[token]": ["./knowledge/**/*"],
    "/api/health": ["./knowledge/**/*"],
  },
  async headers() {
    const hidden = [
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "no-store" },
    ];
    return [
      { source: "/(.*)", headers: securityHeaders },
      // The operator console is never for search engines or shared caches.
      { source: "/admin/:path*", headers: hidden },
      { source: "/admin", headers: hidden },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
