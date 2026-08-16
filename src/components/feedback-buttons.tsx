"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { useFeedback } from "@/lib/use-user";

const LIKE_REASONS = [
  "Utile pour mon projet",
  "Bien expliqué, accessible",
  "Bonne idée de business",
  "Technologie intéressante",
  "Documentation claire",
] as const;

const DISLIKE_REASONS = [
  "Trop technique",
  "Pas pertinent",
  "Idée de business faible",
  "Documentation confuse",
  "Trop complexe",
] as const;

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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleVote("like")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            isLiked
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-border bg-card text-muted-foreground hover:border-emerald-500/30 hover:text-emerald-600"
          }`}
          aria-label="Utile"
          aria-pressed={isLiked}
        >
          <ThumbsUp className="size-4" />
          Utile
        </button>
        <button
          type="button"
          onClick={() => handleVote("dislike")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            isDisliked
              ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
              : "border-border bg-card text-muted-foreground hover:border-rose-500/30 hover:text-rose-600"
          }`}
          aria-label="Pas utile"
          aria-pressed={isDisliked}
        >
          <ThumbsDown className="size-4" />
          Pas utile
        </button>
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
  const reasons = type === "like" ? LIKE_REASONS : DISLIKE_REASONS;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {type === "like" ? "Qu'est-ce qui a été utile ?" : "Qu'est-ce qui n'a pas marché ?"}
          </h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fermer">
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
            placeholder="Autre raison (optionnel)…"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>
        {customReason.trim() ? (
          <button
            type="button"
            onClick={() => onSubmit(customReason.trim())}
            className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Envoyer
          </button>
        ) : null}
      </div>
    </div>
  );
}
