// GrowWWW - multi-service requirement form handler (Algo / Development / Automation / Marketing) (separate from website submit-enquiry).
// 1. Validates + spam-filters (honeypot, too-fast submit, 5 per hour per connection).
// 2. Saves to public.growth_form_leads (NOT contact_submissions).
// 3. Sends a Telegram alert to the same chat as website enquiries.
// 4. Adds a row to the same Google Sheet, one tab per service (see TAB below).
//
// Reuses existing secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GOOGLE_SHEET_WEBHOOK_URL, GOOGLE_SHEET_SECRET.
// Optional: GROWTH_SHEET_LINK (Sheet URL button in Telegram), GROWTH_YOUR_NAME (default "Anshu").
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Type = "algo" | "development" | "automation" | "marketing" | "corporate";
const TYPES: Type[] = ["algo", "development", "automation", "marketing", "corporate"];
const env = (k: string, d = "") => (Deno.env.get(k) || d).trim();
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (v: unknown, max = 500) => {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
};

// Answer fields per form: [key, Sheet header, Telegram label]
const BIZ: [string, string, string][] = [
  ["company", "Company", "🏢 Company"], ["designation", "Designation", "🎖 Designation"], ["industry", "Industry", "🏭 Industry"],
];
const FIELDS: Record<Type, [string, string, string][]> = {
  algo: [
    ["traderType", "Trader Type", "👤 Type"], ["experience", "Experience", "🎓 Experience"],
    ["markets", "Markets", "📊 Markets"], ["broker", "Broker", "🏦 Broker"], ["capital", "Trading Capital", "💼 Capital"],
    ["strategyStatus", "Strategy Status", "🧠 Strategy"], ["wants", "Wants Built", "🛠 Wants"],
    ["painPoints", "Pain Points", "😣 Pain points"],
  ],
  development: [...BIZ,
    ["projectType", "Project Type", "💻 Project"], ["stage", "Stage", "🧭 Stage"], ["features", "Features", "🧩 Features"],
    ["challenges", "Challenges", "😣 Challenges"], ["reference", "Reference App/Site", "🔗 Likes"], ["decisionMaker", "Decision Maker", "🔑 Decision"],
  ],
  automation: [...BIZ,
    ["size", "Team Size", "👥 Team"], ["tools", "Tools Used", "🧰 Tools"], ["processes", "Tasks to Automate", "⚙️ Automate"],
    ["hoursLost", "Hours Lost / Week", "⏱ Hours lost"], ["decisionMaker", "Decision Maker", "🔑 Decision"],
  ],
  marketing: [...BIZ,
    ["website", "Website / Instagram", "🌐 Web"], ["targetArea", "Target Area", "📍 Target"], ["goals", "Goals", "🎯 Goals"],
    ["challenges", "Challenges", "😣 Challenges"], ["channels", "Channels", "📣 Channels"], ["adSpend", "Current Ad Spend", "💸 Ad spend"],
    ["decisionMaker", "Decision Maker", "🔑 Decision"],
  ],
  corporate: [...BIZ,
    ["size", "Company Size", "👥 Team"], ["website", "Website", "🌐 Website"], ["challenges", "Challenges", "😣 Challenges"],
    ["services", "Services Needed", "🛠 Services"], ["decisionMaker", "Decision Maker", "🔑 Decision"],
  ],
};
const TAB: Record<Type, string> = {
  algo: "Algo Leads", development: "Development Leads", automation: "Automation Leads",
  marketing: "Marketing Leads", corporate: "Corporate Leads",
};
const LABEL: Record<Type, string> = {
  algo: "ALGO TRADING", development: "SOFTWARE DEVELOPMENT", automation: "SOFTWARE AUTOMATION",
  marketing: "DIGITAL MARKETING", corporate: "CORPORATE",
};
const PREFIX: Record<Type, string> = { algo: "ALG", development: "DEV", automation: "AUT", marketing: "MKT", corporate: "CRP" };
const BONUS: Record<Type, string> = {
  algo: "*1-Year FREE AMC* and *free backtest report*",
  development: "*1-Year FREE AMC* and *free design mockup*",
  automation: "*1-Year FREE AMC* and *free automation audit*",
  marketing: "*free digital audit* and *Google Business Profile tune-up*",
  corporate: "*1-Year FREE AMC* and *free digital audit*",
};

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function normalisePhone(p: string) {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}

