import { createClient } from "@supabase/supabase-js";

function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  let normalized = value.trim();
  if (
    (normalized.startsWith("\"") && normalized.endsWith("\"")) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (!normalized) return "";
  const parts = normalized.split(/\s+/);
  return parts[parts.length - 1];
}

function themeWrap(innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;background:#0a0a12;color:#dce2ff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a12;padding:28px 16px">
    <tr>
      <td align="center">
        <div style="max-width:480px;border:1px solid rgba(245,230,66,0.35);border-radius:20px;padding:28px 24px;background:linear-gradient(160deg,rgba(10,10,18,0.98),rgba(22,16,36,0.98));box-shadow:0 20px 48px rgba(0,0,0,0.45)">
          <p style="margin:0 0 12px;font-size:0.7rem;letter-spacing:0.16em;text-transform:uppercase;color:#f5e642">Decide For Me</p>
          ${innerHtml}
        </div>
        <p style="margin:20px 0 0;font-size:0.75rem;color:rgba(220,226,255,0.4)">Stop overthinking. Just decide.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getNotificationConfig() {
  return {
    resendApiKey: normalizeEnvValue(process.env.RESEND_API_KEY),
    emailFrom: normalizeEnvValue(process.env.EMAIL_FROM) || "Decide For Me <onboarding@resend.dev>",
    appBaseUrl: normalizeEnvValue(process.env.APP_BASE_URL) || "https://decideforme.org",
    tz: normalizeEnvValue(process.env.NOTIFICATION_TZ) || "Europe/London",
    cronSecret: normalizeEnvValue(process.env.CRON_SECRET),
    supabaseUrl: normalizeEnvValue(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    supabaseAnonKey: normalizeEnvValue(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY),
    supabaseServiceKey: normalizeEnvValue(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SERVICE_ROLE_KEY
    )
  };
}

export function getAnonClient() {
  const c = getNotificationConfig();
  if (!c.supabaseUrl || !c.supabaseAnonKey) return null;
  return createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getServiceClient() {
  const c = getNotificationConfig();
  if (!c.supabaseUrl || !c.supabaseServiceKey) return null;
  return createClient(c.supabaseUrl, c.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function todayInTimeZone(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date().toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

export async function sendResendEmail({ to, subject, html, text }) {
  const { resendApiKey, emailFrom } = getNotificationConfig();
  if (!resendApiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [to],
      subject,
      html,
      text: text || subject
    })
  });
  const body = await res.text();
  if (!res.ok) {
    return { ok: false, error: body || res.statusText };
  }
  return { ok: true, body };
}

function blockTitleAndBody(title, bodyHtml) {
  return `<h1 style="margin:0 0 14px;font-size:1.35rem;font-weight:700;color:#f2f4ff">${title}</h1>
  <div style="font-size:0.95rem;color:rgba(220,226,255,0.9)">${bodyHtml}</div>`;
}

function ctaBlock(url, label) {
  return `<p style="margin:24px 0 0">
    <a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:linear-gradient(180deg,#f5e642,#c9b82e);color:#0a0a12;font-weight:700;text-decoration:none;font-size:0.9rem">${label}</a>
  </p>`;
}

export async function sendWelcomeEmail({ to, appBaseUrl }) {
  const url = (appBaseUrl || "").replace(/\/$/, "") + "/";
  const inner = blockTitleAndBody(
    "Welcome to Decide For Me",
    `<p style="margin:0 0 10px">You’re in. Your AI is ready to cut through the noise and hand you a clear call—on food, travel, life calls, and everything in between.</p>
     <p style="margin:0">Open the app and ask your first question. The more you use it, the sharper it gets.</p>`
  );
  const html = themeWrap(inner + ctaBlock(url, "Open Decide For Me"));
  return sendResendEmail({
    to,
    subject: "Welcome to Decide For Me",
    html,
    text: `Welcome to Decide For Me. Open the app: ${url}`
  });
}

export async function sendDailyDilemmaEmail({ to, appBaseUrl }) {
  const url = (appBaseUrl || "").replace(/\/$/, "") + "/";
  const inner = blockTitleAndBody(
    "Today’s dilemma is live",
    `<p style="margin:0">Cast your vote on today’s community dilemma and see how the crowd is split. One tap, your take is in.</p>`
  );
  const html = themeWrap(inner + ctaBlock(url, "Cast your vote"));
  return sendResendEmail({
    to,
    subject: "Today’s dilemma is live — come cast your vote",
    html,
    text: `Today's dilemma is live, come cast your vote: ${url}`
  });
}

export async function sendStreakReminderEmail({ to, appBaseUrl }) {
  const url = (appBaseUrl || "").replace(/\/$/, "") + "/";
  const inner = blockTitleAndBody(
    "Don’t break your streak",
    `<p style="margin:0">You’ve got momentum. Make one quick decision today to keep your streak alive—ask anything, get a clear call.</p>`
  );
  const html = themeWrap(inner + ctaBlock(url, "Make a decision"));
  return sendResendEmail({
    to,
    subject: "Don’t break your streak — make a decision today",
    html,
    text: `Don't break your streak, make a decision today: ${url}`
  });
}

export function assertCronSecret(req) {
  const c = getNotificationConfig();
  if (!c.cronSecret) return { ok: false, reason: "CRON_SECRET is not set on the server." };
  const header = req.headers?.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const alt = req.headers["x-cron-secret"];
  if (bearer === c.cronSecret || alt === c.cronSecret) return { ok: true };
  return { ok: false, reason: "Invalid or missing cron secret." };
}

async function logEmailSent(service, userId, emailType, sentOn) {
  const { error } = await service.from("notification_email_log").insert({
    user_id: userId,
    email_type: emailType,
    sent_on: sentOn
  });
  if (error && !String(error.message || "").includes("duplicate")) {
    console.error("[email log]", error);
  }
}

async function wasEmailSentToday(service, userId, emailType, sentOn) {
  const { data, error } = await service
    .from("notification_email_log")
    .select("id")
    .eq("user_id", userId)
    .eq("email_type", emailType)
    .eq("sent_on", sentOn)
    .maybeSingle();
  if (error) {
    console.error("[email log check]", error);
    return true;
  }
  return Boolean(data);
}

export async function runDailyDilemmaReminders() {
  const cfg = getNotificationConfig();
  const service = getServiceClient();
  if (!service) return { ok: false, error: "Supabase service client not configured (SUPABASE_SERVICE_ROLE_KEY + URL)." };
  if (!cfg.resendApiKey) return { ok: false, error: "RESEND_API_KEY not set." };

  const sentOn = todayInTimeZone(cfg.tz);
  let sent = 0;
  let skipped = 0;
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { ok: false, error: error.message };
    const users = Array.isArray(data?.users) ? data.users : [];
    for (const u of users) {
      const email = u.email;
      if (!email) {
        skipped += 1;
        continue;
      }
      if (await wasEmailSentToday(service, u.id, "daily_dilemma", sentOn)) {
        skipped += 1;
        continue;
      }
      const r = await sendDailyDilemmaEmail({ to: email, appBaseUrl: cfg.appBaseUrl });
      if (r.ok) {
        await logEmailSent(service, u.id, "daily_dilemma", sentOn);
        sent += 1;
      } else {
        console.error("[daily dilemma email]", email, r.error);
      }
    }
    if (users.length < 200) break;
    page += 1;
  }
  return { ok: true, sent, skipped, date: sentOn };
}

export async function runStreakReminders() {
  const cfg = getNotificationConfig();
  const service = getServiceClient();
  if (!service) return { ok: false, error: "Supabase service client not configured." };
  if (!cfg.resendApiKey) return { ok: false, error: "RESEND_API_KEY not set." };

  const sentOn = todayInTimeZone(cfg.tz);
  const { data: rows, error } = await service.rpc("users_needing_streak_reminder", { p_tz: cfg.tz });
  if (error) return { ok: false, error: error.message };

  let sent = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const userId = row.user_id;
    if (!userId) continue;
    if (await wasEmailSentToday(service, userId, "streak_reminder", sentOn)) continue;
    const { data: uData, error: uErr } = await service.auth.admin.getUserById(userId);
    if (uErr || !uData?.user?.email) continue;
    const r = await sendStreakReminderEmail({ to: uData.user.email, appBaseUrl: cfg.appBaseUrl });
    if (r.ok) {
      await logEmailSent(service, userId, "streak_reminder", sentOn);
      sent += 1;
    } else {
      console.error("[streak email]", uData.user.email, r.error);
    }
  }
  return { ok: true, sent, date: sentOn, candidates: list.length };
}

export async function trySendWelcomeForUser(accessToken) {
  const cfg = getNotificationConfig();
  const anon = getAnonClient();
  const service = getServiceClient();
  if (!anon || !service) return { ok: false, error: "Supabase not configured on server." };
  if (!cfg.resendApiKey) return { ok: false, error: "RESEND_API_KEY not set." };

  const { data: userData, error: userErr } = await anon.auth.getUser(accessToken);
  if (userErr || !userData?.user?.id || !userData?.user?.email) {
    return { ok: false, error: userErr?.message || "Invalid session." };
  }
  const userId = userData.user.id;
  const email = userData.user.email;

  const { data: profile, error: pErr } = await service.from("profiles").select("welcome_email_sent_at").eq("id", userId).maybeSingle();
  if (pErr) return { ok: false, error: pErr.message };
  if (profile?.welcome_email_sent_at) return { ok: true, skipped: true };

  const result = await sendWelcomeEmail({ to: email, appBaseUrl: cfg.appBaseUrl });
  if (!result.ok) return { ok: false, error: result.error };

  await service.from("profiles").update({ welcome_email_sent_at: new Date().toISOString() }).eq("id", userId);

  return { ok: true, sent: true };
}
