import Stripe from "stripe";
import { getServiceClient } from "./notifications.js";

const COMMISSION_RATE = 0.5;

/** Must match `src/lib/commerceCurrency.jsx` COMMERCE_PRICES */
const STRIPE_UNIT_AMOUNTS = {
  gbp: { month: 1499, year: 9900 },
  eur: { month: 1699, year: 9900 },
  usd: { month: 1799, year: 10900 }
};

const ALLOWED_CHECKOUT_CURRENCIES = new Set(["gbp", "eur", "usd"]);

/**
 * Stripe Connect Express account id:
 * - Denormalized on `referrals.stripe_account_id` (each row for that referrer).
 * - Fallback on `profiles.stripe_account_id` when the user has no referral rows as referrer yet (run supabase.sql to add the column).
 */
async function getReferrerStripeConnectAccountId(service, referrerId) {
  const { data: refRow, error: refErr } = await service
    .from("referrals")
    .select("stripe_account_id")
    .eq("referrer_id", referrerId)
    .not("stripe_account_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (refErr) console.error("[getReferrerStripeConnectAccountId] referrals", refErr);
  const fromRef = String(refRow?.stripe_account_id ?? "").trim();
  if (fromRef) return fromRef;

  const { data: prof, error: profErr } = await service
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", referrerId)
    .maybeSingle();
  if (profErr) console.error("[getReferrerStripeConnectAccountId] profiles", profErr);
  return String(prof?.stripe_account_id ?? "").trim() || null;
}

async function persistReferrerStripeConnectAccountId(service, referrerId, stripeAccountId) {
  const { error: profErr } = await service
    .from("profiles")
    .update({ stripe_account_id: stripeAccountId })
    .eq("id", referrerId);
  if (profErr) {
    const msg = String(profErr.message || profErr.details || "");
    if (/stripe_account_id|column.*does not exist|schema cache|PGRST204/i.test(msg)) {
      console.warn("[persistReferrerStripeConnectAccountId] profiles update skipped:", msg);
    } else {
      console.error("[persistReferrerStripeConnectAccountId] profiles", profErr);
      throw new Error(profErr.message);
    }
  }

  const { error: refErr } = await service
    .from("referrals")
    .update({ stripe_account_id: stripeAccountId })
    .eq("referrer_id", referrerId);
  if (refErr) {
    console.error("[persistReferrerStripeConnectAccountId] referrals", refErr);
    throw new Error(refErr.message);
  }

  const stored = await getReferrerStripeConnectAccountId(service, referrerId);
  if (stored !== stripeAccountId) {
    throw new Error(
      "Could not persist Stripe Connect account id. Add profiles.stripe_account_id (see supabase.sql) or ensure at least one referrals row exists where this user is the referrer."
    );
  }
}

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

/** Origin used for Stripe Checkout success/cancel (defaults to APP_BASE_URL; optional STRIPE_CHECKOUT_RETURN_ORIGIN overrides). */
function checkoutReturnOrigin(appBaseUrl) {
  const override = normalizeEnvValue(process.env.STRIPE_CHECKOUT_RETURN_ORIGIN);
  if (override) {
    try {
      const o = new URL(override);
      return `${o.protocol}//${o.host}`;
    } catch {
      // fall through to APP_BASE_URL
    }
  }
  const base = String(appBaseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  return base || "https://decideforme.org";
}

/**
 * @param {import("stripe").Stripe} stripe
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {string} appBaseUrl
 * @param {() => { userId: string | null, error: string | null }} getUser
 */
export async function createCheckoutSessionHandler(stripe, req, res, appBaseUrl, getUser) {
  const plan = String(req.body?.plan || "month").toLowerCase() === "year" ? "year" : "month";
  let currency = String(req.body?.currency || "usd").toLowerCase().trim();
  if (!ALLOWED_CHECKOUT_CURRENCIES.has(currency)) currency = "usd";

  const { userId, error: authError } = await getUser();
  if (!userId) {
    return res.status(401).json({ error: authError || "Sign in to subscribe." });
  }

  const isYear = plan === "year";
  const unitAmount = STRIPE_UNIT_AMOUNTS[currency]?.[isYear ? "year" : "month"];
  if (unitAmount == null) {
    return res.status(400).json({ error: "Unsupported currency." });
  }
  const interval = isYear ? "year" : "month";
  const curUpper = currency.toUpperCase();
  const label = isYear ? `Decide For Me Pro (yearly, ${curUpper})` : `Decide For Me Pro (monthly, ${curUpper})`;
  const returnOrigin = checkoutReturnOrigin(appBaseUrl);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            recurring: { interval },
            product_data: {
              name: label,
              description: "Unlimited decisions, full Life Mode, and priority features."
            }
          }
        }
      ],
      client_reference_id: userId,
      metadata: { supabase_user_id: userId, plan, billing_currency: currency },
      subscription_data: {
        trial_period_days: 3,
        metadata: { supabase_user_id: userId, plan, billing_currency: currency }
      },
      success_url: `${returnOrigin}/?checkout=success`,
      cancel_url: `${returnOrigin}/plans?checkout=cancelled`
    });

    return res.json({ url: session.url, plan, currency });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Stripe checkout failed." });
  }
}

