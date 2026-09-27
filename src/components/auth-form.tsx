"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

type AuthMode = "signin" | "signup";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/map";
}

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const configured = Boolean(getSupabaseConfig());
  const [mode, setMode] = useState<AuthMode>(
    searchParams.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") || null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const nextPath = useMemo(
    () => safeNextPath(searchParams.get("next")),
    [searchParams],
  );

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setMessage(null);
    const query = new URLSearchParams();
    query.set("mode", nextMode);
    if (nextPath !== "/map") query.set("next", nextPath);
    router.replace(`/auth?${query.toString()}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });

        if (signUpError) throw signUpError;

        if (data.session) {
          router.replace(nextPath);
          router.refresh();
        } else {
          setMessage("Check your email to confirm your account, then come back to Wrap.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;
        router.replace(nextPath);
        router.refresh();
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We couldn't complete that request. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-atmosphere" aria-hidden="true">
        <span className="auth-orb auth-orb-one" />
        <span className="auth-orb auth-orb-two" />
      </div>
      <header className="auth-header">
        <Link href="/" className="auth-brand" aria-label="Wrap home">
          <span className="auth-brand-mark" aria-hidden="true">
            <span className="auth-brand-mark-line" />
            <span className="auth-brand-mark-dot" />
          </span>
          <span>Wrap</span>
        </Link>
        <Link href="/" className="auth-back-link">
          <ArrowLeft size={15} aria-hidden="true" />
          Back home
        </Link>
      </header>

      <section className="auth-layout" aria-labelledby="auth-title">
        <div className="auth-intro">
          <h1 id="auth-title">
            {mode === "signup" ? "Make every route count." : "Welcome back to Wrap."}
          </h1>
          <p>
            Sign in to plan trips and keep your routes close when the city takes
            an unexpected turn.
          </p>
        </div>

        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="Account action">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              className={mode === "signin" ? "auth-tab active" : "auth-tab"}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "auth-tab active" : "auth-tab"}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>

          {!configured ? (
            <div className="auth-setup-message" role="status">
              <strong>Authentication is almost ready.</strong>
              <p>
                Add your Supabase project URL and publishable key to
                <code>.env.local</code> to enable accounts locally.
              </p>
            </div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              <div className="auth-form-heading">
                <h2>{mode === "signup" ? "Create your account" : "Sign in to continue"}</h2>
              </div>

              <label className="auth-field">
                <span>Email address</span>
                <span className="auth-input-wrap">
                  <Mail size={17} aria-hidden="true" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </span>
              </label>

              <label className="auth-field">
                <span>Password</span>
                <span className="auth-input-wrap">
                  <LockKeyhole size={17} aria-hidden="true" />
                  <input
                    type="password"
                    name="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    placeholder="At least 6 characters"
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </span>
              </label>

              {error ? (
                <p className="auth-feedback error" role="alert">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="auth-feedback success" role="status">
                  {message}
                </p>
              ) : null}

              <button className="auth-submit" type="submit" disabled={pending}>
                {pending ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
                {pending
                  ? mode === "signup"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
