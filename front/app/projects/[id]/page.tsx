"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import SiteForm, { type SiteSpec } from "../../../components/SiteForm";
import { API_URL, api, getToken } from "../../../lib/api";

type ProgressEvent = { id: string; at: string; kind: string; message: string };
type BuildProgress = { stage: string; message: string; model?: string; startedAt: string; lastActivityAt: string; events: ProgressEvent[] };
type Project = { id: string; name: string; spec: SiteSpec; status: string; version: number; error?: string; finalResponse?: string; continuationEnabled: boolean; previewUrl: string | null; downloadUrl: string | null; localPath: string; updatedAt: string; progress?: BuildProgress };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
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
  return <main className="container"><nav className="topbar"><Link href="/" className="back">→ داشبورد</Link><span className={`status-tag ${project.status}`}>{statusLabel(project.status)}</span></nav><section className="project-detail glass"><div className="detail-head"><div><span className="eyebrow">LOCAL CODEX PROJECT / V{project.version}</span><h1>{project.name}</h1><p>آخرین تغییر: {new Date(project.updatedAt).toLocaleString("fa-IR")}</p><code className="local-path">{project.localPath}</code></div>{working && <LiveBuildPanel progress={progress} status={project.status} updatedAt={project.updatedAt} now={now} />}</div><div className="settings-actions"></div>{showSettings && <SettingsSummary spec={project.spec} />}{project.error && <div className="error-box"><b>ساخت ناموفق بود</b><pre>{project.error}</pre><button className="secondary" onClick={retry} disabled={sending}>{sending ? "در حال ارسال..." : "تلاش مجدد"}</button></div>}{project.status === "ready" && <>
    <div className="result-actions"><Link className="primary button-link" href={`/preview/${id}`} target="_blank">مشاهده
      پیش‌نمایش</Link>
      <button className="secondary" onClick={download}>دانلود ZIP</button>
      <button className="secondary" type="button" onClick={() => {
        setShowSettings((value) => !value);
        setEditingSettings(false);
      }}>{showSettings ? "بستن تنظیمات" : "مشاهده تنظیمات فرم"}</button>
      <button className="secondary edit-settings-button" type="button" disabled={working} onClick={() => {
        setEditingSettings((value) => !value);
        setShowSettings(false);
      }}>{editingSettings ? "انصراف از ویرایش" : "ویرایش و ساخت مجدد"}</button>
    </div>
    <div className="preview-frame">
      <iframe title={`پیش‌نمایش ${project.name}`} src={`${API_URL.replace(/\/api$/, "")}/preview/${id}/`}/>
    </div>
  </>}{editingSettings && !working && <section className="settings-editor">
    <header><h2>ویرایش تنظیمات سایت</h2><p>پس از ثبت، خروجی فعلی پاک می‌شود و سایت با تنظیمات جدید از ابتدا ساخته خواهد
      شد.</p></header>
    <SiteForm key={`${project.id}-${project.updatedAt}`} initialSpec={project.spec} projectId={project.id} compact onCreated={async () => { setEditingSettings(false); await load(); }} /></section>}{project.continuationEnabled && project.status === "ready" && !editingSettings && <form className="continue-box" onSubmit={continueProject}><h2>ادامه و ویرایش پروژه</h2><p>تغییر موردنظر را بنویسید؛ همان Thread و پروژه محلی Codex ادامه پیدا می‌کند.</p><textarea name="instruction" required minLength={3} maxLength={4000} placeholder="مثلاً هدر را تیره کن و بخش ویدئو را بالاتر بیاور..." /><button className="primary" disabled={sending}>{sending ? "در حال ارسال..." : "اعمال تغییرات"}</button></form>}{!project.continuationEnabled && <p className="notice">امکان ادامه دادن این پروژه فعلاً غیرفعال است.</p>}{error && <p className="error">{error}</p>}</section></main>;
}