/**
 * @param {import("stripe").Stripe} stripe
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {string} appBaseUrl
 * @param {() => Promise<{ userId: string | null, error: string | null }>} getUser
 */
export async function createConnectAccountLinkHandler(stripe, req, res, appBaseUrl, getUser) {
  const { userId, error: authError } = await getUser();
  if (!userId) return res.status(401).json({ error: authError || "Sign in required." });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Server missing Supabase service role." });

  try {
    let accountId = await getReferrerStripeConnectAccountId(service, userId);

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        capabilities: { transfers: { requested: true } },
        metadata: { supabase_user_id: userId },
        business_profile: {
          url: appBaseUrl.replace(/\/$/, ""),
          mcc: "5734"
        }
      });
      accountId = account.id;
      await persistReferrerStripeConnectAccountId(service, userId, accountId);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appBaseUrl}/profile?connect=refresh`,
      return_url: `${appBaseUrl}/profile?connect=return`,
      type: "account_onboarding"
    });

    return res.json({ url: link.url });
  } catch (error) {
    console.error("[stripe connect]", error);
    return res.status(500).json({ error: error.message || "Connect onboarding failed." });
  }
}

/**
 * POST /api/affiliate/connect
 * Creates (or reuses) Stripe Connect Express account and returns onboarding URL.
 */
export async function createAffiliateConnectHandler(stripe, req, res, appBaseUrl, getUser) {
  const { userId, error: authError } = await getUser();
  if (!userId) return res.status(401).json({ error: authError || "Sign in required." });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Server missing Supabase service role." });

  try {
    let accountId = await getReferrerStripeConnectAccountId(service, userId);
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        capabilities: { transfers: { requested: true } },
        metadata: { supabase_user_id: userId },
        business_profile: {
          url: appBaseUrl.replace(/\/$/, ""),
          mcc: "5734"
        }
      });
      accountId = account.id;
      await persistReferrerStripeConnectAccountId(service, userId, accountId);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appBaseUrl}/profile?connect=refresh`,
      return_url: `${appBaseUrl}/profile?connect=return`,
      type: "account_onboarding"
    });

    return res.json({ url: link.url, stripe_account_id: accountId });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Connect onboarding failed." });
  }
}

/**
 * GET /api/affiliate/connect/status
 * Returns whether the logged-in user's Stripe Connect account is fully onboarded.
 */
export async function getAffiliateConnectStatusHandler(stripe, req, res, getUser) {
  const header = req.headers?.authorization || "";
  console.log("[affiliate/connect/status] auth header present:", Boolean(header), "prefix:", header.slice(0, 12));
  const { userId, error: authError } = await getUser();
  if (!userId) return res.status(401).json({ error: authError || "Sign in required." });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Server missing Supabase service role." });

  try {
    const accountId = await getReferrerStripeConnectAccountId(service, userId);
    if (!accountId) {
      return res.json({ connected: false, onboarded: false });
    }

    const account = await stripe.accounts.retrieve(accountId);
    const onboarded = Boolean(account.details_submitted && account.payouts_enabled);
    return res.json({ connected: true, onboarded, stripe_account_id: accountId });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not check connect status." });
  }
}

/**
 * POST /api/affiliate/payout
 * Transfers all unpaid commissions to connected & onboarded affiliates.
 */
