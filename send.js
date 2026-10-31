// Vowly — WhatsApp sender (Vercel Serverless Function)
// POST /api/send
//
// Body (JSON):
//   { "to": "+2010...", "variables": { "1": "أحمد" } }   // يبعت تمبلت معتمد
//   { "to": "+2010...", "text": "رسالة" }                 // رسالة نص (جوّه نافذة الـ 24 ساعة بس)
//
// المفاتيح بتتقرا من Environment Variables في Vercel — مش مكتوبة هنا إطلاقاً.

const ALLOWED_ORIGINS = [
  "https://vowlyeg.com",
  "https://www.vowlyeg.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

export default async function handler(req, res) {
  // ===== CORS =====
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ===== المفاتيح من البيئة =====
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_FROM,
    TWILIO_TEMPLATE_SID,
  } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    return res.status(500).json({ error: "Server not configured: missing Twilio env vars." });
  }

  // ===== قراءة الـ body =====
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { to, variables, text, templateSid } = body;

  if (!to) {
    return res.status(400).json({ error: "Field 'to' is required, e.g. +201234567890" });
  }

  const toNum = String(to).trim();
  if (!/^\+?[1-9]\d{6,15}$/.test(toNum)) {
    return res.status(400).json({ error: "Invalid phone number. Use E.164 like +201234567890" });
  }

  // ===== تجهيز الطلب لتويلو =====
  const params = new URLSearchParams();
  params.append("To", `whatsapp:${toNum.startsWith("+") ? toNum : "+" + toNum}`);
  params.append(
    "From",
    TWILIO_WHATSAPP_FROM.startsWith("whatsapp:")
      ? TWILIO_WHATSAPP_FROM
      : `whatsapp:${TWILIO_WHATSAPP_FROM}`
  );

  const contentSid = templateSid || TWILIO_TEMPLATE_SID;
  if (contentSid) {
    params.append("ContentSid", contentSid);
    if (variables && typeof variables === "object") {
      params.append("ContentVariables", JSON.stringify(variables));
    }
  } else if (text) {
    params.append("Body", String(text));
  } else {
    return res.status(400).json({
      error: "Provide a template (TWILIO_TEMPLATE_SID or templateSid) or a 'text' message.",
    });
  }

  // ===== الاتصال بتويلو =====
  try {
    const twRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );

    const data = await twRes.json();

    if (!twRes.ok) {
      return res.status(twRes.status).json({
        error: data.message || "Twilio request failed",
        code: data.code,
      });
    }

    return res.status(200).json({ success: true, sid: data.sid, status: data.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