function SettingsSummary({ spec }: { spec: SiteSpec }) {
  const logoLabels = { provided: "لوگوی آپلودشده", generate: "طراحی لوگو با هوش مصنوعی", "text-only": "لوگوتایپ متنی" };
  return <section className="settings-view">
    <header><div><span className="eyebrow">تنظیمات فعلی پروژه</span><h2>{spec.siteName}</h2><p>اطلاعاتی که برای طراحی و تولید این سایت استفاده شده است.</p></div><span className="settings-count">{spec.features.length.toLocaleString("fa-IR")} قابلیت</span></header>
    <div className="settings-grid">
      <SettingsCard icon="◈" title="هویت رسانه"><SettingChips label="موضوع رسانه" values={spec.mediaTopics} /><SettingChips label="مخاطب اصلی" values={spec.targetAudience} /></SettingsCard>
      <SettingsCard icon="文" title="زبان و محتوا"><SettingChips label="زبان سایت" values={spec.languages} /><SettingChips label="دسته‌بندی‌های خبری" values={spec.categories} /><SettingChips label="نوع محتوا" values={spec.contentTypes} /></SettingsCard>
      <SettingsCard icon="✦" title="صفحه اصلی"><SettingChips label="تمرکز صفحه اصلی" values={spec.homepageFocus} /></SettingsCard>
      <SettingsCard icon="◐" title="طراحی و ظاهر"><SettingValue label="سبک طراحی" value={spec.design.style} /><SettingValue label="تراکم محتوا" value={spec.design.contentDensity} /><SettingValue label="رنگ‌بندی" value={spec.design.colorScheme} /><SettingValue label="فونت" value={spec.design.fontPreference} /><SettingValue label="هویت بصری" value={spec.design.visualIdentity} /><SettingValue label="نوع لوگو" value={logoLabels[spec.design.logo.mode]} />{spec.design.referenceWebsite && <SettingValue label="سایت مرجع" value={spec.design.referenceWebsite} link />}</SettingsCard>
      <SettingsCard icon="●" title="رنگ‌های انتخابی"><ColorValue label="رنگ اصلی" value={spec.design.primaryColor} /><ColorValue label="رنگ مکمل" value={spec.design.secondaryColor} /><ColorValue label="پس‌زمینه" value={spec.design.backgroundColor} /></SettingsCard>
      <SettingsCard icon="⚙" title="قابلیت‌های سایت"><SettingChips label="امکانات فعال" values={spec.features} /></SettingsCard>
    </div>
    {spec.additionalNotes && <div className="settings-note"><b>دستور تکمیلی</b><p>{spec.additionalNotes}</p></div>}
  </section>;
}

function SettingsCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) { return <article className="settings-card"><h3><i>{icon}</i>{title}</h3>{children}</article>; }
function SettingChips({ label, values }: { label: string; values: string[] }) { return <div className="setting-group"><span>{label}</span><div className="setting-chips">{values.map((value) => <b key={value}>{value}</b>)}</div></div>; }
function SettingValue({ label, value, link = false }: { label: string; value: string; link?: boolean }) { return <div className="setting-value"><span>{label}</span>{link ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <b>{value || "انتخاب نشده"}</b>}</div>; }
function ColorValue({ label, value }: { label: string; value: string }) { return <div className="setting-value color-value"><span>{label}</span><b>{value ? <><i style={{ backgroundColor: value }} /> <span dir="ltr">{value}</span></> : "انتخاب با هوش مصنوعی"}</b></div>; }

function LiveBuildPanel({ progress, status, updatedAt, now }: { progress?: BuildProgress; status: string; updatedAt: string; now: number }) {
  const events = progress?.events?.slice(-12).reverse() ?? [];
  return <aside className="working-live" aria-live="polite" aria-label="گزارش زنده ساخت پروژه">
    <div className="working-title"><span className="live-dot" /><div><b>{progress?.message || "Codex محلی در حال ساخت پروژه است…"}</b><small>{stageLabel(progress?.stage || status)}</small></div></div>
    {status === "generating" && progress?.model && <div className="model-badge"><span>مدل در حال استفاده</span><b dir="ltr">{progress.model}</b></div>}
    <div className="live-progress"><span /></div>
    <div className="live-metrics"><span>زمان سپری‌شده <b>{formatDuration(now - new Date(progress?.startedAt || updatedAt).getTime())}</b></span><span>آخرین فعالیت <b>{formatAgo(now - new Date(progress?.lastActivityAt || updatedAt).getTime())}</b></span></div>
    <div className="feed-heading"><b>گزارش زنده فعالیت‌ها</b><span><i /> زنده</span></div>
    {events.length ? <ol className="activity-feed">{events.map((item, index) => <li key={item.id} className={`${item.kind} ${index === 0 ? "current" : ""}`}><i /><div><span>{item.message}</span><time>{new Date(item.at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div></li>)}</ol> : <div className="feed-empty"><span className="spinner" /> منتظر دریافت اولین رویداد…</div>}
  </aside>;
}

function statusLabel(status: string) { return ({ queued: "در صف", generating: "در حال تولید", building: "در حال ساخت", ready: "آماده", failed: "ناموفق" } as Record<string, string>)[status] || status; }
function stageLabel(stage: string) { return ({ queued: "در صف اجرا", preparing: "آماده‌سازی workspace", generating: "تولید و ویرایش فایل‌ها", installing: "نصب وابستگی‌های امن", building: "ساخت خروجی Next.js", ready: "تکمیل‌شده", failed: "متوقف‌شده" } as Record<string, string>)[stage] || stage; }
function formatDuration(milliseconds: number) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); const minutes = Math.floor(seconds / 60); return `${minutes.toLocaleString("fa-IR")}:${String(seconds % 60).padStart(2, "0").replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])}`; }
function formatAgo(milliseconds: number) { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); if (seconds < 5) return "همین حالا"; if (seconds < 60) return `${seconds.toLocaleString("fa-IR")} ثانیه پیش`; return `${Math.floor(seconds / 60).toLocaleString("fa-IR")} دقیقه پیش`; }