export async function runAffiliatePayoutHandler(stripe, req, res) {
  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Server missing Supabase service role." });

  try {
    const { data: unpaid, error: uErr } = await service
      .from("referral_commissions")
      .select("id, referrer_id, commission_pence, stripe_invoice_id")
      .is("stripe_transfer_id", null);
    if (uErr) return res.status(400).json({ error: uErr.message });

    const byReferrer = new Map();
    for (const row of unpaid || []) {
      const key = row.referrer_id;
      if (!byReferrer.has(key)) byReferrer.set(key, { total: 0, rows: [] });
      const slot = byReferrer.get(key);
      slot.total += Number(row.commission_pence || 0);
      slot.rows.push(row);
    }

    let paidReferrers = 0;
    let paidRows = 0;
    let skipped = 0;
    for (const [referrerId, payload] of byReferrer.entries()) {
      if (payload.total < 1) {
        skipped += 1;
        continue;
      }

      const accountId = await getReferrerStripeConnectAccountId(service, referrerId);
      if (!accountId) {
        skipped += 1;
        continue;
      }

      const account = await stripe.accounts.retrieve(accountId);
      const onboarded = Boolean(account.details_submitted && account.payouts_enabled);
      if (!onboarded) {
        skipped += 1;
        continue;
      }

      const transfer = await stripe.transfers.create({
        amount: payload.total,
        currency: "gbp",
        destination: accountId,
        metadata: {
          referrer_id: referrerId,
          payout_batch_size: String(payload.rows.length),
          payout_type: "monthly_affiliate_commission"
        }
      });

      for (const row of payload.rows) {
        await service
          .from("referral_commissions")
          .update({ stripe_transfer_id: transfer.id })
          .eq("id", row.id);
      }
      await service.rpc("reset_referrer_total_earnings", { p_referrer_id: referrerId }).catch(() => {});

      paidReferrers += 1;
      paidRows += payload.rows.length;
    }

    return res.json({ ok: true, paid_referrers: paidReferrers, paid_commissions: paidRows, skipped_referrers: skipped });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Payout run failed." });
  }
}

/**
 * GET /api/affiliate/dashboard
 * Authenticated affiliate stats endpoint.
 */
export async function getAffiliateDashboardHandler(req, res, getUser) {
  const header = req.headers?.authorization || "";
  console.log("[affiliate/dashboard] auth header present:", Boolean(header), "prefix:", header.slice(0, 12));
  const { userId, error: authError } = await getUser();
  if (!userId) {
    const msg =
      authError === "Missing bearer token."
        ? "Missing Authorization bearer token."
        : authError === "Invalid token."
          ? "Invalid or expired auth token."
          : authError || "Unauthorized.";
    return res.status(401).json({ error: msg });
  }

  const out = await fetchReferralDashboard(userId);
  return res.json({
    clicks: out.clicks ?? 0,
    signups: out.signups ?? 0,
    paying_users: out.paying_users ?? 0,
    total_earnings_pence: out.total_earnings_pence ?? 0
  });
}

/**
 * POST /api/affiliate/conversion
 * Records a successful referred Pro conversion.
 */
export async function recordAffiliateConversionHandler(req, res, getUser) {
  const { userId, error: authError } = await getUser();
  if (!userId) return res.status(401).json({ error: authError || "Unauthorized." });

  const referralCode = String(req.body?.referral_code || "")
    .trim()
    .toLowerCase();
  if (!referralCode) return res.status(400).json({ error: "Missing referral_code." });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Database not configured." });

  try {
    const { data: refProf, error: findErr } = await service
      .from("profiles")
      .select("id")
      .eq("referral_code", referralCode)
      .maybeSingle();
    if (findErr) return res.status(400).json({ error: findErr.message });
    const referrerId = refProf?.id;
    if (!referrerId) return res.status(404).json({ error: "Referral code not found." });
    if (referrerId === userId) return res.status(400).json({ error: "Self-referrals are not allowed." });

    await service.rpc("record_affiliate_conversion", {
      p_referrer_id: referrerId,
      p_increment_pence: 749
    });

    return res.json({ ok: true, referrer_id: referrerId, commission_pence: 749 });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not record conversion." });
  }
}

