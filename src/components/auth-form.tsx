"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { signIn, signUp } from "@/lib/auth-client";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

export type OAuthProvider = "github" | "google";

export function AuthForm({
  mode,
  providers,
}: {
  mode: "login" | "signup";
  providers: OAuthProvider[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = isSignup
        ? await signUp.email({ name, email, password })
        : await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Authentication failed.");
        return;
      }
      router.push("/feed");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function onOAuth(provider: OAuthProvider) {
    setError(null);
    await signIn.social({ provider, callbackURL: "/feed" });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center justify-center gap-2 font-semibold">
        <Sparkles className="size-5" />
        {t.common.appName}
      </div>
      <h1 className="text-center text-2xl font-bold">
        {isSignup ? t.auth.signupTitle : t.auth.loginTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {isSignup ? t.auth.signupSubtitle : t.auth.loginSubtitle}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {isSignup && (
          <input
            type="text"
            required
            maxLength={80}
            placeholder={t.auth.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm"
          />
        )}
        <input
          type="email"
          required
          maxLength={200}
          placeholder={t.auth.email}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm"
        />
        <input
          type="password"
          required
          minLength={8}
          maxLength={128}
          placeholder={t.auth.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm"
        />
        {isSignup && (
          <p className="text-xs text-muted-foreground">{t.auth.passwordHint}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-foreground py-2.5 text-sm text-background disabled:opacity-50"
        >
          {isSignup ? t.auth.signup : t.auth.login}
        </button>
      </form>

      {providers.length > 0 && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {t.auth.orContinueWith}
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className={`grid gap-3 ${providers.length > 1 ? "grid-cols-2" : ""}`}>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void onOAuth(p)}
                className="rounded-full border py-2.5 text-sm capitalize hover:bg-muted"
              >
                {p}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {isSignup ? t.auth.haveAccount : t.auth.noAccount}{" "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="underline underline-offset-4"
        >
          {isSignup ? t.auth.login : t.auth.signup}
        </Link>
      </p>
    </main>
  );
}
