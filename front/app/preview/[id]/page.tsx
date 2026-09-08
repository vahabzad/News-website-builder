"use client";

import { useParams } from "next/navigation";
import { API_URL } from "../../../lib/api";

export default function PreviewPage() {
  const { id } = useParams<{ id: string }>();
  return <main className="full-preview"><div className="preview-toolbar"><b>پیش‌نمایش سایت خبری</b><a href={`/projects/${id}`}>بازگشت به پروژه</a></div><iframe title="پیش‌نمایش سایت" src={`${API_URL.replace(/\/api$/, "")}/preview/${id}/`} /></main>;
}
