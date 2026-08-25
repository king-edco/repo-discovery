import type { MetadataRoute } from "next";

// Only public (pre-login) pages belong in the sitemap — the feed, settings
// and other authed routes would just bounce crawlers to /login.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];
}
