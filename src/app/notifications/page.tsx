"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, CheckCheck } from "lucide-react";
import { notificationHref, type NotificationItem } from "@/components/notification-bell";

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { notifications: NotificationItem[] };
        setItems(data.notifications);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/feed"
              className="inline-flex size-8 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
              <Bell className="size-5" />
              Notifications
            </h1>
          </div>
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="inline-flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No notifications yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={notificationHref(n)}
                  className={`block rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 ${
                    n.read ? "opacity-70" : ""
                  }`}
                >
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
