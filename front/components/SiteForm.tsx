"use client";

import { FormEvent, useMemo, useState } from "react";
import { api } from "../lib/api";

const GROUPS = {
  mediaTopics: ["عمومی", "سیاسی", "اقتصادی", "ورزشی", "فناوری", "فرهنگی و هنری", "اجتماعی", "سلامت", "محلی / استانی", "تخصصی"],
  targetAudience: ["عموم مردم", "مخاطب تخصصی", "مدیران و سازمان‌ها", "جوانان", "کاربران محلی"],
  languages: ["فارسی", "انگلیسی", "عربی", "ترکی"],
  contentTypes: ["خبر", "خبر فوری", "مقاله", "تحلیل", "یادداشت", "مصاحبه", "گزارش", "ویدئو", "گالری تصاویر", "پادکست", "اینفوگرافیک", "پرونده ویژه"],
  homepageFocus: ["آخرین اخبار", "مهم‌ترین اخبار", "خبر فوری", "اخبار پربازدید", "محتوای تصویری", "تحلیل و یادداشت", "ویدئو", "انتخاب با هوش مصنوعی"],
  features: ["جستجو", "خبر فوری", "اخبار پربازدید", "اخبار مرتبط", "تبلیغات", "عضویت کاربران", "نظرات کاربران", "خبرنامه", "شبکه‌های اجتماعی", "ذخیره خبر", "اشتراک‌گذاری خبر", "حالت شب", "چندزبانه", "انتخاب با هوش مصنوعی"],
};

type GroupName = keyof typeof GROUPS;
type Selection = Record<GroupName, string[]>;

const initialSelection: Selection = { mediaTopics: [], targetAudience: [], languages: [], contentTypes: [], homepageFocus: [], features: [] };

export type SiteSpec = {
  siteName: string;
  mediaTopics: string[];
  targetAudience: string[];
  languages: string[];
  categories: string[];
  contentTypes: string[];
  homepageFocus: string[];
  design: {
    style: string;
    referenceWebsite: string;
    contentDensity: string;
    colorScheme: string;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    logo: { mode: "provided" | "generate" | "text-only" };
    visualIdentity: string;
    fontPreference: string;
  };
  features: string[];
  additionalNotes: string;
  uploadedLogo?: string;
};

function ChoiceGroup({ name, value, onChange }: { name: GroupName; value: string[]; onChange: (value: string[]) => void }) {
  const items = GROUPS[name];
  const allSelected = value.length === items.length;
  return <div className="choices">
    {name !== "languages" && <label className="choice all"><input type="checkbox" checked={allSelected} onChange={() => onChange(allSelected ? [] : [...items])} />همه موارد</label>}
    {items.map((item) => <label className={`choice ${item.includes("هوش مصنوعی") ? "ai" : ""}`} key={item}>
      <input type="checkbox" checked={value.includes(item)} onChange={() => onChange(value.includes(item) ? value.filter((v) => v !== item) : [...value, item])} />{item}
    </label>)}
  </div>;
}

