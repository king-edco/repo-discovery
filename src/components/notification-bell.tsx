"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  repoId: string | null;
  read: boolean;
  createdAt: string;
};

export function notificationHref(n: NotificationItem): string {
  return n.repoId ? `/repos/${encodeURIComponent(n.repoId)}` : "/feed";
}

// Bell with unread badge; opens a small dropdown of recent notifications.
// Refreshes on mount and when the tab regains focus.

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: NotificationItem[]; unread: number };
      setItems(data.notifications);
      setUnread(data.unread);
    } catch {
      /* offline — keep last state */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function openDropdown() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
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
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void openDropdown()}
        aria-label="Notifications"
        className="relative inline-flex size-9 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-border bg-card p-2 shadow-lg">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t.notifications.empty}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={notificationHref(n)}
                    onClick={() => setOpen(false)}
                    className={`block rounded-xl px-3 py-2 hover:bg-muted ${n.read ? "opacity-70" : ""}`}
                  >
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-xl px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted"
          >
            {t.common.seeAll}
          </Link>
        </div>
      )}
    </div>
  );
}
