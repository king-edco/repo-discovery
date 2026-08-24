"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, LogOut, MessageSquare, UserRound } from "lucide-react";
import { signOut, updateUser, useSession } from "@/lib/auth-client";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

/** Name / email / plan / logout card. */
export function AccountSettings() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const user = session?.user as
    | { name: string; email: string; plan?: string }
    | undefined;
  const plan = user?.plan === "pro" ? "pro" : "free";

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from session on load
    if (user) setName(user.name);
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("upgraded") === "1") setNotice(t.settings.upgraded);
    if (sp.get("upgrade") === "cancelled") setNotice(t.settings.upgradeCancelled);
  }, [user]);

  async function saveName() {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    await updateUser({ name: trimmed });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function upgrade() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else setNotice(data.error ?? t.settings.billingUnavailable);
    } finally {
      setUpgrading(false);
    }
  }

  async function logout() {
    await signOut();
    router.push("/");
    router.refresh();
  }

  if (isPending || !user) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-muted text-foreground">
            <UserRound className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">{t.settings.account}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
            plan === "pro" ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
          }`}
        >
          {plan === "pro" && <Crown className="size-3" />}
          {plan === "pro" ? t.settings.planPro : t.settings.planFree}
        </span>
      </div>

      {notice && (
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{notice}</p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          aria-label={t.settings.name}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void saveName()}
          className="shrink-0 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          {saved ? t.settings.savedName : t.common.save}
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {plan === "free" && (
          <button
            type="button"
            onClick={() => void upgrade()}
            disabled={upgrading}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
          >
            <Crown className="size-4" />
            {t.settings.upgrade}
          </button>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex items-center gap-2 rounded-full border border-input px-4 py-2 text-sm hover:bg-muted"
        >
          <LogOut className="size-4" />
          {t.nav.logout}
        </button>
      </div>
    </div>
  );
}

/** "Tell the owner" card — messages land in FEEDBACK_INBOX_EMAIL. */
export function FeedbackSettings() {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function send() {
    if (message.trim().length < 3) return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error();
      setMessage("");
      setState("sent");
    } catch {
      setState("error");
    } finally {
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-muted text-foreground">
          <MessageSquare className="size-4" />
        </span>
        <p className="text-sm font-medium text-foreground">{t.settings.feedbackTitle}</p>
      </div>
      <textarea
        value={message}
        maxLength={2000}
        rows={3}
        placeholder={t.settings.feedbackPlaceholder}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === "sending" || message.trim().length < 3}
        className="mt-2 rounded-full bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
      >
        {state === "sent" ? t.settings.feedbackSent : t.settings.feedbackSend}
      </button>
      {state === "error" && (
        <p className="mt-2 text-xs text-red-600">{t.common.error}</p>
      )}
    </div>
  );
}
