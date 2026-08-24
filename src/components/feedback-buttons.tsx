"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, X, Info } from "lucide-react";
import { useFeedback } from "@/lib/use-user";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

export function FeedbackButtons({ repoId }: { repoId: string }) {
  const { liked, disliked, vote, removeVote } = useFeedback();
  const [modal, setModal] = useState<null | "like" | "dislike">(null);
  const [customReason, setCustomReason] = useState("");

  const isLiked = liked.includes(repoId);
  const isDisliked = disliked.includes(repoId);

  const handleVote = (type: "like" | "dislike") => {
    if (type === "like" && isLiked) { void removeVote(repoId); return; }
    if (type === "dislike" && isDisliked) { void removeVote(repoId); return; }
    setModal(type);
  };

  const submitReason = async (reason: string) => {
    if (modal) {
      await vote(repoId, modal, reason || undefined);
      setModal(null);
      setCustomReason("");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => handleVote("like")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            isLiked
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-border bg-card text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-600"
          }`}
          aria-label={t.feedback.useful}
          aria-pressed={isLiked}
        >
          <ThumbsUp className="size-4" />
          {t.feedback.useful}
        </button>
        <button
          type="button"
          onClick={() => handleVote("dislike")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            isDisliked
              ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
              : "border-border bg-card text-muted-foreground hover:border-rose-500/30 hover:text-rose-600"
          }`}
          aria-label={t.feedback.notUseful}
          aria-pressed={isDisliked}
        >
          <ThumbsDown className="size-4" />
          {t.feedback.notUseful}
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" />
          {t.feedback.thanksNote}
        </span>
      </div>

      {modal ? (
        <ReasonModal
          type={modal}
          customReason={customReason}
          onReason={setCustomReason}
          onSubmit={submitReason}
          onClose={() => { setModal(null); setCustomReason(""); }}
        />
      ) : null}
    </>
  );
}

function ReasonModal({
  type,
  customReason,
  onReason,
  onSubmit,
  onClose,
}: {
  type: "like" | "dislike";
  customReason: string;
  onReason: (v: string) => void;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const reasons = type === "like" ? t.feedback.likeReasons : t.feedback.dislikeReasons;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {type === "like" ? t.feedback.whyLikeTitle : t.feedback.whyDislikeTitle}
          </h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t.common.back}>
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {reasons.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onSubmit(r)}
              className="rounded-lg border border-border px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
            >
              {r}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <input
            type="text"
            value={customReason}
            onChange={(e) => onReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && customReason.trim()) onSubmit(customReason.trim()); }}
            placeholder={t.feedback.customPlaceholder}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onSubmit("")}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            {t.feedback.skipReason}
          </button>
          {customReason.trim() ? (
            <button
              type="button"
              onClick={() => onSubmit(customReason.trim())}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t.feedback.submitReason}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