function makeId(type: Type) {
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString();
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  const code = Array.from(rnd).map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `${PREFIX[type]}-${ist.slice(2, 4)}${ist.slice(5, 7)}${ist.slice(8, 10)}-${code}`;
}

function scoreLead(d: Record<string, string>, type: Type) {
  const n = (v: string, max: number) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
  let s = n(d._budgetScore, 40) + n(d._timelineScore, 25);
  if ((d.painText || "").length >= 40) s += 10;
  if ((d.email || "").includes("@")) s += 5;
  if (type === "algo") {
    const st = d.strategyStatus || "";
    if (/^Rules are written/i.test(st)) s += 15;
    else if (/TradingView|Amibroker|Excel/i.test(st)) s += 10;
    else if (/manually/i.test(st)) s += 5;
  } else {
    const dm = d.decisionMaker || "";
    if (/^Yes/i.test(dm)) s += 15;
    else if (/part/i.test(dm)) s += 8;
  }
  return Math.min(100, s);
}

function followUpUrl(d: Record<string, string>, type: Type, phoneIntl: string, leadId: string) {
  const me = env("GROWTH_YOUR_NAME", "Anshu");
  const first = d.name.split(/\s+/)[0] || "there";
  let pain = (d.painText || "").replace(/\s+/g, " ");
  if (pain.length > 90) pain = pain.slice(0, 87) + "…";
  const what = type === "algo" ? "algo trading" : type === "development" ? "software development" : type === "automation" ? "automation" : type === "marketing" ? "digital marketing" : "business";
  const msg = `Hi ${first}, this is ${me} from GrowWWW 👋\n\nThanks for sharing ${d.company ? d.company + "'s" : "your"} ${what} requirement${pain ? ` — especially: "${pain}"` : ""}.\n\nThis is exactly the kind of thing we solve. Your ${BONUS[type]} are reserved under Lead ID ${leadId}, and you're entered in this month's lucky draw 🏆\n\nCan we do a quick 15-min call today or tomorrow? 🚀`;
  return `https://wa.me/${phoneIntl}?text=${encodeURIComponent(msg)}`;
}