export default function SiteForm({ onCreated, initialSpec, projectId, compact = false }: { onCreated: (id: string) => void; initialSpec?: SiteSpec; projectId?: string; compact?: boolean }) {
  const [selection, setSelection] = useState<Selection>(() => initialSpec ? {
    mediaTopics: initialSpec.mediaTopics,
    targetAudience: initialSpec.targetAudience,
    languages: initialSpec.languages,
    contentTypes: initialSpec.contentTypes,
    homepageFocus: initialSpec.homepageFocus,
    features: initialSpec.features,
  } : initialSelection);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  const completed = useMemo(() => Object.values(selection).filter((items) => items.length).length, [selection]);
  const progress = Math.round((completed / 6) * 100);

  function update(name: GroupName, value: string[]) { setSelection((current) => ({ ...current, [name]: value })); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    for (const [key, value] of Object.entries(selection)) if (!value.length) return setError(`بخش «${key}» را تکمیل کنید.`);
    const fd = new FormData(event.currentTarget);
    const logoMode = String(fd.get("logoMode"));
    const canReuseLogo = initialSpec?.design.logo.mode === "provided" && Boolean(initialSpec.uploadedLogo);
    if (logoMode === "provided" && !logo && !canReuseLogo) return setError("فایل لوگو را انتخاب کنید.");
    setLoading(true);
    try {
      const spec = {
        siteName: String(fd.get("siteName") || "").trim(), ...selection,
        categories: String(fd.get("categories") || "").split(/[,،]/).map((v) => v.trim()).filter(Boolean),
        design: {
          style: fd.get("designStyle"), referenceWebsite: String(fd.get("referenceWebsite") || "").trim(), contentDensity: fd.get("contentDensity"),
          colorScheme: fd.get("colorScheme"), primaryColor: String(fd.get("primaryColor") || ""), secondaryColor: String(fd.get("secondaryColor") || ""), backgroundColor: String(fd.get("backgroundColor") || ""),
          logo: { mode: logoMode }, visualIdentity: fd.get("visualIdentity"), fontPreference: fd.get("fontPreference"),
        },
        additionalNotes: String(fd.get("additionalNotes") || ""),
      };
      const project = projectId
        ? await api<{ id: string }>(`/projects/${projectId}`, { method: "PUT", body: JSON.stringify(spec) })
        : await api<{ id: string }>("/projects", { method: "POST", body: JSON.stringify(spec) });
      if (logo) {
        const upload = new FormData(); upload.set("logo", logo);
        await api(`/projects/${project.id}/logo`, { method: "POST", body: upload });
      }
      await api(`/projects/${project.id}/${projectId ? "rebuild" : "generate"}`, { method: "POST", body: "{}" });
      onCreated(project.id);
    } catch (err) { setError(err instanceof Error ? err.message : "خطا در ساخت پروژه"); }
    finally { setLoading(false); }
  }

  return <form onSubmit={submit} className={`builder-form ${compact ? "builder-form-compact" : ""}`}>
    {!compact && <section className="hero"><div className="hero-pill"><i /> موتور ساخت سایت خبری</div><h1>رسانه خبری خود را <span>هوشمند بسازید</span></h1><p>اطلاعات رسانه را وارد کنید؛ موتور Codex یک پروژه کامل Next.js تولید می‌کند.</p><div className="progress"><span style={{ width: `${progress}%` }} /><b>{progress}%</b></div></section>}
    <FormCard title="هویت رسانه" subtitle="مشخصات پایه رسانه را تعیین کنید" step="01">
      <label className="field-title">نام رسانه<input name="siteName" required minLength={2} defaultValue={initialSpec?.siteName} placeholder="مثلاً دیدبان فناوری" /></label>
      <Field title="موضوع رسانه"><ChoiceGroup name="mediaTopics" value={selection.mediaTopics} onChange={(v) => update("mediaTopics", v)} /></Field>
      <Field title="مخاطب اصلی"><ChoiceGroup name="targetAudience" value={selection.targetAudience} onChange={(v) => update("targetAudience", v)} /></Field>
    </FormCard>
    <FormCard title="زبان و محتوا" subtitle="ساختار محتوایی رسانه را مشخص کنید" step="02">
      <Field title="زبان سایت"><ChoiceGroup name="languages" value={selection.languages} onChange={(v) => update("languages", v)} /></Field>
      <label className="field-title">دسته‌بندی‌های خبری<input name="categories" required defaultValue={initialSpec?.categories.join("، ")} placeholder="فناوری، هوش مصنوعی، استارتاپ" /></label>
      <Field title="نوع محتوا"><ChoiceGroup name="contentTypes" value={selection.contentTypes} onChange={(v) => update("contentTypes", v)} /></Field>
    </FormCard>
    <FormCard title="طراحی و تجربه بصری" subtitle="هوش مصنوعی بر اساس این انتخاب‌ها رابط را طراحی می‌کند" step="03">
      <Field title="تمرکز صفحه اصلی"><ChoiceGroup name="homepageFocus" value={selection.homepageFocus} onChange={(v) => update("homepageFocus", v)} /></Field>
      <div className="grid-2"><Select name="designStyle" title="سبک طراحی" value={initialSpec?.design.style} options={["رسمی و خبری", "مدرن", "مینیمال", "تصویری و مجله‌ای", "پرمحتوا و کلاسیک", "لوکس و حرفه‌ای", "ترکیبی", "انتخاب با هوش مصنوعی", "مشابه سایت خاص"]} /><Select name="contentDensity" title="تراکم محتوا" value={initialSpec?.design.contentDensity} options={["خلوت", "متعادل", "پرمحتوا", "انتخاب با هوش مصنوعی"]} /></div>
      <label className="field-title">سایت مرجع <small>اختیاری</small><input name="referenceWebsite" type="url" defaultValue={initialSpec?.design.referenceWebsite} placeholder="https://example.com" /></label>
    </FormCard>
    <FormCard title="هویت بصری" subtitle="رنگ، لوگو و تایپوگرافی سایت را مشخص کنید" step="04">
      <div className="grid-2"><Select name="colorScheme" title="رنگ‌بندی" value={initialSpec?.design.colorScheme} options={["انتخاب با هوش مصنوعی", "روشن", "تیره", "قرمز خبری", "آبی رسمی", "سبز", "طلایی / لوکس", "رنگ سازمانی", "ترکیب دلخواه"]} /><Select name="logoMode" title="لوگو" value={initialSpec?.design.logo.mode} options={["provided|لوگوی آماده دارم", "generate|هوش مصنوعی طراحی کند", "text-only|لوگوتایپ متنی"]} /></div>
      <label className="upload">{initialSpec?.uploadedLogo ? "برای حفظ لوگوی قبلی، فایل جدیدی انتخاب نکنید؛ یا لوگوی جایگزین را بارگذاری کنید." : "آپلود لوگو (PNG، JPG یا WebP تا ۵MB)"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo(e.target.files?.[0] || null)} /></label>
      <div className="grid-3"><label className="field-title">رنگ اصلی<input name="primaryColor" defaultValue={initialSpec?.design.primaryColor} placeholder="#2563eb" /></label><label className="field-title">رنگ مکمل<input name="secondaryColor" defaultValue={initialSpec?.design.secondaryColor} placeholder="#ef4444" /></label><label className="field-title">پس‌زمینه<input name="backgroundColor" defaultValue={initialSpec?.design.backgroundColor} placeholder="#ffffff" /></label></div>
      <div className="grid-2"><Select name="visualIdentity" title="هویت بصری" value={initialSpec?.design.visualIdentity} options={["انتخاب با هوش مصنوعی", "هویت بصری مشخص دارم", "هویت بصری مشخص ندارم"]} /><Select name="fontPreference" title="فونت" value={initialSpec?.design.fontPreference} options={["انتخاب با هوش مصنوعی", "Vazirmatn", "IRANSans", "Yekan Bakh", "Estedad"]} /></div>
    </FormCard>
    <FormCard title="قابلیت‌های سایت" subtitle="ویژگی‌هایی که باید در سایت پیاده‌سازی شوند" step="05"><ChoiceGroup name="features" value={selection.features} onChange={(v) => update("features", v)} /></FormCard>
    <FormCard title="دستور تکمیلی" subtitle="درخواست خاص خود را به موتور هوش مصنوعی بگویید" step="06"><textarea name="additionalNotes" maxLength={4000} defaultValue={initialSpec?.additionalNotes} placeholder="مثلاً بنرهای تبلیغاتی کوچک باشد و لوگو مینیمال طراحی شود..." /></FormCard>
    {error && <p className="error action-error">{error}</p>}
    <div className="submit-bar glass"><div><b>{projectId ? "ساخت مجدد با تنظیمات جدید" : "آماده ساخت سایت"}</b><span>{projectId ? "خروجی فعلی این پروژه با نسخه جدید جایگزین می‌شود" : "خروجی به‌صورت پروژه کامل Next.js تولید می‌شود"}</span></div><button className="primary" disabled={loading}>{loading ? "در حال ارسال..." : projectId ? "✦ ذخیره و ساخت مجدد" : "✦ ساخت سایت خبری"}</button></div>
  </form>;
}

function FormCard({ title, subtitle, step, children }: { title: string; subtitle: string; step: string; children: React.ReactNode }) { return <section className="form-card glass"><header><span className="step">{step}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header><div className="card-body">{children}</div></section>; }
function Field({ title, children }: { title: string; children: React.ReactNode }) { return <div className="field"><div className="field-title">{title}</div>{children}</div>; }
function Select({ name, title, options, value }: { name: string; title: string; options: string[]; value?: string }) { return <label className="field-title">{title}<select name={name} required defaultValue={value || ""}><option value="" disabled>انتخاب کنید</option>{options.map((option) => { const [optionValue, label] = option.includes("|") ? option.split("|") : [option, option]; return <option value={optionValue} key={optionValue}>{label}</option>; })}</select></label>; }
