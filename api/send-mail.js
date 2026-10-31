// Vowly — Email API for wedding RSVPs & wishes (Vercel Serverless Function)
// POST /api/send-mail
//
// Port of send-mail.php to Node/Vercel. Same contract:
//   - CORS limited to ALLOWED_ORIGINS (comma-separated) + localhost
//   - anti-bot: "elapsed" (ms since the page opened) must be >= 2000
//   - body: { type:"rsvp"|"wish", name, email?, attending?, guests?, text?, template?, elapsed, credentials? }
//   - optional encrypted "credentials" token (AES-256-GCM) carries the couple's address (and may override SMTP_*)
//   - renders templates/<name>/ (email.html, email.txt, template.json) with a small Mustache engine
//
// The SMTP account lives in Vercel Environment Variables, never in the site.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";

const TEMPLATES_DIR = join(process.cwd(), "templates");

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");

  // ---- CORS ----
  const origin = (req.headers.origin || "").replace(/\/$/, "");
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin) {
    if (!isLocal && !allowed.includes(origin)) {
      return res.status(403).json({ ok: false, error: "origin" });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  let input = req.body;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = null; } }
  if (!input || typeof input !== "object") return res.status(400).json({ ok: false, error: "invalid" });

  // ---- build the mail setup: env, overridden by the encrypted token if present ----
  let env = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_SECURE: process.env.SMTP_SECURE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
    SMTP_TO: process.env.SMTP_TO,
  };

  if (input.credentials) {
    const creds = decryptCredentials(String(input.credentials), process.env.MAIL_ENCRYPTION_KEY || "");
    if (!creds) {
      console.error("send-mail: credentials could not be decrypted (is MAIL_ENCRYPTION_KEY correct?)");
      return res.status(400).json({ ok: false, error: "credentials" });
    }
    env = { ...env, ...creds };
  }

  for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_TO"]) {
    if (!env[key]) {
      console.error(`send-mail: missing ${key}`);
      return res.status(500).json({ ok: false, error: "config" });
    }
  }
  const recipients = String(env.SMTP_TO).split(",").map((s) => s.trim()).filter(Boolean);
  for (const addr of [env.SMTP_FROM, ...recipients]) {
    if (!isEmail(address(addr))) {
      console.error(`send-mail: invalid email address "${addr}"`);
      return res.status(500).json({ ok: false, error: "config" });
    }
  }

  // ---- anti-bot: too fast = a bot ----
  if (Number(input.elapsed || 0) < 2000) {
    console.error("send-mail: rejected a submission sent too quickly after the page opened");
    return res.status(400).json({ ok: false, error: "invalid" });
  }

  // ---- input ----
  const type = field(input, "type", 10);
  const name = field(input, "name", 80);
  if (name === "" || !["rsvp", "wish"].includes(type)) {
    return res.status(400).json({ ok: false, error: "invalid" });
  }

  let guestEmail = field(input, "email", 254);
  if (guestEmail && !isEmail(guestEmail)) guestEmail = "";

  const [templateDir, templateData] = loadTemplate(field(input, "template", 64));
  const tz = typeof templateData.timezone === "string" ? templateData.timezone : "Africa/Cairo";

  let subject, badge, rows, quote = null;
  if (type === "rsvp") {
    const attending = field(input, "attending", 3) === "no" ? "no" : "yes";
    const guests = Math.max(1, Math.min(10, parseInt(field(input, "guests", 3), 10) || 0));
    subject = attending === "yes"
      ? `Attending: ${name} (${guests} ${guests === 1 ? "guest" : "guests"})`
      : `Not attending: ${name}`;
    badge = attending === "yes"
      ? ["attending", "سيحضر إن شاء الله", "Attending"]
      : ["not_attending", "لن يتمكن من الحضور", "Not attending"];
    rows = [["الاسم", "Name", name], ["الحضور", "Attending", attending === "yes" ? "نعم · Yes" : "لا · No"]];
    if (attending === "yes") rows.push(["عدد الحضور", "Guests", String(guests)]);
  } else {
    quote = field(input, "text", 1000);
    if (quote === "") return res.status(400).json({ ok: false, error: "invalid" });
    subject = `Wishes from ${name}`;
    badge = ["wish", "تهنئة جديدة", "New wishes"];
    rows = [["من", "From", name]];
  }
  rows.push(["الوقت", "Received", receivedTime(tz)]);

  const [text, html] = renderEmail(templateDir, templateData, badge, rows, quote);

  // ---- rate limit: best-effort, 6 per IP / 10 min (serverless /tmp is per-instance) ----
  if (!rateOk(clientIp(req))) {
    return res.status(429).json({ ok: false, error: "rate" });
  }

  // ---- send ----
  try {
    await smtpSend(env, subject, text, html, guestEmail, recipients);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("send-mail:", e && e.message);
    return res.status(502).json({ ok: false, error: "send" });
  }
}

// ---- helpers -------------------------------------------------------------------

function address(v) {
  const m = /<([^>]+)>/.exec(v || "");
  return (m ? m[1] : v || "").trim();
}
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || "");
}
function field(input, key, max) {
  let v = input[key];
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") return "";
  v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  return Array.from(v).slice(0, max).join("");
}
function receivedTime(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t)?.value || "";
    return `${g("day")} ${g("month")} ${g("year")} · ${g("hour")}:${g("minute")} ${g("dayPeriod")}`;
  } catch {
    return new Date().toISOString();
  }
}
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// ---- templates ----------------------------------------------------------------

