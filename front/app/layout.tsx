import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "سایت‌ساز خبری هوشمند",
  description: "ساخت سایت خبری Next.js با هوش مصنوعی",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
