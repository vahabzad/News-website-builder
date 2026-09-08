"use client";

import { FormEvent, useState } from "react";
import { api } from "../lib/api";

export default function AuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ token: string }>(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      localStorage.setItem("news-builder-token", result.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطای ناشناخته");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card glass">
        <div className="brand-mark">✦</div>
        <div>
          <span className="eyebrow">AI NEWS BUILDER</span>
          <h1>{mode === "login" ? "ورود به حساب کاربری" : "ساخت حساب جدید"}</h1>
          <p className="muted">سایت خبری Next.js خود را با چند انتخاب بسازید.</p>
        </div>
        <form onSubmit={submit} className="stack">
          <label>ایمیل<input name="email" type="email" required autoComplete="email" placeholder="name@example.com" /></label>
          <label>رمز عبور<input name="password" type="password" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="حداقل ۸ کاراکتر" /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={loading}>{loading ? "در حال ارسال..." : mode === "login" ? "ورود" : "ثبت‌نام"}</button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "حساب ندارید؟ ثبت‌نام کنید" : "حساب دارید؟ وارد شوید"}
        </button>
      </section>
    </main>
  );
}