function loadTemplate(name) {
  let dirName = "default";
  if (name && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name) && existsSync(join(TEMPLATES_DIR, name))) {
    dirName = name;
  } else if (name) {
    console.error(`send-mail: no template "${name}" in templates/; using default`);
  }
  const dir = join(TEMPLATES_DIR, dirName);
  let data = {};
  try { data = JSON.parse(readFileSync(join(dir, "template.json"), "utf8")); } catch { data = {}; }
  return [dir, data && typeof data === "object" ? data : {}];
}

function readFromTemplate(dir, name) {
  for (const folder of [dir, join(TEMPLATES_DIR, "default")]) {
    const p = join(folder, name);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

export function renderEmail(dir, data, badge, rows, quote) {
  const [kind, badgeAr, badgeEn] = badge;
  const colours = (data.badges && data.badges[kind]) || {};
  const ctx = {
    ...data,
    badge_ar: badgeAr,
    badge_en: badgeEn,
    badge_ink: colours.ink || "#300A13",
    badge_bg: colours.bg || "#E9D3A0",
    guest: rows[0][2],
    quote: quote || "",
    rows: rows.map((r, i) => ({ label_ar: r[0], label_en: r[1], value: r[2], first: i === 0 })),
  };

  let html = readFromTemplate(dir, "email.html");
  if (html === null) throw new Error("no email.html in templates/");
  html = html.replace(/<!--[\s\S]*?-->/g, ""); // drop the template's own notes
  const text =
    readFromTemplate(dir, "email.txt") ||
    "{{badge_ar}} · {{badge_en}}\n\n{{#rows}}{{label_ar}} / {{label_en}}: {{value}}\n{{/rows}}{{#quote}}\n«{{quote}}»\n{{/quote}}";

  return [
    renderTemplate(text, ctx, (v) => v),
    renderTemplate(html, ctx, escapeHtml),
  ];
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Mustache-lite: {{key}}, {{#key}}…{{/key}} (list/truthy), {{^key}}…{{/key}} (empty)
// (exported for tests; Vercel only uses the default export as the handler)
export function renderTemplate(template, data, escape) {
  const section = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  let prev;
  do {
    prev = template;
    template = template.replace(section, (_m, sign, key, inner) => {
      const value = data[key];
      if (sign === "^") return isEmpty(value) ? renderTemplate(inner, data, escape) : "";
      if (Array.isArray(value)) {
        return value.map((item) => renderTemplate(inner, { ...data, ...item }, escape)).join("");
      }
      return isEmpty(value) ? "" : renderTemplate(inner, data, escape);
    });
  } while (template !== prev);

  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = data[key];
    return v !== undefined && v !== null && (typeof v !== "object")
      ? escape(String(v)) : "";
  });
}
function isEmpty(v) {
  return v === undefined || v === null || v === false || v === "" || v === 0 ||
    (Array.isArray(v) && v.length === 0);
}

// ---- encrypted credentials (AES-256-GCM, matches send-mail.php) ----------------
// token = base64url( 12-byte IV | 16-byte GCM tag | ciphertext of {"to", …} )
export function decryptCredentials(token, encodedKey) {
  try {
    const key = Buffer.from(encodedKey, "base64");
    const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length !== 32 || raw.length <= 28) return null;

    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

    const data = JSON.parse(plain);
    if (!data || typeof data !== "object") return null;
    if (typeof data.to !== "string" || data.to === "") return null;

    const out = { SMTP_TO: data.to };
    const map = { user: "SMTP_USER", pass: "SMTP_PASS", from: "SMTP_FROM", host: "SMTP_HOST", port: "SMTP_PORT", secure: "SMTP_SECURE" };
    for (const [f, n] of Object.entries(map)) {
      if (typeof data[f] === "string" && data[f] !== "") out[n] = data[f];
    }
    if (out.SMTP_HOST && !/^[A-Za-z0-9.-]{1,253}$/.test(out.SMTP_HOST)) return null;
    if (out.SMTP_PORT && !(/^\d+$/.test(out.SMTP_PORT) && +out.SMTP_PORT >= 1 && +out.SMTP_PORT <= 65535)) return null;
    return out;
  } catch {
    return null;
  }
}

// ---- rate limit (best-effort, /tmp) -------------------------------------------
function rateOk(client) {
  try {
    const file = join("/tmp", "wedding-mail-" + crypto.createHash("sha256").update(client).digest("hex"));
    const now = Math.floor(Date.now() / 1000);
    let hits = [];
    if (existsSync(file)) {
      try { hits = (JSON.parse(readFileSync(file, "utf8")) || []).filter((t) => typeof t === "number" && t > now - 600); } catch { hits = []; }
    }
    if (hits.length >= 6) return false;
    hits.push(now);
    writeFileSync(file, JSON.stringify(hits));
    return true;
  } catch {
    return true; // never block on a storage hiccup
  }
}

// ---- SMTP (nodemailer) ---------------------------------------------------------
async function smtpSend(env, subject, text, html, replyTo, recipients) {
  const port = parseInt(env.SMTP_PORT, 10);
  const secure = port === 465 || ["true", "1", "ssl", "tls"].includes(String(env.SMTP_SECURE || "").toLowerCase());
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: recipients.join(", "),
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
}
