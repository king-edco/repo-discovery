"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// PostHog analytics. Active only when NEXT_PUBLIC_POSTHOG_KEY is set — the
// app runs analytics-free otherwise. Pageviews are captured on route change.

let started = false;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || started) return;
    started = true;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false, // handled manually below
    });
  }, []);

  useEffect(() => {
    if (!started) return;
    const qs = searchParams?.toString();
    posthog.capture("$pageview", { $current_url: pathname + (qs ? `?${qs}` : "") });
  }, [pathname, searchParams]);

  return <>{children}</>;
}
