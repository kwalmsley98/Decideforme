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
        trial_period_days: 7,
        metadata: { supabase_user_id: userId, plan, billing_currency: currency }
      },
      success_url: `${appBaseUrl}/?checkout=success`,
      cancel_url: `${appBaseUrl}/plans?checkout=cancelled`
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
    const { data: profile, error: pErr } = await service
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", userId)
      .single();
    if (pErr) return res.status(400).json({ error: pErr.message });

    let accountId = profile?.stripe_connect_account_id;

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
      await service.from("profiles").update({ stripe_connect_account_id: accountId }).eq("id", userId);
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
    const { data: profile, error: pErr } = await service
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", userId)
      .single();
    if (pErr) return res.status(400).json({ error: pErr.message });

    let accountId = profile?.stripe_connect_account_id;
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
      await service.from("profiles").update({ stripe_connect_account_id: accountId }).eq("id", userId);
    }

    // Keep referrals table in sync for affiliate-specific queries.
    await service.from("referrals").update({ stripe_account_id: accountId }).eq("referrer_id", userId);

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
  const { userId, error: authError } = await getUser();
  if (!userId) return res.status(401).json({ error: authError || "Sign in required." });

  const service = getServiceClient();
  if (!service) return res.status(503).json({ error: "Server missing Supabase service role." });

  try {
    const { data: profile, error: pErr } = await service
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", userId)
      .maybeSingle();
    if (pErr) return res.status(400).json({ error: pErr.message });

    const accountId = profile?.stripe_connect_account_id || null;
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

      const { data: profile } = await service
        .from("profiles")
        .select("stripe_connect_account_id")
        .eq("id", referrerId)
        .maybeSingle();
      const accountId = profile?.stripe_connect_account_id;
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
  if (out.error) return res.status(503).json({ error: out.error });
  return res.json(out);
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

/** Referral leaderboard + dashboard queries — requires service client */
export async function fetchReferralLeaderboard(limit = 50) {
  const service = getServiceClient();
  if (!service) return { error: "Database not configured." };

  const { data: commRows, error: cErr } = await service
    .from("referral_commissions")
    .select("referrer_id, referred_user_id, commission_pence");
  if (cErr) return { error: cErr.message };

  const { data: refRows, error: rErr } = await service.from("referrals").select("referrer_id");
  if (rErr) return { error: rErr.message };

  const byReferrer = new Map();
  for (const row of commRows || []) {
    const rid = row.referrer_id;
    if (!byReferrer.has(rid)) {
      byReferrer.set(rid, { commissionTotal: 0, payingUserIds: new Set(), signups: 0 });
    }
    const agg = byReferrer.get(rid);
    agg.commissionTotal += row.commission_pence || 0;
    agg.payingUserIds.add(row.referred_user_id);
  }

  const signupBy = new Map();
  for (const row of refRows || []) {
    signupBy.set(row.referrer_id, (signupBy.get(row.referrer_id) || 0) + 1);
  }

  const allIds = new Set([...byReferrer.keys(), ...signupBy.keys()]);
  const enriched = [];
  for (const referrerId of allIds) {
    const agg = byReferrer.get(referrerId) || {
      commissionTotal: 0,
      payingUserIds: new Set(),
      signups: 0
    };
    const signups = signupBy.get(referrerId) || 0;
    const { data: prof } = await service.from("profiles").select("username, public_ref_slug").eq("id", referrerId).maybeSingle();
    enriched.push({
      referrer_id: referrerId,
      username: prof?.username || "Creator",
      public_ref_slug: prof?.public_ref_slug || "",
      signups,
      paying_users: agg.payingUserIds.size,
      total_commission_pence: agg.commissionTotal
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
  if (!service) return { error: "Database not configured." };

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
