"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { API_URL, api, getToken } from "../../../lib/api";

type ProgressEvent = { id: string; at: string; kind: string; message: string };
type BuildProgress = { stage: string; message: string; startedAt: string; lastActivityAt: string; events: ProgressEvent[] };
type Project = { id: string; name: string; status: string; version: number; error?: string; finalResponse?: string; continuationEnabled: boolean; previewUrl: string | null; downloadUrl: string | null; localPath: string; updatedAt: string; progress?: BuildProgress };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => { try { setProject(await api<Project>(`/projects/${id}`)); } catch (err) { setError(err instanceof Error ? err.message : "خطا"); } }, [id]);
  useEffect(() => { load(); const timer = setInterval(load, 2000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  async function continueProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError("");
    const form = new FormData(event.currentTarget);
    try { await api(`/projects/${id}/continue`, { method: "POST", body: JSON.stringify({ instruction: form.get("instruction") }) }); (event.target as HTMLFormElement).reset(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "خطا"); } finally { setSending(false); }
  }

  async function download() {
    const response = await fetch(`${API_URL}/projects/${id}/download`, { headers: { authorization: `Bearer ${getToken()}` } });
    if (!response.ok) return setError("دانلود خروجی ممکن نشد.");
    const blob = await response.blob(); const href = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = href; link.download = `${project?.name || "site"}.zip`; link.click(); URL.revokeObjectURL(href);
  }

  async function retry() {
    setSending(true); setError("");
    try { await api(`/projects/${id}/generate`, { method: "POST", body: "{}" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "خطا"); } finally { setSending(false); }
  }

  if (!project) return <main className="container"><Link href="/" className="back">→ داشبورد</Link>{error || <span className="spinner" />}</main>;
  const working = ["queued", "generating", "building"].includes(project.status);
  const progress = project.progress;
  return <main className="container"><nav className="topbar"><Link href="/" className="back">→ داشبورد</Link><span className={`status-tag ${project.status}`}>{statusLabel(project.status)}</span></nav><section className="project-detail glass"><div className="detail-head"><div><span className="eyebrow">LOCAL CODEX PROJECT / V{project.version}</span><h1>{project.name}</h1><p>آخرین تغییر: {new Date(project.updatedAt).toLocaleString("fa-IR")}</p><code className="local-path">{project.localPath}</code></div>{working && <div className="working-live"><div className="working-title"><span className="live-dot" /><div><b>{progress?.message || "Codex محلی در حال ساخت پروژه است…"}</b><small>{stageLabel(progress?.stage || project.status)}</small></div></div><div className="live-progress"><span /></div><div className="live-metrics"><span>زمان سپری‌شده <b>{formatDuration(now - new Date(progress?.startedAt || project.updatedAt).getTime())}</b></span><span>آخرین فعالیت <b>{formatAgo(now - new Date(progress?.lastActivityAt || project.updatedAt).getTime())}</b></span></div>{progress?.events?.length ? <ol className="activity-feed">{progress.events.slice(-6).reverse().map((item, index) => <li key={item.id} className={index === 0 ? "current" : ""}><i /><div><span>{item.message}</span><time>{new Date(item.at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div></li>)}</ol> : <small>رویدادهای زنده به‌زودی نمایش داده می‌شوند…</small>}</div>}</div>{project.error && <div className="error-box"><b>ساخت ناموفق بود</b><pre>{project.error}</pre><button className="secondary" onClick={retry} disabled={sending}>{sending ? "در حال ارسال..." : "تلاش مجدد"}</button></div>}{project.status === "ready" && <><div className="result-actions"><Link className="primary button-link" href={`/preview/${id}`} target="_blank">مشاهده پیش‌نمایش</Link><button className="secondary" onClick={download}>دانلود ZIP</button></div><div className="preview-frame"><iframe title={`پیش‌نمایش ${project.name}`} src={`${API_URL.replace(/\/api$/, "")}/preview/${id}/`} /></div></>}{project.continuationEnabled && project.status === "ready" && <form className="continue-box" onSubmit={continueProject}><h2>ادامه و ویرایش پروژه</h2><p>تغییر موردنظر را بنویسید؛ همان Thread و پروژه محلی Codex ادامه پیدا می‌کند.</p><textarea name="instruction" required minLength={3} maxLength={4000} placeholder="مثلاً هدر را تیره کن و بخش ویدئو را بالاتر بیاور..." /><button className="primary" disabled={sending}>{sending ? "در حال ارسال..." : "اعمال تغییرات"}</button></form>}{!project.continuationEnabled && <p className="notice">امکان ادامه دادن این پروژه فعلاً غیرفعال است.</p>}{error && <p className="error">{error}</p>}</section></main>;
}

function statusLabel(status: string) { return ({ queued: "در صف", generating: "در حال تولید", building: "در حال ساخت", ready: "آماده", failed: "ناموفق" } as Record<string, string>)[status] || status; }
function stageLabel(stage: string) { return ({ queued: "در صف اجرا", preparing: "آماده‌سازی workspace", generating: "تولید و ویرایش فایل‌ها", installing: "نصب وابستگی‌های امن", building: "ساخت خروجی Next.js", ready: "تکمیل‌شده", failed: "متوقف‌شده" } as Record<string, string>)[stage] || stage; }
function formatDuration(milliseconds: number) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); const minutes = Math.floor(seconds / 60); return `${minutes.toLocaleString("fa-IR")}:${String(seconds % 60).padStart(2, "0").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])}`; }
function formatAgo(milliseconds: number) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); if (seconds < 5) return "همین حالا"; if (seconds < 60) return `${seconds.toLocaleString("fa-IR")} ثانیه پیش`; return `${Math.floor(seconds / 60).toLocaleString("fa-IR")} دقیقه پیش`; }
