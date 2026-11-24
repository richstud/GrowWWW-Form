// GrowWWW - quick lead form handler (separate from website submit-enquiry).
//
// Three kinds of request (body.kind):
//   "lead"     - the 10-second form: issue + name + WhatsApp + best time (+ optional budget)
//   "callback" - exit popup: issue + WhatsApp + best time (visitor was leaving)
//   "details"  - optional extra details sent after a lead (leadId + same phone)
//
// Every request: saved in public.growth_form_leads, Telegram alert (same chat as website enquiries),
// and a Google Sheet row (one tab per service, "Callback Requests" for callbacks; details update the lead's row).
//
// Reuses secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GOOGLE_SHEET_WEBHOOK_URL, GOOGLE_SHEET_SECRET.
// Optional: GROWTH_SHEET_LINK (Sheet button in Telegram), GROWTH_YOUR_NAME (default "Anshu").
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Svc = "algo" | "development" | "automation" | "marketing" | "general" | "corporate";
const SVCS: Svc[] = ["algo", "development", "automation", "marketing", "general", "corporate"];
const TAB: Record<Svc, string> = {
  algo: "Algo Leads", development: "Development Leads", automation: "Automation Leads",
  marketing: "Marketing Leads", general: "General Leads", corporate: "Corporate Leads",
};
const CALLBACK_TAB = "Callback Requests";
const LABEL: Record<Svc, string> = {
  algo: "TRADING SOFTWARE", development: "SOFTWARE DEVELOPMENT", automation: "AUTOMATION",
  marketing: "DIGITAL MARKETING", general: "GENERAL", corporate: "CORPORATE",
};
const PREFIX: Record<Svc, string> = { algo: "ALG", development: "DEV", automation: "AUT", marketing: "MKT", general: "GEN", corporate: "CRP" };
const BONUS: Record<Svc, string> = {
  algo: "*1-Year FREE AMC* and *free backtest report*",
  development: "*1-Year FREE AMC* and *free design mockup*",
  automation: "*1-Year FREE AMC* and *free automation audit*",
  marketing: "*free digital audit* and *Google Business Profile tune-up*",
  general: "*1-Year FREE AMC* and *free audit*",
  corporate: "*1-Year FREE AMC* and *free digital audit*",
};
// optional details: [key, Sheet header, Telegram label]
const DETAILS: [string, string, string][] = [
  ["company", "Company", "🏢 Company"], ["email", "Email", "✉️ Email"], ["city", "City / Country", "📍 City"],
  ["website", "Website / Instagram", "🌐 Web"], ["timeline", "Timeline", "⏱ Timeline"], ["painText", "Problem (in their words)", "📝 Problem"],
];
const ID_RE = /^(ALG|DEV|AUT|MKT|GEN|CRP|CBK)-\d{6}-[A-Z0-9]{4}$/;

const env = (k: string, d = "") => (Deno.env.get(k) || d).trim();
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (v: unknown, max = 300) => {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
};
const istNow = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

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

function makeId(prefix: string) {
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString();
  const code = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `${prefix}-${ist.slice(2, 4)}${ist.slice(5, 7)}${ist.slice(8, 10)}-${code}`;
}

const num = (v: string, max: number) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));
const priorityOf = (s: number) => (s >= 60 ? "🔥 Hot" : s >= 35 ? "🌤 Warm" : "❄️ Cold");

function waUrl(phoneIntl: string, text: string) {
  return `https://wa.me/${phoneIntl}?text=${encodeURIComponent(text)}`;
}

