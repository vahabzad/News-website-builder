# سایت‌ساز خبری

یک MVP محلی شامل فرانت Next.js و بک‌اند Node.js که با Codex SDK از روی فرم فارسی، سایت خبری Next.js تولید می‌کند.

## اجرا

```powershell
npm run install:all
Copy-Item backend/.env.example backend/.env
npm run dev
```

- فرانت: http://localhost:3000
- بک‌اند: http://localhost:4000/api/health

برای باز کردن سایت از دستگاه دیگری در شبکه، IP سیستم میزبان را در
`FRONTEND_ORIGIN` فایل `backend/.env` اضافه کنید. چند آدرس با کاما جدا می‌شوند.
فرانت به‌صورت خودکار API را روی همان IP و پورت ۴۰۰۰ پیدا می‌کند.

Codex SDK فقط از ورود محلی Codex CLI با حساب ChatGPT استفاده می‌کند. پیش از تولید اولین سایت، `npm run codex:login` را اجرا کنید. این دستور Codex Desktop را حتی اگر در PATH نباشد پیدا می‌کند و credential را در پروفایل Codex کاربر به‌شکل فایل ذخیره می‌کند تا Worker غیرتعاملی هم همان نشست را بخواند. Worker عمداً `OPENAI_API_KEY` و `CODEX_API_KEY` را دریافت نمی‌کند.

برای بررسی ورود از `npm run codex:status` استفاده کنید.

برای هر سایت یک Git repository مستقل در `backend/workspaces/<projectId>` ساخته می‌شود. این پوشه همان پروژه محلی Codex و خروجی قابل دانلود کاربر است.

با `ALLOW_CONTINUATION=false` در `backend/.env` می‌توان ادامه و ویرایش پروژه‌ها را به‌طور سراسری غیرفعال کرد.
