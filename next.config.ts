import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

// Global security headers. script-src needs 'unsafe-inline' for the inline
// anti-FOUC theme script and Next's bootstrap scripts; img-src allows remote
// images because README markdown renders images hosted anywhere. HSTS is only
// sent in production (the app is served over HTTPS there).
// connect-src adds the PostHog host only when analytics is configured, so the
// CSP stays tight for self-hosters who don't enable it.
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com")
  : null;
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      `connect-src 'self'${posthogHost ? ` ${posthogHost}` : ""}`,
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  serverExternalPackages: [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "sqlite-vec",
    "sqlite-vec-linux-x64",
    "sqlite-vec-darwin-x64",
    "sqlite-vec-darwin-arm64",
    "sqlite-vec-windows-x64",
    "sqlite-vec-linux-arm64",
  ],
  allowedDevOrigins: [
    "work-1-tnbtljnnujksftmu.prod-runtime.all-hands.dev",
    "work-2-tnbtljnnujksftmu.prod-runtime.all-hands.dev",
  ],
};

export default withSerwist(nextConfig);