function followUpText(svc: Svc, name: string, issue: string, leadId: string) {
  const me = env("GROWTH_YOUR_NAME", "Anshu");
  const first = (name || "").split(/\s+/)[0] || "there";
  return `Hi ${first}, this is ${me} from GrowWWW 👋\n\nThanks for reaching out about "${issue}". This is exactly the kind of problem we solve.\n\nYour ${BONUS[svc]} are reserved under Lead ID ${leadId}, and you're entered in this month's lucky draw 🏆\n\nIs now a good time for a quick 10-min call?`;
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

// Sends { secret, sheet_tab, row [, update_lead_id] } to the GrowthLeads.gs add-on.
async function sendToSheet(tab: string, row: Record<string, string | number>, updateLeadId?: string) {
  const url = env("GOOGLE_SHEET_WEBHOOK_URL"), secret = env("GOOGLE_SHEET_SECRET");
  if (!url || !secret) return { ok: false, reason: "Google Sheet secrets not set" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret, sheet_tab: tab, row, update_lead_id: updateLeadId || undefined }),
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data: { ok?: boolean; tab?: string; error?: string } = {};
    try { data = JSON.parse(text); } catch { /* HTML page */ }
    if (data.ok && data.tab === tab) return { ok: true };
    if (data.ok) return { ok: false, reason: "Apps Script add-on not installed/updated yet" };
    return { ok: false, reason: data.error || `Sheet replied ${res.status}` };
  } catch (e) {
    return { ok: false, reason: `Couldn't reach Google Sheet: ${(e as Error).message}` };
  }
}

