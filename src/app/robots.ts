import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Auth-gated app pages carry per-user data — nothing useful to index,
      // and crawling them wastes the crawl budget on redirects to /login.
      disallow: ["/feed", "/settings", "/saved", "/notifications", "/repos/", "/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