/**
 * @param {import("stripe").Stripe} stripe
 */
export async function handleStripeWebhook(stripe, req, res) {
  const webhookSecret = normalizeEnvValue(process.env.STRIPE_WEBHOOK_SECRET);
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    if (!webhookSecret) {
      console.warn("[stripe webhook] STRIPE_WEBHOOK_SECRET not set; skipping verify.");
      event = JSON.parse(req.body.toString());
    } else {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    }
  } catch (err) {
    console.error("[stripe webhook]", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const service = getServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.supabase_user_id;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (service && userId && customerId) {
          await service
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
              is_pro: true
            })
            .eq("id", userId);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        await processCommissionForInvoice(stripe, service, invoice);
        break;
      }
      case "customer.subscription.deleted":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const userId = sub.metadata?.supabase_user_id;
        const active = sub.status === "active" || sub.status === "trialing";
        if (service && userId) {
          const { data: lifetimeRow } = await service
            .from("profiles")
            .select("lifetime_pro_granted")
            .eq("id", userId)
            .maybeSingle();
          if (lifetimeRow?.lifetime_pro_granted) {
            break;
          }
          await service.from("profiles").update({ is_pro: active }).eq("id", userId);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[stripe webhook handler]", e);
    return res.status(500).json({ error: e.message });
  }

  return res.json({ received: true });
}

async function processCommissionForInvoice(stripe, service, invoice) {
  if (!service) {
    console.warn("[commission] no Supabase service client");
    return;
  }

  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const customerId = invoice.customer;
  const amountPaid = invoice.amount_paid || 0;
  if (!amountPaid || !customerId) return;

  let userId = invoice.subscription_details?.metadata?.supabase_user_id;
  if (!userId) {
    const sub = await stripe.subscriptions.retrieve(typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id);
    userId = sub.metadata?.supabase_user_id;
  }
  if (!userId) {
    const { data: prof } = await service.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = prof?.id;
  }
  if (!userId) return;

  const { data: payProfile } = await service
    .from("profiles")
    .select("id, referred_by")
    .eq("id", userId)
    .maybeSingle();
  if (!payProfile?.referred_by) return;

  const referrerId = payProfile.referred_by;

  const commission = Math.floor(amountPaid * COMMISSION_RATE);
  if (commission < 1) return;

  // Monthly payout job handles transfers; keep commission rows unpaid until batch payout.
  const transferId = null;

  let planInterval = "month";
  try {
    const fullSub = await stripe.subscriptions.retrieve(
      typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id
    );
    const interval = fullSub.items?.data?.[0]?.price?.recurring?.interval;
    if (interval === "year") planInterval = "year";
  } catch {
    /* ignore */
  }

  const { error: insErr } = await service.from("referral_commissions").insert({
    referrer_id: referrerId,
    referred_user_id: userId,
    invoice_amount_pence: amountPaid,
    commission_pence: commission,
    stripe_transfer_id: transferId,
    stripe_invoice_id: invoice.id,
    plan_interval: planInterval
  });

  if (insErr && !String(insErr.message || "").includes("duplicate")) {
    console.error("[referral_commissions insert]", insErr);
  }

  if (!insErr) {
    // Keep denormalized running balance in referrals for payout/status queries.
    await service.rpc("increment_referrer_total_earnings", {
      p_referrer_id: referrerId,
      p_increment_pence: commission
    }).catch(() => {});
  }
}