function sheetButton(): { text: string; url: string }[][] {
  const link = env("GROWTH_SHEET_LINK");
  return /^https:\/\//.test(link) ? [[{ text: "📊 Open Google Sheet", url: link }]] : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object") return json({ ok: false, error: "Invalid request" }, 400);

  // Spam: honeypot / submitted < 2s after page load -> pretend success, store nothing.
  if (clean(body.hp)) return json({ ok: true, leadId: "OK" });
  const t = Number(body._t);
  if (Number.isFinite(t) && t > 0 && Date.now() - t < 2000) return json({ ok: true, leadId: "OK" });

  const kind = body.kind === "callback" ? "callback" : body.kind === "details" ? "details" : "lead";
  const d: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (k !== "hp" && k !== "_t") d[k] = clean(v, k === "painText" ? 2000 : 300);
  const svc: Svc = SVCS.includes(d.formType as Svc) ? (d.formType as Svc) : "general";

  const phoneIntl = normalisePhone(d.phone || "");
  if (!phoneIntl) return json({ ok: false, error: "Please enter a valid WhatsApp number." }, 400);
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return json({ ok: false, error: "Please check your email address." }, 400);

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256(ip + (Deno.env.get("IP_SALT") || "growwww"));
  const when = istNow();

  // ------------------------------------------------------------------ details
  if (kind === "details") {
    if (!ID_RE.test(d.leadId || "")) return json({ ok: false, error: "Invalid request" }, 400);
    const { data: lead } = await admin.from("growth_form_leads")
      .select("id, lead_id, form_type, name, phone_intl, score, answers, created_at, issue")
      .eq("lead_id", d.leadId).maybeSingle();
    // only the same phone, within 24h of the lead
    if (!lead || lead.phone_intl !== phoneIntl || Date.now() - new Date(lead.created_at).getTime() > 864e5) {
      return json({ ok: false, error: "Could not find your request. Please WhatsApp us." }, 404);
    }
    const added: Record<string, string> = {};
    for (const [k] of DETAILS) if (d[k]) added[k] = d[k];
    if (!Object.keys(added).length) return json({ ok: true, leadId: lead.lead_id });
    let score = Number(lead.score) || 0;
    if ((added.painText || "").length >= 30) score += 10;
    if (added.email) score += 5;
    score = Math.min(100, score + num(d._timelineScore, 20));
    const priority = priorityOf(score);
    await admin.from("growth_form_leads").update({
      email: added.email || undefined, city: added.city || undefined, company: added.company || undefined,
      timeline: added.timeline || undefined, pain_text: added.painText || undefined,
      answers: { ...(lead.answers || {}), ...added }, score, priority,
    }).eq("id", lead.id);

    const lines = [
      `📝 <b>MORE DETAILS</b> · ${priority} · ${score}/100`,
      `<b>${esc(lead.name || "")}</b> · <code>+${phoneIntl}</code>`,
      lead.issue ? `🎯 ${esc(lead.issue)}` : "",
      "",
      ...DETAILS.filter(([k]) => added[k]).map(([k, , label]) => `${label}: ${esc(added[k])}`),
      "",
      `🆔 <code>${lead.lead_id}</code>`,
    ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
    const row: Record<string, string | number> = { "Priority": priority, "Score": score, "Details added": when };
    for (const [k, header] of DETAILS) if (added[k]) row[header] = added[k];
    const [tg, sheet] = await Promise.all([
      sendTelegram(lines.join("\n"), sheetButton()),
      sendToSheet(TAB[(lead.form_type as Svc) || "general"] || TAB.general, row, lead.lead_id),
    ]);
    if (!tg.ok) console.warn("telegram not sent:", tg.reason);
    if (!sheet.ok) console.warn("sheet not updated:", sheet.reason);
    return json({ ok: true, leadId: lead.lead_id });
  }

  // --------------------------------------------------------- lead / callback
  const issue = d.issue || "Not selected";
  if (kind === "lead" && !d.name) return json({ ok: false, error: "Please enter your name." }, 400);

  const { count } = await admin.from("growth_form_leads").select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  if ((count ?? 0) >= 6) return json({ ok: false, error: "Too many requests. Please WhatsApp us instead." }, 429);

  const leadId = kind === "callback" ? makeId("CBK") : (ID_RE.test(d.leadId || "") && !d.leadId.startsWith("CBK") ? d.leadId : makeId(PREFIX[svc]));
  let score = kind === "callback" ? 20 : 30;
  score += num(d._budgetScore, 40);
  if (svc !== "general") score += 5;
  score = Math.min(100, score);
  const priority = priorityOf(score);
  const callTime = d.callTime || "Anytime";
  const followText = kind === "callback"
    ? `Hi${d.name ? " " + d.name.split(/\s+/)[0] : ""}, this is ${env("GROWTH_YOUR_NAME", "Anshu")} from GrowWWW 👋\n\nYou asked us for a call back about "${issue}". Is this a good time for a quick 10-min chat?`
    : followUpText(svc, d.name, issue, leadId);
  const wa = waUrl(phoneIntl, followText);

  const { error } = await admin.from("growth_form_leads").insert({
    lead_id: leadId, lead_kind: kind, form_type: svc, service: LABEL[svc], issue, call_time: callTime,
    name: d.name || null, phone: d.phone, phone_intl: phoneIntl, budget: d.budget || null,
    score, priority, answers: { issue, callTime, budget: d.budget || "" }, source: d.source || "Direct",
    ip_hash: ipHash, status: "new",
  });
  if (error) {
    console.error("insert failed", error);
    return json({ ok: false, error: "Something went wrong. Please WhatsApp us." }, 500);
  }

  const head = kind === "callback"
    ? `📞 <b>CALL BACK REQUEST</b> (left the form)`
    : `${priority} <b>NEW LEAD · ${LABEL[svc]}</b> · ${score}/100`;
  const lines = [
    head,
    "",
    `🎯 <b>${esc(issue)}</b>`,
    d.name ? `👤 ${esc(d.name)}` : "",
    `📱 <code>+${phoneIntl}</code>`,
    `⏰ Call: <b>${esc(callTime)}</b>`,
    d.budget ? `💰 ${esc(d.budget)}` : "",
    "",
    `🆔 <code>${leadId}</code> · ${esc(d.source || "Direct")} · ${when}`,
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
  const buttons = [[{ text: `💬 WhatsApp${d.name ? " " + d.name.split(/\s+/)[0] : ""}`, url: wa }], ...sheetButton()];

  const row: Record<string, string | number> = {
    "Timestamp (IST)": when, "Lead ID": leadId, "Priority": priority, "Score": score, "Status": "New",
    "WhatsApp Follow-up": wa, "Issue": issue, "Name": d.name || "", "WhatsApp No.": "+" + phoneIntl,
    "Best Time to Call": callTime, "Budget": d.budget || "", "Service": LABEL[svc], "Source": d.source || "Direct",
  };
  if (kind === "lead") {
    for (const [, header] of DETAILS) row[header] = "";
    row["Details added"] = "";
  }
  row["Notes"] = "";

  const [tg, sheet] = await Promise.all([
    sendTelegram(lines.join("\n"), buttons),
    sendToSheet(kind === "callback" ? CALLBACK_TAB : TAB[svc], row),
  ]);
  if (!tg.ok) console.warn("telegram not sent:", tg.reason);
  if (!sheet.ok) console.warn("sheet not updated:", sheet.reason);
  await admin.from("growth_form_leads").update({ telegram_sent: tg.ok, sheet_sent: sheet.ok }).eq("lead_id", leadId);

  return json({ ok: true, leadId });
});
