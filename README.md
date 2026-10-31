# Vowly API (Vercel)

دالتين Serverless على Vercel. المفاتيح كلها في Environment Variables (مش في الكود).

| Endpoint | الملف | الوظيفة |
|----------|------|---------|
| `POST /api/send` | `api/send.js` | إرسال رسالة واتساب عن طريق Twilio |
| `POST /api/send-mail` | `api/send-mail.js` | إرسال إيميل RSVP / تهنئة عن طريق SMTP (نسخة من send-mail.php) |

---

## 1) النشر
- ارفع الفولدر على repo جديد على GitHub.
- Vercel → **Add New → Project** → اختار الـ repo → Framework: **Other**.
- حط الـ Environment Variables (تحت) → **Deploy**.
- Vercel هيثبّت `nodemailer` تلقائياً (موجود في package.json).
- القوالب في `templates/` بتترفع مع `api/send-mail.js` (متظبطة في `vercel.json`).

## 2) Environment Variables
شوف `.env.example`. باختصار:

**واتساب:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_TEMPLATE_SID`

**إيميل:** `ALLOWED_ORIGINS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TO`, `MAIL_ENCRYPTION_KEY`

---

## `POST /api/send` (واتساب)
```json
{ "to": "+201114994726", "variables": { "1": "أحمد" } }
```
يرجّع `{ "success": true, "sid": "...", "status": "..." }`.

## `POST /api/send-mail` (إيميل)
نفس عقد `send-mail.php`:
```json
{
  "type": "rsvp",            // أو "wish"
  "name": "أحمد",
  "attending": "yes",        // rsvp: yes/no
  "guests": 2,               // rsvp
  "text": "ألف مبروك",       // wish: نص التهنئة
  "email": "guest@x.com",    // اختياري (Reply-To)
  "template": "default",     // اسم فولدر في templates/
  "elapsed": 5000,           // ms من فتح الصفحة (لازم ≥ 2000)
  "credentials": "<token>"   // اختياري: توكن مشفّر فيه إيميل العروسين
}
```
يرجّع `{ "ok": true }` أو `{ "ok": false, "error": "..." }`.

**ملاحظات مطابقة للـ PHP:**
- CORS: المواقع في `ALLOWED_ORIGINS` بس (+ localhost).
- مكافحة بوت: `elapsed < 2000ms` مرفوض.
- التشفير: `credentials` = base64url(IV 12 + GCM tag 16 + ciphertext) بـ AES-256-GCM، يفك بـ `MAIL_ENCRYPTION_KEY`. لازم المفتاح يطابق مفتاح الموقع.
- القوالب: `templates/<name>/` (email.html, email.txt, template.json) — نفس محرّك Mustache.

**فرق واحد عن الـ PHP:** الـ rate limit (6/١٠دقايق) هنا **best-effort** عن طريق `/tmp` — على Vercel الـ serverless مش دايم، فلو عايز rate limit مضمون استخدم KV/Redis.
