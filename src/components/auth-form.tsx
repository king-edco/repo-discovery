"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Code2, Globe, Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { signIn, signUp } from "@/lib/auth-client";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

export type OAuthProvider = "github" | "google";

const PROVIDER_META: Record<OAuthProvider, { label: string; Icon: typeof Code2 }> = {
  github: { label: "GitHub", Icon: Code2 },
  google: { label: "Google", Icon: Globe },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Submit activates only when every visible field is filled and valid.
  const formValid =
    EMAIL_RE.test(email.trim()) &&
    password.length >= 8 &&
    (!isSignup || name.trim().length > 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid || loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = isSignup
        ? await signUp.email({ name: name.trim(), email: email.trim(), password })
        : await signIn.email({ email: email.trim(), password });
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
      <Link href="/" className="mb-8 flex items-center justify-center gap-2 font-semibold">
        <Logo className="size-7" />
        {t.common.appName}
      </Link>
      <h1 className="text-center text-2xl font-bold">
        {isSignup ? t.auth.signupTitle : t.auth.loginTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {isSignup ? t.auth.signupSubtitle : t.auth.loginSubtitle}
      </p>

      {/* Social sign-in — always visible; unconfigured providers show a hint. */}
      <div className={`mt-8 grid gap-3 ${providers.length > 1 ? "grid-cols-2" : ""}`}>
        {providers.map((p) => {
          const { label, Icon } = PROVIDER_META[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => void onOAuth(p)}
              className="inline-flex items-center justify-center gap-2 rounded-full border py-2.5 text-sm font-medium hover:bg-muted"
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>
      {providers.length === 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t.auth.providersHint}
        </p>
      )}

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        {isSignup ? t.auth.orSignupWithEmail : t.auth.orLoginWithEmail}
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {isSignup && (
          <input
            type="text"
            required
            maxLength={80}
            autoComplete="name"
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
          autoComplete="email"
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
          autoComplete={isSignup ? "new-password" : "current-password"}
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
          disabled={!formValid || loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-sm text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {isSignup ? t.auth.signup : t.auth.login}
        </button>
      </form>

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