/** Referral leaderboard — uses service role (see getServiceClient / SUPABASE_SERVICE_ROLE_KEY). */
export async function fetchReferralLeaderboard(limit = 50) {
  const service = getServiceClient();
  if (!service) {
    console.warn("[fetchReferralLeaderboard] Missing SUPABASE_URL or service role key (SUPABASE_SERVICE_ROLE_KEY).");
    return { rows: [] };
  }

  const { data: refRows, error: refErr } = await service
    .from("referrals")
    .select("referrer_id, total_earnings_pence, paying_users");
  if (refErr) {
    console.error("[fetchReferralLeaderboard] referrals select", refErr);
    return { rows: [] };
  }

  const { data: commRows, error: commErr } = await service
    .from("referral_commissions")
    .select("referrer_id, referred_user_id, commission_pence");
  if (commErr) {
    console.error("[fetchReferralLeaderboard] referral_commissions select", commErr);
  }

  const byReferrer = new Map();

  for (const row of refRows || []) {
    const rid = row.referrer_id;
    if (!rid) continue;
    if (!byReferrer.has(rid)) {
      byReferrer.set(rid, {
        signups: 0,
        tableEarningsPence: 0,
        tablePayingUsers: 0,
        commTotalPence: 0,
        payingUserIdsFromComm: new Set()
      });
    }
    const agg = byReferrer.get(rid);
    agg.signups += 1;
    agg.tableEarningsPence = Math.max(agg.tableEarningsPence, row.total_earnings_pence || 0);
    agg.tablePayingUsers = Math.max(agg.tablePayingUsers, row.paying_users || 0);
  }

  for (const row of commRows || []) {
    const rid = row.referrer_id;
    if (!rid) continue;
    if (!byReferrer.has(rid)) {
      byReferrer.set(rid, {
        signups: 0,
        tableEarningsPence: 0,
        tablePayingUsers: 0,
        commTotalPence: 0,
        payingUserIdsFromComm: new Set()
      });
    }
    const agg = byReferrer.get(rid);
    agg.commTotalPence += row.commission_pence || 0;
    if (row.referred_user_id) agg.payingUserIdsFromComm.add(row.referred_user_id);
  }

  const ids = [...byReferrer.keys()];
  if (!ids.length) return { rows: [] };

  const { data: profs, error: profErr } = await service.from("profiles").select("id, username, public_ref_slug").in("id", ids);
  if (profErr) console.error("[fetchReferralLeaderboard] profiles select", profErr);
  const profById = new Map((profs || []).map((p) => [p.id, p]));

  const enriched = [];
  for (const [referrerId, agg] of byReferrer) {
    const totalCommissionPence = Math.max(agg.tableEarningsPence, agg.commTotalPence);
    const payingUsers = Math.max(agg.tablePayingUsers, agg.payingUserIdsFromComm.size);
    const prof = profById.get(referrerId);
    enriched.push({
      referrer_id: referrerId,
      username: prof?.username || "Creator",
      public_ref_slug: prof?.public_ref_slug || "",
      signups: agg.signups,
      paying_users: payingUsers,
      total_commission_pence: totalCommissionPence
    });
  }

  enriched.sort(
    (a, b) =>
      b.total_commission_pence - a.total_commission_pence ||
      b.paying_users - a.paying_users ||
      b.signups - a.signups
  );
  return { rows: enriched.slice(0, limit) };
}

export async function fetchReferralDashboard(userId) {
  const service = getServiceClient();
  if (!service) {
    return { clicks: 0, signups: 0, paying_users: 0, total_earnings_pence: 0 };
  }

  const { count: clickCount } = await service
    .from("referral_link_clicks")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", userId);

  const { data: refRows } = await service.from("referrals").select("referred_id").eq("referrer_id", userId);

  const { data: commissions } = await service
    .from("referral_commissions")
    .select("referred_user_id, commission_pence")
    .eq("referrer_id", userId);

  const payingIds = new Set((commissions || []).map((c) => c.referred_user_id));
  const totalEarnings = (commissions || []).reduce((s, c) => s + (c.commission_pence || 0), 0);

  return {
    clicks: clickCount || 0,
    signups: refRows?.length || 0,
    paying_users: payingIds.size,
    total_earnings_pence: totalEarnings
  };
}

export async function recordReferralClick(codeOrSlug) {
  const service = getServiceClient();
  if (!service) return { ok: false, error: "Server misconfigured." };
  const normalized = String(codeOrSlug || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(normalized)) return { ok: false, error: "Invalid slug." };

  let { data: prof } = await service.from("profiles").select("id").eq("public_ref_slug", normalized).maybeSingle();
  if (!prof?.id) {
    const { data: byCode } = await service.from("profiles").select("id").eq("referral_code", normalized).maybeSingle();
    prof = byCode || null;
  }
  if (!prof?.id) return { ok: false, error: "Not found." };

  await service.from("referral_link_clicks").insert({ referrer_id: prof.id });
  await service.rpc("increment_referral_clicks_for_referrer", { p_referrer_id: prof.id }).catch(() => {});
  return { ok: true };
}