async function sendTelegram(text: string, buttons: { text: string; url: string }[][]) {
  const token = env("TELEGRAM_BOT_TOKEN"), chatId = env("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return { ok: false, reason: "Telegram secrets not set" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons } }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!(res.ok && data.ok), reason: data.description };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

// Sends { secret, sheet_tab, row } — the GrowthLeads.gs add-on writes `row` into tab `sheet_tab`.
async function sendToSheet(tab: string, row: Record<string, string | number>) {
  const url = env("GOOGLE_SHEET_WEBHOOK_URL"), secret = env("GOOGLE_SHEET_SECRET");
  if (!url || !secret) return { ok: false, reason: "Google Sheet secrets not set" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret, sheet_tab: tab, row }),
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data: { ok?: boolean; tab?: string; error?: string } = {};
    try { data = JSON.parse(text); } catch { /* HTML page */ }
    // `tab` in the reply proves the GrowthLeads add-on handled it (not the old website handler).
    if (data.ok && data.tab === tab) return { ok: true };
    if (data.ok) return { ok: false, reason: "Apps Script add-on not installed yet (row may have gone to the website tab)" };
    return { ok: false, reason: data.error || `Sheet replied ${res.status}` };
  } catch (e) {
    return { ok: false, reason: `Couldn't reach Google Sheet: ${(e as Error).message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid request" }, 400);

  // Spam: honeypot / submitted < 3s after page load → pretend success, store nothing.
  if (clean(body.hp)) return json({ ok: true, leadId: "OK" });
  const t = Number(body._t);
  if (Number.isFinite(t) && t > 0 && Date.now() - t < 3000) return json({ ok: true, leadId: "OK" });

  const type: Type = TYPES.includes(body.formType as Type) ? (body.formType as Type) : "algo";
  const d: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (k !== "hp" && k !== "_t") d[k] = clean(v, k === "painText" ? 2000 : 500);

  const required = type === "algo"
    ? ["name", "phone", "city", "budget", "timeline", "painText"]
    : ["name", "phone", "email", "company", "city", "budget", "timeline", "painText"]; // all business services
  const missing = required.filter((k) => !d[k]);
  if (missing.length) return json({ ok: false, error: "Please fill all required fields." }, 400);
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return json({ ok: false, error: "Please check your email address." }, 400);
  const phoneIntl = normalisePhone(d.phone);
  if (!phoneIntl) return json({ ok: false, error: "Please enter a valid WhatsApp number." }, 400);

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256(ip + (Deno.env.get("IP_SALT") || "growwww"));
  const { count } = await admin.from("growth_form_leads").select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  if ((count ?? 0) >= 5) return json({ ok: false, error: "Too many submissions. Please WhatsApp us instead." }, 429);

  const leadId = /^(ALG|DEV|AUT|MKT|CRP)-\d{6}-[A-Z0-9]{4}$/.test(d.leadId || "") ? d.leadId : makeId(type);
  const score = scoreLead(d, type);
  const priority = score >= 70 ? "🔥 Hot" : score >= 40 ? "🌤 Warm" : "❄️ Cold";
  const waUrl = followUpUrl(d, type, phoneIntl, leadId);
  const answers: Record<string, string> = {};
  for (const [k] of FIELDS[type]) if (d[k]) answers[k] = d[k];
  if (d.callTime) answers.callTime = d.callTime;

  const { data: row, error } = await admin.from("growth_form_leads").insert({
    lead_id: leadId, form_type: type, name: d.name, phone: d.phone, phone_intl: phoneIntl,
    email: d.email || null, city: d.city || null, company: d.company || null, budget: d.budget, timeline: d.timeline,
    pain_text: d.painText, score, priority, answers, service: LABEL[type], source: d.source || "Direct", ip_hash: ipHash,
  }).select("id").single();
  if (error) {
    console.error("insert failed", error);
    return json({ ok: false, error: "Something went wrong. Please WhatsApp us." }, 500);
  }

  // ---- Telegram ----
  const lines = [
    `${priority} <b>${LABEL[type]} LEAD</b> · ${score}/100`,
    "",
    `<b>${esc(d.name)}</b>${d.city ? " · " + esc(d.city) : ""}`,
    `📱 <code>+${phoneIntl}</code>`,
    d.email ? `✉️ ${esc(d.email)}` : "",
    `💰 <b>${esc(d.budget)}</b>  ·  ⏱ ${esc(d.timeline)}`,
    "",
    ...FIELDS[type].filter(([k]) => d[k]).map(([k, , label]) => `${label}: ${esc(d[k])}`),
    "",
    `📝 <i>${esc(d.painText.length > 1200 ? d.painText.slice(0, 1197) + "…" : d.painText)}</i>`,
    "",
    d.callTime ? `📞 Best time: ${esc(d.callTime)}` : "",
    `🆔 <code>${leadId}</code> · Source: ${esc(d.source || "Direct")}`,
  ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0));
  const buttons = [[{ text: `💬 WhatsApp ${d.name.split(/\s+/)[0]}`, url: waUrl }]];
  const sheetLink = env("GROWTH_SHEET_LINK");
  if (/^https:\/\//.test(sheetLink)) buttons.push([{ text: "📊 Open Google Sheet", url: sheetLink }]);

  // ---- Sheet row (header → value; the add-on creates headers on first use) ----
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const sheetRow: Record<string, string | number> = {
    "Timestamp (IST)": when, "Lead ID": leadId, "Priority": priority, "Score": score, "Status": "New",
    "WhatsApp Follow-up": waUrl, "Name": d.name, "WhatsApp No.": "+" + phoneIntl, "Email": d.email,
    "City / Country": d.city, "Service": LABEL[type],
  };
  for (const [k, header] of FIELDS[type]) sheetRow[header] = d[k] || "";
  Object.assign(sheetRow, {
    "Pain (in their words)": d.painText, "Budget": d.budget, "Timeline": d.timeline,
    "Best Time to Call": d.callTime || "", "Source": d.source || "Direct", "Notes": "",
  });

  const [tg, sheet] = await Promise.all([sendTelegram(lines.join("\n"), buttons), sendToSheet(TAB[type], sheetRow)]);
  if (!tg.ok) console.warn("telegram not sent:", tg.reason);
  if (!sheet.ok) console.warn("sheet not updated:", sheet.reason);
  await admin.from("growth_form_leads").update({ telegram_sent: tg.ok, sheet_sent: sheet.ok }).eq("id", row.id);

  return json({ ok: true, leadId });
});
