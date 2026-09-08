"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthPanel from "../components/AuthPanel";
import SiteForm from "../components/SiteForm";
import { api, getToken, logout } from "../lib/api";

type Project = { id: string; name: string; status: string; version: number; updatedAt: string; previewUrl: string | null; downloadUrl: string | null };

export default function Home() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [codexReady, setCodexReady] = useState(false);

  const load = useCallback(async () => {
    if (!getToken()) { setAuthenticated(false); return; }
    try { const result = await api<{ projects: Project[] }>("/projects"); setProjects(result.projects); setAuthenticated(true); }
    catch { localStorage.removeItem("news-builder-token"); setAuthenticated(false); }
  }, []);

  const refreshCodexStatus = useCallback(async () => {
    try {
      const codex = await api<{ ready: boolean }>("/codex/status");
      setCodexReady(codex.ready);
    } catch {
      setCodexReady(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!authenticated) return;
    refreshCodexStatus();
    const timer = window.setInterval(refreshCodexStatus, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, refreshCodexStatus]);
  if (authenticated === null) return <div className="center-screen"><span className="spinner" /></div>;
  if (!authenticated) return <AuthPanel onAuthenticated={load} />;

  return <main className="container">
    <nav className="topbar"><div className="brand"><div className="brand-mark small">✦</div><div><b>سایت‌ساز خبری</b><span>Powered by Local Codex</span></div></div><div className="nav-actions"><span className={`online ${codexReady ? "" : "offline"}`}><i /> {codexReady ? "Codex محلی آماده" : "نیاز به codex login"}</span><button className="ghost" onClick={logout}>خروج</button></div></nav>
    {!showBuilder ? <>
      <section className="dashboard-head"><div><span className="eyebrow">داشبورد پروژه‌ها</span><h1>سایت‌های خبری شما</h1><p>پروژه‌های ساخته‌شده، نسخه‌ها و خروجی‌ها را مدیریت کنید.</p></div><button className="primary" onClick={() => setShowBuilder(true)}>+ پروژه جدید</button></section>
      <section className="project-grid">{projects.length ? projects.map((project) => <article className="project-card glass" key={project.id} onClick={() => router.push(`/projects/${project.id}`)}><div className="project-cover">{project.name.slice(0, 1)}<span className={`status-tag ${project.status}`}>{statusLabel(project.status)}</span></div><div className="project-info"><h3>{project.name}</h3><p>نسخه {project.version} · {new Date(project.updatedAt).toLocaleDateString("fa-IR")}</p><button className="secondary">مشاهده پروژه ←</button></div></article>) : <div className="empty glass"><b>هنوز پروژه‌ای ندارید</b><p>فرم را تکمیل کنید تا اولین سایت خبری شما ساخته شود.</p><button className="primary" onClick={() => setShowBuilder(true)}>ساخت اولین پروژه</button></div>}</section>
    </> : <><button className="back" onClick={() => setShowBuilder(false)}>→ بازگشت به پروژه‌ها</button><SiteForm onCreated={(id) => router.push(`/projects/${id}`)} /></>}
  </main>;
}

function statusLabel(status: string) { return ({ draft: "پیش‌نویس", queued: "در صف", generating: "در حال تولید", building: "در حال ساخت", ready: "آماده", failed: "ناموفق" } as Record<string, string>)[status] || status; }
