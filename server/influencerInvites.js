import crypto from "crypto";
import { getServiceClient } from "./notifications.js";
import { getBearerUser } from "./authUser.js";

const ADMIN_TOKEN_TTL_SEC = 8 * 3600;

function randomInviteSlug(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

function randomReferralCode(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

async function reserveReferralCodeForUser(service, userId) {
  for (let i = 0; i < 120; i++) {
    const candidate = randomReferralCode(6);
    const { data: takenProf } = await service.from("profiles").select("id").eq("referral_code", candidate).maybeSingle();
    if (!takenProf || takenProf.id === userId) {
      const { data: takenRef } = await service
        .from("referrals")
        .select("referrer_id")
        .eq("referral_code", candidate)
        .maybeSingle();
      if (!takenRef || takenRef.referrer_id === userId) return candidate;
    }
  }
  return randomReferralCode(8);
}

export function createAdminToken() {
  const secret = normalizeEnv(process.env.ADMIN_SECRET);
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SEC;
  const payload = Buffer.from(JSON.stringify({ role: "admin", exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function normalizeEnv(v) {
  if (typeof v !== "string") return "";
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
}

export function verifyAdminToken(token) {
  const secret = normalizeEnv(process.env.ADMIN_SECRET);
  if (!secret || !token || typeof token !== "string") return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (json.role !== "admin" || typeof json.exp !== "number") return false;
    if (json.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function adminBearer(req) {
  const header = req.headers?.authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

export function requireAdmin(req, res, next) {
  if (!normalizeEnv(process.env.ADMIN_SECRET)) {
    return res.status(503).json({ error: "Admin access is not configured (ADMIN_SECRET)." });
  }
  const tok = adminBearer(req);
  if (!verifyAdminToken(tok)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

export async function postAdminLogin(req, res) {
  const secret = normalizeEnv(process.env.ADMIN_SECRET);
  if (!secret) {
    return res.status(503).json({ error: "ADMIN_SECRET is not set on the server." });
  }
  const password = String(req.body?.password || "");
  const passHash = crypto.createHash("sha256").update(password, "utf8").digest();
  const secretHash = crypto.createHash("sha256").update(secret, "utf8").digest();
  if (!crypto.timingSafeEqual(passHash, secretHash)) {
    return res.status(401).json({ error: "Invalid password." });
  }
  const token = createAdminToken();
  if (!token) return res.status(500).json({ error: "Could not issue token." });
  return res.json({ token });
}

export async function getAdminInvites(req, res) {
  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Database not configured." });

  const { data: invites, error } = await service
    .from("influencer_invites")
    .select("id, code, label, created_at, used_at, used_by_user_id")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const rows = [];
  for (const inv of invites || []) {
    let email = null;
    let totalDecisions = 0;
    let commissionPence = 0;

    if (inv.used_by_user_id) {
      try {
        const { data: u } = await service.auth.admin.getUserById(inv.used_by_user_id);
        email = u?.user?.email || null;
      } catch {
        email = null;
      }
      const { data: prof } = await service
        .from("profiles")
        .select("total_decisions")
        .eq("id", inv.used_by_user_id)
        .maybeSingle();
      totalDecisions = prof?.total_decisions ?? 0;

      const { data: comms } = await service
        .from("referral_commissions")
        .select("commission_pence")
        .eq("referrer_id", inv.used_by_user_id);
      commissionPence = (comms || []).reduce((s, c) => s + (Number(c.commission_pence) || 0), 0);
    }

    rows.push({
      ...inv,
      user_email: email,
      total_decisions: totalDecisions,
      referral_commission_pence: commissionPence
    });
  }

  return res.json({ invites: rows });
}

export async function postAdminCreateInvite(req, res) {
  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Database not configured." });

  const label = req.body?.label != null ? String(req.body.label).slice(0, 200) : null;

  for (let attempt = 0; attempt < 30; attempt++) {
    const code = randomInviteSlug(10);
    const { data: clash } = await service.from("influencer_invites").select("id").eq("code", code).maybeSingle();
    if (clash?.id) continue;

    const { data: row, error } = await service
      .from("influencer_invites")
      .insert({ code, label: label || null })
      .select("id, code, label, created_at")
      .single();

    if (error) {
      if (error.code === "23505") continue;
      return res.status(500).json({ error: error.message });
    }
    return res.json({ invite: row });
  }
  return res.status(500).json({ error: "Could not generate a unique code." });
}

export async function postInviteRedeem(req, res) {
  const { userId, email, error: authError } = await getBearerUser(req);
  if (!userId) return res.status(401).json({ error: authError || "Sign in to redeem an invite." });

  const code = String(req.body?.code || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(code)) {
    return res.status(400).json({ error: "Invalid invite code." });
  }

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Database not configured." });

  const { data: inv, error: invErr } = await service
    .from("influencer_invites")
    .select("id, code, used_at, used_by_user_id")
    .eq("code", code)
    .maybeSingle();

  if (invErr) return res.status(500).json({ error: invErr.message });
  if (!inv) return res.status(404).json({ error: "Invite not found." });

  if (inv.used_by_user_id) {
    if (inv.used_by_user_id === userId) {
      return res.json({ ok: true, already: true, message: "Invite already redeemed on this account." });
    }
    return res.status(410).json({ error: "This invite has already been used." });
  }

  let { data: prof } = await service.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
  if (!prof) {
    const username = String(email || "user")
      .split("@")[0]
      .replace(/[^\w\-]/g, "")
      .slice(0, 80) || "user";
    const { error: insErr } = await service.from("profiles").insert({ id: userId, username });
    if (insErr) {
      console.error("[invite redeem] profile insert", insErr);
      return res.status(500).json({ error: "Could not create your profile. Try again." });
    }
    prof = {};
  }

  let referralCode = String(prof?.referral_code || "").trim();
  if (!referralCode) {
    referralCode = await reserveReferralCodeForUser(service, userId);
  }

  const usedAt = new Date().toISOString();
  const { data: claimed, error: upInv } = await service
    .from("influencer_invites")
    .update({ used_at: usedAt, used_by_user_id: userId })
    .eq("id", inv.id)
    .is("used_at", null)
    .select("id");

  if (upInv) {
    console.error("[invite redeem] invite claim", upInv);
    return res.status(500).json({ error: "Could not claim invite. Try again." });
  }
  if (!claimed?.length) {
    return res.status(409).json({ error: "This invite was just used by someone else. Try another link." });
  }

  const { error: upProf } = await service
    .from("profiles")
    .update({
      is_pro: true,
      lifetime_pro_granted: true,
      referral_code: referralCode,
      influencer_invite_code: code
    })
    .eq("id", userId);

  if (upProf) {
    console.error("[invite redeem] profile update", upProf);
    await service.from("influencer_invites").update({ used_at: null, used_by_user_id: null }).eq("id", inv.id);
    return res.status(500).json({ error: "Could not update your profile. Try again." });
  }

  await service.from("referrals").update({ referral_code: referralCode }).eq("referrer_id", userId);

  return res.json({
    ok: true,
    referral_code: referralCode,
    message: "Welcome — lifetime Pro is unlocked on this account."
  });
}
