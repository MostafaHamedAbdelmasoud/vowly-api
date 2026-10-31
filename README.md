# Vowly API — WhatsApp sender

دالة Serverless على Vercel بتبعت رسائل واتساب عن طريق Twilio. المفاتيح متخبّية في Environment Variables (مش في الكود).

## الملفات
- `api/send.js` — الدالة (Endpoint: `POST /api/send`)
- `.env.example` — شكل المتغيرات المطلوبة
- `client-example.js` — مثال استدعاء من React

## 1) ارفعه على GitHub
```bash
cd vowly-api
git init -b main
git add .
git commit -m "Vowly WhatsApp API"
git remote add origin https://github.com/<USERNAME>/vowly-api.git
git push -u origin main
```

## 2) استورده في Vercel
- Vercel → **Add New → Project** → اختار repo `vowly-api`.
- Framework Preset: **Other** (مفيش build).
- متضغطش Deploy لحد ما تحط المتغيرات (الخطوة الجاية).

## 3) حط الـ Environment Variables
Vercel → Project → **Settings → Environment Variables**:

| Key | Value |
|-----|-------|
| `TWILIO_ACCOUNT_SID` | من Twilio Console (بيبدأ بـ AC) |
| `TWILIO_AUTH_TOKEN` | من Twilio Console |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+201043237379` |
| `TWILIO_TEMPLATE_SID` | SID بتاع التمبلت المعتمد (بيبدأ بـ HX) |

بعدها اعمل **Deploy**.

## 4) جرّبه
```bash
curl -X POST https://<project>.vercel.app/api/send \
  -H "Content-Type: application/json" \
  -d '{"to":"+201012345678","variables":{"1":"أحمد"}}'
```
الرد المتوقّع: `{"success":true,"sid":"SM...","status":"queued"}`

## طريقة الاستدعاء
```json
POST /api/send
{ "to": "+201012345678", "variables": { "1": "أحمد", "2": "20 ديسمبر" } }
```
- `to` — رقم الضيف بصيغة E.164.
- `variables` — متغيرات التمبلت ({{1}}, {{2}} ...).
- بدل التمبلت تقدر تبعت `"text": "..."` (بس جوّه نافذة الـ 24 ساعة من آخر رد للعميل).

## ملاحظات
- أول رسالة لأي عميل **لازم تمبلت معتمد** (مينفعش نص حر).
- التمبلت بتعمله من Twilio **Content Template Builder** وتستنى Meta تعتمده.
- الـ CORS مسموح لـ `vowlyeg.com` و `www.vowlyeg.com` و localhost — عدّل القائمة في أول `api/send.js` لو احتجت.
