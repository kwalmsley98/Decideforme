import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { toPng } from "html-to-image";
import { SeoLandingPage, SEO_LANDING_ROUTES } from "./SeoLandingPage.jsx";
import { DocumentMeta, applyPageMeta, SITE_CANONICAL } from "./seoMeta.jsx";
import { TermsOfServicePage, PrivacyPolicyPage, CookiePolicyPage } from "./LegalPages.jsx";
import { DAILY_FREE_DECISION_LIMIT } from "./constants/freeTier.js";
import {
  ArrowUp,
  BadgePercent,
  BarChart2,
  Clock,
  Copy,
  Compass,
  Download,
  Flame,
  History,
  LogIn,
  MessageCircle,
  Paperclip,
  ShieldAlert,
  Sparkles,
  Trophy,
  User,
  Users,
  Zap,
  X
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { CommerceCurrencyProvider, useCommerceCurrency } from "./lib/commerceCurrency.jsx";
import {
  attachCommunitySplitsToOrders,
  buildFallbackLifeOrder,
  buildLifeOrders,
  calendarDayKeyInTimeZone,
  computeEngagementPercent,
  fetchOpenMeteoCurrent,
  filterOrdersFromLocalNow,
  formatLocalTimeShort,
  formatOrderTimeLabel,
  getDayPhaseForNow,
  getUserTimeZone,
  pickCheckIn,
  pickCodename,
  pulseLineForDay,
  roastFromCompliance,
  summarizeLifeDayVirality
} from "./lifeModeV2.js";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiUrl = (path) => `${API_BASE_URL}${path}`;
const DFM_INVITE_STORAGE_KEY = "dfm_influencer_invite_code";
const DFM_ADMIN_TOKEN_KEY = "dfm_admin_token";

function formatGbpFromPence(pence) {
  const n = Number(pence);
  if (!Number.isFinite(n)) return "£0.00";
  return `£${(n / 100).toFixed(2)}`;
}

function isStripeHostedCheckoutUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "checkout.stripe.com" || h.endsWith(".stripe.com");
  } catch {
    return false;
  }
}

/** Calls POST /api/create-checkout-session; throws with actionable messages if the response is HTML or invalid. Empty VITE_API_BASE_URL uses same-origin `/api` (Vite dev proxy or hosting reverse-proxy). */
async function fetchStripeCheckoutSessionUrl(accessToken, body) {
  let response;
  try {
    response = await fetch(apiUrl("/api/create-checkout-session"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? "");
    const looksNetwork =
      e instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(msg.toLowerCase());
    throw new Error(
      looksNetwork
        ? "Could not reach the payment server. Check your connection; if this keeps happening, set VITE_API_BASE_URL to your API host (or configure the host to proxy /api to the backend)."
        : msg || "Could not start checkout."
    );
  }
  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    const looksLikeHtml = /^\s*</.test(rawText) || /<!DOCTYPE/i.test(rawText);
    const hint = looksLikeHtml
      ? "This app is calling the wrong server (often VITE_API_BASE_URL is unset, so the site returns HTML instead of JSON). Set VITE_API_BASE_URL to your API server and redeploy."
      : `Unexpected response: ${rawText.slice(0, 120).replace(/\s+/g, " ")}`;
    throw new Error(`Could not start checkout. ${hint}`);
  }
  if (!response.ok) {
    const msg = typeof data?.error === "string" ? data.error : "";
    throw new Error(msg || `Checkout failed (HTTP ${response.status}). Try again or contact support.`);
  }
  const url = data?.url;
  if (typeof url !== "string" || !isStripeHostedCheckoutUrl(url)) {
    throw new Error(
      "Checkout did not return a valid Stripe payment link. Check server logs and that STRIPE_SECRET_KEY is set on the API host."
    );
  }
  return url;
}

async function resolveAccessToken(preferredToken) {
  if (typeof preferredToken === "string" && preferredToken.trim()) return preferredToken;
  if (!supabase) return "";
  try {
    const {
      data: { session: authSession }
    } = await supabase.auth.getSession();
    return authSession?.access_token || "";
  } catch {
    return "";
  }
}

/**
 * Navigates to Stripe Checkout. If the tab does not unload (blocked redirect), onStuck runs after a delay so the button does not stay stuck on "Redirecting…".
 */
function goToStripeCheckout(url, { onStuck }) {
  try {
    window.location.assign(url);
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : "";
    throw new Error(
      msg || "Could not open Stripe Checkout. Try disabling extensions that block redirects, or use another browser."
    );
  }
  window.setTimeout(() => {
    onStuck?.();
  }, 12000);
}

function slugifyPublicRef(input) {
  const s = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return s || "friend";
}

async function generateUniquePublicRefSlug(supabaseClient, baseName) {
  const base = slugifyPublicRef(baseName);
  for (let i = 0; i < 12; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 8)}`;
    const { data } = await supabaseClient.from("profiles").select("id").eq("public_ref_slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 10)}`;
}

const EMPTY_REFERRAL_DASH = {
  clicks: 0,
  signups: 0,
  paying_users: 0,
  total_earnings_pence: 0
};

function randomReferralCode(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function reserveRandomReferralCode(userId) {
  for (let i = 0; i < 120; i++) {
    const candidate = randomReferralCode(6);
    const { data: takenInReferrals } = await supabase
      .from("referrals")
      .select("referrer_id")
      .eq("referral_code", candidate)
      .maybeSingle();
    if (takenInReferrals && takenInReferrals.referrer_id !== userId) continue;
    const { data: takenInProfiles } = await supabase.from("profiles").select("id").eq("referral_code", candidate).maybeSingle();
    if (!takenInProfiles || takenInProfiles.id === userId) return candidate;
  }
  return randomReferralCode(6);
}
/** Once set, onboarding overlay is never shown again on this device. */
const DFM_ONBOARDED_KEY = "dfm_onboarded";
const LEGACY_ONBOARDING_KEY = "decide_for_me_onboarding_done";

const NEARBY_RADIUS_OPTIONS = [
  { label: "0.5 miles", meters: 800 },
  { label: "1 mile", meters: 1600 },
  { label: "5 miles", meters: 8000 }
];
const DEFAULT_NEARBY_RADIUS_METERS = 1600;

const DAILY_LIBRARY = [
  {
    prompt: "Would you rather have unlimited money or unlimited time?",
    options: ["Unlimited money", "Unlimited time"]
  },
  {
    prompt: "Which wins tonight: spontaneous fun or cozy reset?",
    options: ["Spontaneous fun", "Cozy reset"]
  },
  {
    prompt: "Better long-term life move right now?",
    options: ["Take the bigger risk", "Play it smart and steady"]
  }
];

function shouldUseNearby(text) {
  const value = String(text || "").toLowerCase();
  const terms = ["near me", "nearby", "close to me", "around me", "walking distance", "in my area"];
  return terms.some((term) => value.includes(term));
}

/** Whether to show “Find places near me” after this user message (food / drink / activity). */
function shouldShowFindPlacesCta(text) {
  const v = String(text || "").toLowerCase();
  const localIntent =
    shouldUseNearby(v) ||
    /\b(near me|nearby|around here|in my area|close by|walking distance|local|locally)\b/.test(v) ||
    /\b(in|around|near)\s+(london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|my city|town|area|neighborhood|neighbourhood)\b/.test(
      v
    );
  if (!localIntent) return false;

  const placeTopic =
    /\b(restaurant|bar|pub|cafe|coffee shop|nightlife|things to do|activity|activities|attraction|museum|park|cinema|movie theater|shopping|mall|gym|venue|spot|place)\b/.test(
      v
    ) || /\b(where should i go|where to go|what should i do nearby|what to do nearby)\b/.test(v);
  if (!placeTopic) return false;

  const nonLocalOrHomeContext =
    /\b(at home|cook at home|home recipe|recipe|cook|cooking|stream|netflix|prime video|disney\+|movie night|film recommendation|travel itinerary|flight|country|abroad|road trip)\b/.test(
      v
    );
  return !nonLocalOrHomeContext;
}

/** Maps user prompt to server /api/nearby-places `type` for Places includedTypes */
function inferNearbyPlaceType(text) {
  const v = String(text || "").toLowerCase();

  if (/\bmuseum\b/.test(v)) return "museum";
  if (/\b(national park|city park)\b/.test(v) || (/\bpark\b/.test(v) && !/parking/i.test(v))) return "park";

  if (
    /\b(hotel|motel|hostel|inn)\b/.test(v) ||
    /\b(lodging|airbnb|place to stay)\b/.test(v) ||
    /(travel|trip|vacation|getaway|\bstaycation\b|flight)/i.test(v)
  ) {
    return "travel";
  }

  if (/\b(cafe|coffee shop)\b/.test(v) || /\bcoffee\b/.test(v)) return "cafe";

  if (/(cinema|movie theater|movie theatre|imax|\bflix\b|watch a movie)/i.test(v) || /\bmovies\b/.test(v)) return "cinema";

  if (/\b(gym|fitness|workout)\b/.test(v)) return "gym";

  if (/(shopping|mall|boutique|retail|outlet|department store|clothes|clothing)/i.test(v) || /\bshop\b/.test(v))
    return "shopping";

  if (
    /(food|eat|restaurant|dinner|lunch|breakfast|brunch|meal|takeout|takeaway|snack|dining|seafood|sushi|pizza|burger|kitchen)/i.test(
      v
    )
  ) {
    return "food";
  }

  if (/(nightlife|night club|nightclub|clubbing|dance club|\bpub crawl\b)/i.test(v)) return "nightlife";

  if (/\b(pub|brewpub|speakeasy)\b/.test(v)) return "bar";
  if (/\b(bar|bars|brewery|wine bar|cocktail)\b/i.test(v) && !/barbecue|bbq|barbell|handlebar|handlebars/i.test(v)) {
    return "bar";
  }

  if (
    /(activity|things to do|something to do|entertainment|attraction|tourist|visit|explore|day out|what to do|fun things|going out)/i.test(
      v
    ) ||
    /\b(bowling|arcade|mini golf|escape room)\b/i.test(v)
  ) {
    return "activity";
  }

  return "food";
}

function trimDecisionSnippet(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function clampShareCardLine(text, max = 220) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Strip UI-only messages and extra fields before sending history to the AI */
function conversationForApi(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const base = { role: m.role, content: m.content ?? "" };
      if (m.role === "user" && m.imageBase64 && m.imageMediaType) {
        return { ...base, imageBase64: m.imageBase64, imageMediaType: m.imageMediaType };
      }
      return base;
    });
}

/** Avoid storing large base64 blobs in Supabase */
function conversationForStorage(messages) {
  return (Array.isArray(messages) ? messages : []).map((m) => {
    if (m.role === "user" && m.imageBase64) {
      const text = typeof m.content === "string" ? m.content.trim() : "";
      return { role: "user", content: text || "[Photo]" };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content ?? "",
        ...(Array.isArray(m.bookingLinks) && m.bookingLinks.length ? { bookingLinks: m.bookingLinks } : {})
      };
    }
    return { role: m.role, content: m.content ?? "" };
  });
}

/** Persist full chat threads (includes nearby pills; no vision blobs) */
function conversationForChatHistoryStorage(messages) {
  return (Array.isArray(messages) ? messages : []).map((m) => {
    if (m.role === "nearby" && Array.isArray(m.places)) {
      return { role: "nearby", places: m.places };
    }
    if (m.role === "user" && m.imageBase64) {
      const text = typeof m.content === "string" ? m.content.trim() : "";
      return { role: "user", content: text || "[Photo]" };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content ?? "",
        ...(Array.isArray(m.bookingLinks) && m.bookingLinks.length ? { bookingLinks: m.bookingLinks } : {})
      };
    }
    if (m.role === "user" || m.role === "assistant") {
      return { role: m.role, content: m.content ?? "" };
    }
    return null;
  }).filter(Boolean);
}

function hydrateConversationFromHistory(stored) {
  const arr = Array.isArray(stored) ? stored : [];
  const out = [];
  for (const m of arr) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "nearby" && Array.isArray(m.places)) {
      out.push({ role: "nearby", places: m.places });
      continue;
    }
    if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: String(m.content ?? ""),
        ...(Array.isArray(m.bookingLinks) && m.bookingLinks.length ? { bookingLinks: m.bookingLinks } : {})
      });
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: String(m.content ?? "") });
    }
  }
  return out;
}

function chatTitleFromFirstTurn(messages) {
  const firstUser = (Array.isArray(messages) ? messages : []).find((m) => m?.role === "user");
  const raw = typeof firstUser?.content === "string" ? firstUser.content.trim() : "";
  const t = trimDecisionSnippet(raw, 72);
  return t || "New conversation";
}

/** Preference extraction only needs text — omit vision payloads */
function conversationForPreferenceExtract(messages) {
  return conversationForApi(messages).map((m) => {
    if (m.role === "user" && m.imageBase64) {
      const text = typeof m.content === "string" ? m.content.trim() : "";
      return { role: "user", content: text ? `${text} [photo]` : "[photo]" };
    }
    return m;
  });
}

async function compressImageToJpeg(file, maxEdge = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const { width: w, height: h } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(w, h, 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read image.");
  ctx.drawImage(bitmap, 0, 0, cw, ch);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Could not process image.");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
  const comma = String(dataUrl).indexOf(",");
  const base64 = comma >= 0 ? String(dataUrl).slice(comma + 1) : "";
  if (!base64) throw new Error("Could not process image.");
  return { base64, mediaType: "image/jpeg" };
}

function buildNearbyPickReason({ userPrompt, assistantReply, cuisineType }, index) {
  const cue = trimDecisionSnippet(userPrompt, 42);
  const aiHint = trimDecisionSnippet(assistantReply, 48);
  const cat = cuisineType || "local spot";
  const lead = aiHint ? `Given your decision (“${aiHint}”) and “${cue}”, ` : `For “${cue}”, `;
  const lines = [
    `${lead}this ${cat} is a strong nearby match by distance and ratings.`,
    `${lead}another well-rated ${cat} close by if you want a backup.`,
    `${lead}worth a look as ${cat} — consistent with what you asked.`,
    `${lead}one more ${cat} nearby from local results.`
  ];
  return lines[Math.min(index, lines.length - 1)];
}

function shareUrls(text) {
  const encoded = encodeURIComponent(text);
  return {
    whatsapp: `https://wa.me/?text=${encoded}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    x: `https://twitter.com/intent/tweet?text=${encoded}`
  };
}

/** Lifetime decision count → CoD-style prestige rank + progress to next tier */
function getDecisionRank(totalRaw) {
  const total = Math.max(0, Math.floor(Number(totalRaw) || 0));
  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  if (total <= 10) {
    const next = 11;
    return {
      tier: "recruit",
      emoji: "🔰",
      name: "Recruit",
      label: "🔰 Recruit",
      shortTag: "RCT",
      prestigeLevel: null,
      nextThreshold: next,
      nextRankLabel: "⚔️ Sergeant",
      progress: clamp01(total / next),
      rangeLabel: "0–10 decisions",
      toNext: Math.max(0, next - total)
    };
  }
  if (total <= 50) {
    const next = 51;
    return {
      tier: "sergeant",
      emoji: "⚔️",
      name: "Sergeant",
      label: "⚔️ Sergeant",
      shortTag: "SGT",
      prestigeLevel: null,
      nextThreshold: next,
      nextRankLabel: "🎖️ Lieutenant",
      progress: clamp01((total - 11) / (next - 11)),
      rangeLabel: "11–50 decisions",
      toNext: Math.max(0, next - total)
    };
  }
  if (total <= 100) {
    const next = 101;
    return {
      tier: "lieutenant",
      emoji: "🎖️",
      name: "Lieutenant",
      label: "🎖️ Lieutenant",
      shortTag: "LT",
      prestigeLevel: null,
      nextThreshold: next,
      nextRankLabel: "🏅 Commander",
      progress: clamp01((total - 51) / (next - 51)),
      rangeLabel: "51–100 decisions",
      toNext: Math.max(0, next - total)
    };
  }
  if (total <= 250) {
    const next = 251;
    return {
      tier: "commander",
      emoji: "🏅",
      name: "Commander",
      label: "🏅 Commander",
      shortTag: "CDR",
      prestigeLevel: null,
      nextThreshold: next,
      nextRankLabel: "💀 Elite",
      progress: clamp01((total - 101) / (next - 101)),
      rangeLabel: "101–250 decisions",
      toNext: Math.max(0, next - total)
    };
  }
  if (total <= 500) {
    const next = 501;
    return {
      tier: "elite",
      emoji: "💀",
      name: "Elite",
      label: "💀 Elite",
      shortTag: "ELITE",
      prestigeLevel: null,
      nextThreshold: next,
      nextRankLabel: "⭐ Prestige 1",
      progress: clamp01((total - 251) / (next - 251)),
      rangeLabel: "251–500 decisions",
      toNext: Math.max(0, next - total)
    };
  }

  const prestigeLevel = Math.floor((total - 1) / 500);
  const tierStart = 500 * (prestigeLevel - 1) + 501;
  const nextThreshold = tierStart + 500;
  return {
    tier: "prestige",
    prestigeVariant: prestigeLevel,
    emoji: "⭐",
    name: `Prestige ${prestigeLevel}`,
    label: `⭐ Prestige ${prestigeLevel}`,
    shortTag: `P${prestigeLevel}`,
    prestigeLevel,
    nextThreshold,
    nextRankLabel: `⭐ Prestige ${prestigeLevel + 1}`,
    progress: clamp01((total - tierStart) / (nextThreshold - tierStart)),
    rangeLabel: `${tierStart}–${nextThreshold - 1} decisions`,
    toNext: Math.max(0, nextThreshold - total)
  };
}

/** First user message text from stored decision_history.conversation */
function firstUserPromptFromConversation(conv) {
  if (!Array.isArray(conv)) return "";
  const u = conv.find((m) => m && m.role === "user");
  const c = u?.content;
  return typeof c === "string" ? c.trim() : "";
}

/** Topic bucket for stats (aligned with quick categories: Food, Travel, Fitness, etc.) */
function inferStatTopicFromUserText(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return "General";
  if (
    /\b(flight|flights|airport|hotel|hotels|\btrip\b|holiday|vacation|travel\b|abroad|itinerary|getaway|airbnb|booking)\b/.test(t)
  )
    return "Travel";
  if (/\b(gym|workout|fitness|exercise|\brun\b|running|lift|cardio|training|reps|steps)\b/.test(t)) return "Fitness";
  if (/\b(wellness|self-care|meditat|spa\b|therapy|sleep hygiene|mental health)\b/.test(t)) return "Wellness";
  if (/\b(game\b|gaming|playstation|xbox|nintendo|steam|multiplayer|esports)\b/.test(t)) return "Gaming";
  if (/\b(shop|shopping|\bbuy\b|purchase|amazon|cart|checkout|retail)\b/.test(t)) return "Shopping";
  if (/\b(bar|club|night out|nightlife|pub\b|going out)\b/.test(t)) return "Nightlife";
  if (/\b(watch\b|netflix|movie|film|series|stream|disney|prime video|hbo)\b/.test(t)) return "Watch";
  if (/\b(eat|food|restaurant|dinner|lunch|breakfast|takeout|cook\b|cooking|recipe|snack)\b/.test(t)) return "Food";
  return "Life & plans";
}

const DP_ANALYTICAL_RE =
  /\b(pros?\s+and\s+cons|\bpros\b|\bcons\b|compare|comparison|weigh|trade-?offs?|analyze|research|break\s+down|on\s+one\s+hand|list\s+(of\s+)?options|evaluate|versus|\bvs\.?\b)\b/i;

const DP_SOCIAL_RE =
  /\b(we\s+should|with\s+(my\s+)?friends?|\bgroup\b|date\s+night|together|\bparty\b|partner|family)\b/i;

const DP_RECONSIDER_RE =
  /\b(actually|instead|wait|not\s+sure|maybe|change\s+my\s+mind|on\s+second\s+thought|\bhmm\b|\bidk\b)\b/i;

function decisionProfileUserMessages(conv) {
  if (!Array.isArray(conv)) return [];
  return conv.filter((m) => m && m.role === "user");
}

function topicEmojiForDecisionProfile(topic) {
  const map = {
    Food: "🍕",
    Travel: "✈️",
    Fitness: "💪",
    Wellness: "💆",
    Gaming: "🎮",
    Shopping: "🛍️",
    Nightlife: "🍺",
    Watch: "🎬",
    "Life & plans": "📌",
    General: "✨"
  };
  return map[topic] || "✨";
}

function formatMedianDecisionGap(ms) {
  if (ms < 120000) return "Usually within minutes";
  if (ms < 3600000) return `About ${Math.round(ms / 60000)} min apart`;
  if (ms < 86400000) {
    const h = ms / 3600000;
    return h < 8 ? `About ${h.toFixed(1)} hours apart` : `About ${Math.round(h)} hours apart`;
  }
  const d = ms / 86400000;
  if (d < 14) return `About ${d.toFixed(1)} days apart`;
  return `About ${(d / 7).toFixed(1)} weeks apart`;
}

/** Aggregates conversation-backed signals from decision_history rows (sorted ascending by created_at inside). */
function analyzeDecisionHistoryRows(rows) {
  const raw = Array.isArray(rows) ? rows.filter((r) => r && r.conversation) : [];
  const list = [...raw].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const n = list.length;

  if (n === 0) {
    return {
      personality: {
        emoji: "✨",
        title: "Your Decision Personality",
        tagline: "Make a few calls here — we’ll translate your habits into a fun profile.",
        variant: "empty"
      },
      topics: [],
      pace: {
        label: "—",
        detail: "After two decisions we’ll show how often you tend to come back."
      },
      decisiveness: {
        score: null,
        label: "—",
        detail: "Your decisiveness score appears once we have enough to compare patterns."
      },
      avgUserTurns: 0,
      sampleSize: 0
    };
  }

  let analyticalHits = 0;
  let spontaneousHits = 0;
  let socialHits = 0;
  let reconsiderHits = 0;
  let totalUserTurns = 0;
  const topicCounts = {};

  for (const row of list) {
    const conv = row.conversation;
    const users = decisionProfileUserMessages(conv);
    const userTurns = users.length;
    totalUserTurns += userTurns;
    const allUserText = users.map((u) => String(u.content || "")).join(" ");
    const first = firstUserPromptFromConversation(conv);

    if (DP_ANALYTICAL_RE.test(allUserText)) analyticalHits += 1;
    if (DP_SOCIAL_RE.test(allUserText)) socialHits += 1;
    if (DP_RECONSIDER_RE.test(allUserText)) reconsiderHits += 1;
    if (userTurns === 1 && first.length <= 120 && !DP_ANALYTICAL_RE.test(first)) spontaneousHits += 1;

    const topic = inferStatTopicFromUserText(first);
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  }

  const analyticalRatio = analyticalHits / n;
  const spontaneousRatio = spontaneousHits / n;
  const socialRatio = socialHits / n;
  const reconsiderRatio = reconsiderHits / n;
  const avgUserTurns = totalUserTurns / n;

  let personality;
  if (n >= 4 && reconsiderRatio >= 0.38) {
    personality = {
      emoji: "🔄",
      title: "The pivot-friendly decider",
      tagline: "You explore alternatives before locking in — curiosity beats stubbornness.",
      variant: "pivot"
    };
  } else if (analyticalRatio >= 0.34 && avgUserTurns >= 1.45) {
    personality = {
      emoji: "📐",
      title: "Analytical decider",
      tagline: "You ask for structure — pros, lists, and tradeoffs feel like home.",
      variant: "analytical"
    };
  } else if (spontaneousRatio >= 0.4 && avgUserTurns <= 1.45 && reconsiderRatio < 0.28) {
    personality = {
      emoji: "⚡",
      title: "Spontaneous decider",
      tagline: "You rarely overthink — short asks, fast verdicts, let’s roll.",
      variant: "spontaneous"
    };
  } else if (socialRatio >= 0.3) {
    personality = {
      emoji: "🎉",
      title: "Social strategist",
      tagline: "People factor into your calls — dates, crews, and shared plans.",
      variant: "social"
    };
  } else if (avgUserTurns >= 2.25) {
    personality = {
      emoji: "🌊",
      title: "Deep diver",
      tagline: "You like a real back-and-forth until the answer feels right.",
      variant: "deep"
    };
  } else {
    personality = {
      emoji: "⚖️",
      title: "Balanced decider",
      tagline: "You mix gut checks with just enough detail — pragmatic and adaptable.",
      variant: "balanced"
    };
  }

  const topics = Object.entries(topicCounts)
    .map(([topic, count]) => ({ topic, count, pct: Math.round((count / n) * 100) }))
    .sort((a, b) => b.count - a.count);

  const times = list.map((r) => new Date(r.created_at).getTime()).filter((t) => !Number.isNaN(t));
  let pace;
  if (times.length >= 2) {
    const gaps = [];
    for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    pace = {
      label: formatMedianDecisionGap(median),
      detail: "Median time between completed decisions — your natural comeback rhythm."
    };
  } else {
    pace = {
      label: "One decision logged",
      detail: "Stack one more decision and we’ll chart the gap between visits."
    };
  }

  let score = 72;
  score -= Math.min(38, Math.max(0, avgUserTurns - 1) * 15);
  score -= Math.min(30, reconsiderRatio * 42);
  if (spontaneousRatio >= 0.42) score += 10;
  if (analyticalRatio >= 0.36) score -= 5;
  score = Math.max(14, Math.min(98, Math.round(score)));

  let label = "Thoughtful";
  if (score >= 82) label = "Highly decisive";
  else if (score >= 68) label = "Pretty decisive";
  else if (score >= 54) label = "Balanced";

  return {
    personality,
    topics,
    pace,
    decisiveness: {
      score,
      label,
      detail: `~${avgUserTurns.toFixed(1)} user messages per decision on average.`
    },
    avgUserTurns,
    sampleSize: n
  };
}

function nextMidnightCountdown() {
  const now = new Date();
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  const ms = Math.max(next.getTime() - now.getTime(), 0);
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function lifeModeCountdown(endTime) {
  const end = new Date(endTime).getTime();
  const now = Date.now();
  const ms = Math.max(end - now, 0);
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function launchConfetti() {
  const bucket = document.createElement("div");
  bucket.className = "confetti-bucket";
  for (let i = 0; i < 34; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.background = ["#f5e642", "#7d67ff", "#39d0ff", "#f975c8"][i % 4];
    bucket.appendChild(piece);
  }
  document.body.appendChild(bucket);
  setTimeout(() => bucket.remove(), 1800);
}

function normalizePreferenceText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function autosizeTextarea(element, maxLines = 5) {
  if (!element) return;
  const styles = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 22;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
  const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom + borderTop + borderBottom;

  element.style.height = "auto";
  const nextHeight = Math.min(element.scrollHeight, maxHeight);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
}

async function touchActivity(userId, { didDecision = false, didVote = false, mindsChanged = 0 }) {
  if (!supabase || !userId) return;
  const today = new Date().toISOString().slice(0, 10);
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (!profile) return;

  const last = profile.last_active_date || "";
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let currentStreak = profile.current_streak || 0;
  if (last === today) {
    currentStreak = profile.current_streak || 0;
  } else if (last === yesterday) {
    currentStreak += 1;
  } else {
    currentStreak = 1;
  }
  const longestStreak = Math.max(profile.longest_streak || 0, currentStreak);

  if (currentStreak > 0 && currentStreak % 7 === 0) launchConfetti();

  await supabase
    .from("profiles")
    .update({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_active_date: today,
      total_decisions: (profile.total_decisions || 0) + (didDecision ? 1 : 0),
      total_votes: (profile.total_votes || 0) + (didVote ? 1 : 0),
      minds_changed: (profile.minds_changed || 0) + mindsChanged
    })
    .eq("id", userId);
}

function LoadingOrb() {
  return (
    <div className="loading-wrap" aria-label="AI is thinking">
      <div className="orb-ring ring-1" />
      <div className="orb-ring ring-2" />
      <div className="orb-core" />
    </div>
  );
}

function LoadingAssistantShimmer() {
  return (
    <div className="message-row assistant loading-msg-row" aria-live="polite" aria-busy="true">
      <div className="avatar assistant avatar-ai-icon" aria-hidden="true">
        <Zap size={15} strokeWidth={2.2} />
      </div>
      <div className="bubble assistant shimmer-bubble">
        <div className="shimmer-line" />
        <div className="shimmer-line shimmer-line--medium" />
        <div className="shimmer-line shimmer-line--short" />
      </div>
    </div>
  );
}

function OnboardingOverlay({ onComplete }) {
  const slides = [
    {
      title: "Ask anything",
      body: "Decisions, comparisons, travel, food, style — type it or drop a photo."
    },
    {
      title: "Get a decisive answer",
      body: "No endless options. One clear call, tuned to how you like to decide."
    },
    {
      title: "Take action with real links",
      body: "Flights, stays, maps, and booking shortcuts when you need to move fast."
    }
  ];
  const [step, setStep] = useState(0);

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onboarding-card">
        <button type="button" className="onboarding-skip" onClick={onComplete}>
          Skip
        </button>
        <p className="hero-kicker onboarding-step-label">
          {step + 1} / {slides.length}
        </p>
        <h2 id="onb-title" className="onboarding-title">
          {slides[step].title}
        </h2>
        <p className="muted onboarding-body">{slides[step].body}</p>
        <div className="onboarding-dots" aria-hidden="true">
          {slides.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === step ? "active" : ""}`} />
          ))}
        </div>
        <div className="onboarding-actions">
          {step < slides.length - 1 ? (
            <button type="button" className="primary-btn onboarding-next" onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="primary-btn onboarding-next" onClick={onComplete}>
              Get started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AnimatedCounter({ value }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const target = Number(value || 0);
    const duration = 600;
    const start = performance.now();
    let raf = 0;

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      setDisplay(Math.round(target * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display.toLocaleString()}</>;
}

function buildMissionRecapCaption(recap, captionLead) {
  if (!recap) return `${captionLead}\n\ndecideforme.org`;
  return `${captionLead}\n\nCompliance: ${recap.complianceScore ?? "—"}%\nWorst excuse: ${recap.viralSummary?.worstExcuse?.label ?? "—"}\n${recap.roast ? `${recap.roast}\n` : ""}${recap.viralSummary?.shareCaption ? `${recap.viralSummary.shareCaption}\n` : ""}Streak after mission: ${recap.lifeModeStreakAfter ?? "—"}\nDecisions logged: ${recap.totalDecisions}\nVerdict: ${recap.verdict}\n\ndecideforme.org`;
}

/** Download / social share for PNG cards generated from a DOM ref (html-to-image). */
function ShareImageToolbar({
  exportRef,
  captionText,
  filename = "decide-for-me.png",
  className = "",
  copyLabel = "Copy caption",
  showCopyCaption = false,
  onCopyCaption
}) {
  const [busy, setBusy] = useState(false);

  const captureBlob = async () => {
    const el = exportRef?.current;
    if (!el) throw new Error("Share card not ready");
    if (document.fonts?.ready) await document.fonts.ready;
    const dataUrl = await toPng(el, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#070910"
    });
    const res = await fetch(dataUrl);
    return res.blob();
  };

  const triggerBlobDownload = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadImage = async () => {
    setBusy(true);
    try {
      const blob = await captureBlob();
      triggerBlobDownload(blob);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const fallbackText = `${captionText}\n\ndecideforme.org`;

  const tryShareImageFiles = async () => {
    try {
      const blob = await captureBlob();
      const file = new File([blob], filename, { type: "image/png" });
      const data = { files: [file], text: captionText, title: "Decide For Me" };
      if (navigator.share && navigator.canShare?.(data)) {
        await navigator.share(data);
        return true;
      }
    } catch (e) {
      if (e?.name === "AbortError") return true;
      console.error(e);
    }
    return false;
  };

  const shareWhatsApp = async () => {
    setBusy(true);
    try {
      if (await tryShareImageFiles()) return;
      const blob = await captureBlob();
      triggerBlobDownload(blob);
      window.open(`https://wa.me/?text=${encodeURIComponent(fallbackText)}`, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  const shareFacebook = async () => {
    setBusy(true);
    try {
      if (await tryShareImageFiles()) return;
      const blob = await captureBlob();
      triggerBlobDownload(blob);
      const u = encodeURIComponent("https://decideforme.org");
      const quote = encodeURIComponent(captionText);
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${quote}`, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  const shareX = async () => {
    setBusy(true);
    try {
      if (await tryShareImageFiles()) return;
      const blob = await captureBlob();
      triggerBlobDownload(blob);
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(fallbackText)}`, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  const nativeShare = async () => {
    setBusy(true);
    try {
      if (await tryShareImageFiles()) return;
      if (navigator.share) {
        try {
          await navigator.share({ text: fallbackText });
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`share-image-toolbar ${className}`.trim()}>
      <button type="button" className="ghost-btn share-image-download-btn" disabled={busy} onClick={() => void downloadImage()}>
        <Download size={16} strokeWidth={2} aria-hidden="true" />
        {busy ? "Working…" : "Download image"}
      </button>
      <div className="share-icon-row" role="group" aria-label="Share image to apps">
        <button type="button" className="share-icon-btn" aria-label="Share on WhatsApp" disabled={busy} onClick={() => void shareWhatsApp()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a9 9 0 0 0-7.7 13.7L3 21l4.5-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M8.8 9.2c.2-.5.5-.5.7-.5h.6c.2 0 .4.1.4.3l.7 1.7c.1.2 0 .4-.1.5l-.5.6c-.1.1-.1.3 0 .4.3.6.9 1.2 1.6 1.6.1.1.3.1.4 0l.6-.5c.1-.1.3-.1.5-.1l1.7.7c.2.1.3.2.3.4v.6c0 .2 0 .5-.5.7-.4.2-.9.3-1.4.2-1.1-.2-2.2-.8-3.2-1.8S8.5 11.7 8.3 10.6c-.1-.5 0-1 .2-1.4Z" fill="currentColor"/>
          </svg>
        </button>
        <button type="button" className="share-icon-btn" aria-label="Share on Facebook" disabled={busy} onClick={() => void shareFacebook()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 8h2V5h-2c-2.2 0-4 1.8-4 4v2H8v3h2v5h3v-5h2.1l.4-3H13V9c0-.6.4-1 1-1Z" fill="currentColor"/>
          </svg>
        </button>
        <button type="button" className="share-icon-btn" aria-label="Share on X" disabled={busy} onClick={() => void shareX()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 4 5.6 7.4L5.3 20h2.4l4-6 4.6 6H20l-5.8-7.6L19.2 4h-2.4l-3.8 5.7L8.8 4H5Z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      {navigator.share ? (
        <button type="button" className="share-native-btn" disabled={busy} onClick={() => void nativeShare()}>
          Share image via…
        </button>
      ) : null}
      {showCopyCaption && typeof onCopyCaption === "function" ? (
        <button type="button" className="ghost-btn share-image-copy-caption" disabled={busy} onClick={() => onCopyCaption()}>
          {copyLabel}
        </button>
      ) : null}
    </div>
  );
}

/** PNG share card + toolbar; preview stays hidden until the user taps the primary Share button. */
function CollapsibleShareImageBlock({
  className = "",
  header,
  expandedIntro,
  revealLabel = "Share",
  collapseLabel = "Hide preview",
  exportRef,
  filename,
  captionText,
  toolbarClassName = "",
  showCopyCaption,
  onCopyCaption,
  copyLabel,
  children
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`share-widget share-widget--collapsible ${open ? "share-widget--open" : ""} ${className}`.trim()}>
      {header}
      {!open ? (
        <button
          type="button"
          className="primary-btn share-widget-reveal-btn"
          aria-expanded="false"
          onClick={() => setOpen(true)}
        >
          {revealLabel}
        </button>
      ) : (
        <>
          {expandedIntro}
          <div className="share-widget-expanded">
            <div className="life-cc-share-preview-shell">{children}</div>
            <ShareImageToolbar
              className={toolbarClassName}
              exportRef={exportRef}
              filename={filename}
              captionText={captionText}
              showCopyCaption={showCopyCaption}
              onCopyCaption={onCopyCaption}
              copyLabel={copyLabel}
            />
            <button
              type="button"
              className="share-widget-collapse-btn ghost-btn"
              aria-expanded="true"
              onClick={() => setOpen(false)}
            >
              {collapseLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SharePanel({ text, className = "" }) {
  const [copied, setCopied] = useState(false);
  const urls = shareUrls(text);
  const nativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ text });
    } catch {
      // Ignore canceled share
    }
  };
  return (
    <div className={`share-stack ${className}`.trim()}>
      <div className="share-icon-row" role="group" aria-label="Share options">
        <a className="share-icon-btn" href={urls.whatsapp} target="_blank" rel="noreferrer" aria-label="Share on WhatsApp">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a9 9 0 0 0-7.7 13.7L3 21l4.5-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M8.8 9.2c.2-.5.5-.5.7-.5h.6c.2 0 .4.1.4.3l.7 1.7c.1.2 0 .4-.1.5l-.5.6c-.1.1-.1.3 0 .4.3.6.9 1.2 1.6 1.6.1.1.3.1.4 0l.6-.5c.1-.1.3-.1.5-.1l1.7.7c.2.1.3.2.3.4v.6c0 .2 0 .5-.5.7-.4.2-.9.3-1.4.2-1.1-.2-2.2-.8-3.2-1.8S8.5 11.7 8.3 10.6c-.1-.5 0-1 .2-1.4Z" fill="currentColor"/>
          </svg>
        </a>
        <a className="share-icon-btn" href={urls.facebook} target="_blank" rel="noreferrer" aria-label="Share on Facebook">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 8h2V5h-2c-2.2 0-4 1.8-4 4v2H8v3h2v5h3v-5h2.1l.4-3H13V9c0-.6.4-1 1-1Z" fill="currentColor"/>
          </svg>
        </a>
        <a className="share-icon-btn" href={urls.x} target="_blank" rel="noreferrer" aria-label="Share on X">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 4 5.6 7.4L5.3 20h2.4l4-6 4.6 6H20l-5.8-7.6L19.2 4h-2.4l-3.8 5.7L8.8 4H5Z" fill="currentColor"/>
          </svg>
        </a>
        <button
          className="share-icon-btn"
          aria-label="Copy referral link"
          onClick={async () => {
            await copyText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 13 4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/>
              <rect x="5" y="5" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/>
            </svg>
          )}
        </button>
      </div>
      {navigator.share ? (
        <button className="share-native-btn" onClick={nativeShare}>
          Share via…
        </button>
      ) : null}
    </div>
  );
}

function Layout({ session, onSignOut, children }) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DFM_ONBOARDED_KEY)) return;
      if (localStorage.getItem(LEGACY_ONBOARDING_KEY)) {
        localStorage.setItem(DFM_ONBOARDED_KEY, "1");
        localStorage.removeItem(LEGACY_ONBOARDING_KEY);
        return;
      }
      setShowOnboarding(true);
    } catch {
      /* ignore */
    }
  }, []);

  const finishOnboarding = () => {
    try {
      localStorage.setItem(DFM_ONBOARDED_KEY, "1");
      localStorage.removeItem(LEGACY_ONBOARDING_KEY);
    } catch {
      /* ignore */
    }
    setShowOnboarding(false);
  };

  const desktopNavItems = [
    { to: "/", label: "Chat", icon: MessageCircle },
    { to: "/explore", label: "Explore", icon: Compass },
    { to: "/referrals", label: "Referrals", icon: BadgePercent },
    { to: "/profile", label: "Profile", icon: User }
  ];
  const mobileTabs = [
    { to: "/", label: "Chat", icon: MessageCircle },
    { to: "/explore", label: "Explore", icon: Compass },
    { to: "/referrals", label: "Referrals", icon: BadgePercent },
    { to: "/profile", label: "Profile", icon: User }
  ];

  const loginItem = { to: "/login", label: "Login", icon: LogIn };
  const LoginIcon = loginItem.icon;

  return (
    <div className="app-shell page-enter">
      <DocumentMeta />
      <OfflineBanner />
      {showOnboarding ? <OnboardingOverlay onComplete={finishOnboarding} /> : null}
      <header className="topbar">
        <Link to="/" className="brand">
          Decide For Me
        </Link>
        <nav className="nav-links desktop-only-nav">
          {desktopNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              end={to === "/"}
            >
              <Icon size={16} />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
          {session ? (
            <button className="ghost-btn" onClick={onSignOut}>
              Logout
            </button>
          ) : (
            <NavLink to={loginItem.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <LoginIcon size={16} />
              <span className="nav-label">{loginItem.label}</span>
            </NavLink>
          )}
        </nav>
      </header>
      <main className="content">{children}</main>
      <footer className="site-footer" role="contentinfo">
        <nav className="site-footer-nav" aria-label="Legal and policies">
          <Link to="/terms">Terms of Service</Link>
          <span className="site-footer-sep" aria-hidden="true">
            ·
          </span>
          <Link to="/privacy">Privacy Policy</Link>
          <span className="site-footer-sep" aria-hidden="true">
            ·
          </span>
          <Link to="/cookies">Cookie Policy</Link>
        </nav>
      </footer>
      <nav
        className="mobile-tabbar"
        aria-label="Primary tabs"
        style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", justifyContent: "space-evenly", width: "100%" }}
      >
        {mobileTabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
            style={{ flex: 1 }}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              <Icon size={24} strokeWidth={1.5} />
            </span>
            <span className="mobile-tab-label">{label}</span>
            <span className="mobile-tab-dot" aria-hidden="true" />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function InfluencerInviteLanding() {
  const { code } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const normalized = String(code || "")
      .trim()
      .toLowerCase();
    if (/^[a-z0-9]{6,16}$/.test(normalized)) {
      try {
        localStorage.setItem(DFM_INVITE_STORAGE_KEY, normalized);
      } catch {
        /* ignore */
      }
    }
    applyPageMeta({
      title: "You're invited | Decide For Me",
      description: "Lifetime Pro and your referral code — decideforme.org.",
      path: pathname
    });
  }, [code, pathname]);

  const valid = /^[a-z0-9]{6,16}$/.test(String(code || "").trim().toLowerCase());
  const inviteUrl = `${SITE_CANONICAL}/invite/${String(code || "").trim().toLowerCase()}`;

  return (
    <section className="card premium">
      <p className="hero-kicker">Influencer invite</p>
      <h1 className="decision-title">You&apos;ve got lifetime Pro</h1>
      <p className="answer">
        Sign in or create an account to unlock Pro forever on this device — no card, no trial timer — plus your referral code so you can{" "}
        <Link to="/affiliates">earn 50% commissions</Link> when you share Decide For Me.
      </p>
      {!valid ? (
        <p className="error">This invite link doesn&apos;t look valid. Ask for a fresh link.</p>
      ) : (
        <p className="meta referral-link-break">
          Link saved for after you sign in: <code className="invite-url-code">{inviteUrl}</code>
        </p>
      )}
      <div className="invite-landing-actions">
        <Link to="/signup" className="primary-btn">
          Create account
        </Link>
        <Link to="/login" className="secondary-btn">
          Log in
        </Link>
        <button type="button" className="ghost-btn" onClick={() => navigate("/")}>
          Back to app
        </button>
      </div>
    </section>
  );
}

function AdminPage() {
  const { pathname } = useLocation();
  const [password, setPassword] = useState("");
  const [adminToken, setAdminToken] = useState(() => {
    try {
      return sessionStorage.getItem(DFM_ADMIN_TOKEN_KEY) || "";
    } catch {
      return "";
    }
  });
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [loginError, setLoginError] = useState("");

  const publicSiteOrigin = SITE_CANONICAL.replace(/\/$/, "");

  const loadInvites = async (tok) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/admin/invites"), {
        headers: { Authorization: `Bearer ${tok}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          try {
            sessionStorage.removeItem(DFM_ADMIN_TOKEN_KEY);
          } catch {
            /* ignore */
          }
          setAdminToken("");
          setError(typeof data?.error === "string" ? data.error : "Session expired. Sign in again.");
        } else {
          setError(typeof data?.error === "string" ? data.error : "Could not load invites.");
        }
        setInvites([]);
        return;
      }
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch {
      setError("Could not reach the server.");
      setInvites([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    applyPageMeta({
      title: "Admin | Decide For Me",
      description: "Invite administration.",
      path: pathname
    });
  }, [pathname]);

  useEffect(() => {
    if (!adminToken) return;
    loadInvites(adminToken);
  }, [adminToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch(apiUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(typeof data?.error === "string" ? data.error : "Login failed.");
        return;
      }
      const tok = typeof data?.token === "string" ? data.token : "";
      if (!tok) {
        setLoginError("Invalid response from server.");
        return;
      }
      try {
        sessionStorage.setItem(DFM_ADMIN_TOKEN_KEY, tok);
      } catch {
        /* ignore */
      }
      setAdminToken(tok);
      setPassword("");
    } catch {
      setLoginError("Could not reach the server.");
    }
  };

  const handleCreateInvite = async () => {
    if (!adminToken) return;
    setError("");
    try {
      const res = await fetch(apiUrl("/api/admin/invites"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ label: newLabel.trim() || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Could not create invite.");
        return;
      }
      setNewLabel("");
      await loadInvites(adminToken);
    } catch {
      setError("Could not reach the server.");
    }
  };

  const handleLogout = () => {
    try {
      sessionStorage.removeItem(DFM_ADMIN_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setAdminToken("");
    setInvites([]);
  };

  if (!adminToken) {
    return (
      <section className="card premium admin-gate">
        <p className="hero-kicker">Admin</p>
        <h1 className="decision-title">Sign in</h1>
        <form onSubmit={handleLogin} className="form admin-login-form">
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
          />
          {loginError ? <p className="error">{loginError}</p> : null}
          <button type="submit" className="primary-btn">
            Continue
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="card premium admin-dashboard">
      <div className="admin-dashboard-head">
        <div>
          <p className="hero-kicker">Admin</p>
          <h1 className="decision-title">Influencer invites</h1>
          <p className="meta">One-time links in the form {publicSiteOrigin}/invite/[code]</p>
        </div>
        <button type="button" className="ghost-btn" onClick={handleLogout}>
          Sign out
        </button>
      </div>

      <div className="admin-create-row">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (optional), e.g. TikTok — @creator"
          className="admin-label-input"
        />
        <button type="button" className="primary-btn" onClick={handleCreateInvite} disabled={loading}>
          Generate invite link
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="meta">Loading…</p> : null}

      <div className="admin-invites-table-wrap">
        <table className="admin-invites-table">
          <thead>
            <tr>
              <th>Invite link</th>
              <th>Label</th>
              <th>Used at</th>
              <th>User</th>
              <th>Decisions</th>
              <th>Referral commissions</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((row) => {
              const link = `${publicSiteOrigin}/invite/${row.code}`;
              return (
                <tr key={row.id}>
                  <td>
                    <code className="admin-code">{link}</code>
                  </td>
                  <td>{row.label || "—"}</td>
                  <td>{row.used_at ? new Date(row.used_at).toLocaleString() : "—"}</td>
                  <td>{row.user_email || (row.used_by_user_id ? row.used_by_user_id.slice(0, 8) + "…" : "—")}</td>
                  <td>{row.used_by_user_id != null ? row.total_decisions ?? 0 : "—"}</td>
                  <td>{row.used_by_user_id != null ? formatGbpFromPence(row.referral_commission_pence) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && invites.length === 0 ? <p className="meta">No invites yet. Generate one above.</p> : null}
      </div>
    </section>
  );
}

function ProtectedRoute({ session, children }) {
  if (!isSupabaseConfigured) return <Navigate to="/" replace />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const up = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      The AI needs WiFi to make decisions. Reconnect and we&apos;ll get back to controlling your life.
    </div>
  );
}

function NotFoundPage() {
  const { pathname } = useLocation();
  useEffect(() => {
    applyPageMeta({
      title: "Page not found | Decide For Me",
      description: "This page doesn’t exist — head back to Decide For Me at decideforme.org.",
      path: pathname
    });
  }, [pathname]);
  return (
    <section className="card premium not-found-card">
      <p className="hero-kicker not-found-kicker">404</p>
      <h1 className="not-found-title">Well, this is awkward</h1>
      <p className="answer not-found-lede">
        The AI couldn&apos;t decide where this page went. Neither can we.
      </p>
      <p className="meta not-found-hint">Maybe it&apos;s meditating. Maybe it ghosted us. Either way — home is safe.</p>
      <Link to="/" className="primary-btn not-found-cta">
        Back home
      </Link>
    </section>
  );
}

function DailyDilemmaCard({ session }) {
  const dailyShareCardRef = useRef(null);
  const [countdown, setCountdown] = useState(nextMidnightCountdown());
  const [dilemma, setDilemma] = useState(null);
  const [userVote, setUserVote] = useState("");
  const [selectedVote, setSelectedVote] = useState("");
  const [revealResults, setRevealResults] = useState(false);
  const [aiPick, setAiPick] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const [loadingVote, setLoadingVote] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const voteStorageKey = `daily_dilemma_vote_${today}`;
  const guestIdStorageKey = "decide_for_me_guest_id";

  const getOrCreateGuestId = () => {
    try {
      const existing = localStorage.getItem(guestIdStorageKey);
      if (existing) return existing;
      const created = crypto.randomUUID();
      localStorage.setItem(guestIdStorageKey, created);
      return created;
    } catch {
      return `guest-${Date.now()}`;
    }
  };

  const loadDaily = async () => {
    if (!supabase) return;
    let { data } = await supabase.from("daily_dilemmas").select("*").eq("date", today).single();
    if (!data) {
      const index = Number(today.replaceAll("-", "")) % DAILY_LIBRARY.length;
      const fallback = DAILY_LIBRARY[index];
      const insert = await supabase
        .from("daily_dilemmas")
        .insert({
          date: today,
          date_key: today,
          question: fallback.prompt,
          option_a: fallback.options[0],
          option_b: fallback.options[1],
          votes_a: 0,
          votes_b: 0
        })
        .select("*")
        .single();
      data = insert.data;
    }
    setDilemma(data);
    const localVote = (() => {
      try {
        const raw = localStorage.getItem(voteStorageKey);
        return raw === "A" || raw === "B" ? raw : "";
      } catch {
        return "";
      }
    })();
    const guestId = getOrCreateGuestId();

    if (session?.user?.id) {
      const { data: myVote } = await supabase
        .from("dilemma_votes")
        .select("choice")
        .eq("dilemma_id", data.id)
        .eq("user_id", session.user.id)
        .maybeSingle();
      const resolvedVote = (myVote?.choice ? myVote.choice.toUpperCase() : "") || localVote || "";
      setUserVote(resolvedVote);
      setRevealResults(Boolean(resolvedVote));
    } else {
      let resolvedVote = localVote;
      if (supabase) {
        const { data: guestVote } = await supabase
          .from("dilemma_votes")
          .select("choice")
          .eq("dilemma_id", data.id)
          .eq("guest_id", guestId)
          .maybeSingle();
        if (guestVote?.choice) resolvedVote = guestVote.choice.toUpperCase();
      }
      setUserVote(resolvedVote);
      setRevealResults(Boolean(resolvedVote));
    }

    if (data.ai_pick) setAiPick(data.ai_pick);
  };

  useEffect(() => {
    loadDaily();
  }, [session?.user?.id]);

  useEffect(() => {
    const id = setInterval(() => setCountdown(nextMidnightCountdown()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!supabase || !dilemma?.id) return;
    const channel = supabase
      .channel(`daily-${dilemma.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "daily_dilemmas", filter: `id=eq.${dilemma.id}` },
        async () => {
          const { data } = await supabase.from("daily_dilemmas").select("*").eq("id", dilemma.id).single();
          if (data) setDilemma(data);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [dilemma?.id]);

  const castVote = async (option) => {
    if (!dilemma || userVote || loadingVote) return;
    setSelectedVote(option);
    setLoadingVote(true);
    setRevealResults(false);
    try {
      await new Promise((resolve) => setTimeout(resolve, 240));
      const guestId = getOrCreateGuestId();
      if (supabase) {
        const { error: castError } = await supabase.rpc("cast_dilemma_vote", {
          p_dilemma_id: dilemma.id,
          p_choice: option.toLowerCase(),
          p_user_id: session?.user?.id || null,
          p_guest_id: session?.user?.id ? null : guestId
        });
        if (castError) {
          console.error("[DailyDilemma] cast vote failed", castError);
          throw castError;
        }
      }
      try {
        localStorage.setItem(voteStorageKey, option);
      } catch {
        // Ignore storage errors.
      }
      if (supabase) {
        const { data: refreshed } = await supabase.from("daily_dilemmas").select("*").eq("id", dilemma.id).single();
        if (refreshed) setDilemma(refreshed);
      }
      setUserVote(option);
      setTimeout(() => setRevealResults(true), 140);
      launchConfetti();
      if (session?.user?.id) {
        await touchActivity(session.user.id, { didVote: true });
      }
      if (!aiPick) getAIPick();
    } finally {
      setLoadingVote(false);
    }
  };

  const getAIPick = async () => {
    if (!dilemma || aiPick) return "";
    setLoadingAi(true);
    try {
      const response = await fetch(apiUrl("/api/decide"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${dilemma.question}\nOptions: A) ${dilemma.option_a} B) ${dilemma.option_b}\nReturn only the verdict text in 1-2 short, punchy sentences. Maximum 20 words total. Be decisive and opinionated. Do not use markdown.`
        })
      });
      const data = await response.json();
      if (response.ok) {
        setAiPick(data.answer);
        await supabase.from("daily_dilemmas").update({ ai_pick: data.answer }).eq("id", dilemma.id);
        return data.answer;
      }
      return "";
    } finally {
      setLoadingAi(false);
    }
  };

  const formatAIVerdict = (rawVerdict) => {
    const plainText = String(rawVerdict || "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!plainText) return "";
    const sentences = (plainText.match(/[^.!?]+[.!?]?/g) || []).map((item) => item.trim()).filter(Boolean);
    const concise = (sentences.length ? sentences.slice(0, 2).join(" ") : plainText).trim();
    if (!concise) return "";
    return /[.!?]$/.test(concise) ? concise : `${concise}.`;
  };

  if (!dilemma) return null;
  const aVotes = dilemma.votes_a || 0;
  const bVotes = dilemma.votes_b || 0;
  const total = Math.max(aVotes + bVotes, 1);
  const aPercent = Math.round((aVotes / total) * 100);
  const bPercent = Math.round((bVotes / total) * 100);
  const majority = aVotes === bVotes ? "It's a tie right now." : aVotes > bVotes ? `Majority chose: ${dilemma.option_a}` : `Majority chose: ${dilemma.option_b}`;

  const dailyShareCaption = useMemo(() => {
    if (!dilemma || !userVote) return "Daily Dilemma · decideforme.org";
    const pickLabel = userVote === "A" ? dilemma.option_a : dilemma.option_b;
    const verdictLine = aiPick ? formatAIVerdict(aiPick) : "";
    return `Daily Dilemma · ${dilemma.question}\nMy pick ${userVote}: ${pickLabel}\n${verdictLine ? `${verdictLine}\n` : ""}Community split: ${aPercent}% vs ${bPercent}%\n\ndecideforme.org`;
  }, [dilemma, userVote, aiPick, aPercent, bPercent]);

  return (
    <section className="card premium daily-card">
      <p className="hero-kicker timer-pulse">Daily Dilemma · next in {countdown}</p>
      <h3>{dilemma.question}</h3>
      <div className="vote-row">
        <button
          className={`daily-vote-btn option-a ${selectedVote === "A" ? "selected" : ""}`}
          onClick={() => castVote("A")}
          disabled={Boolean(userVote) || loadingVote}
        >
          A: {dilemma.option_a}
          {selectedVote === "A" ? <span className="vote-check">✓</span> : null}
        </button>
        <button
          className={`daily-vote-btn option-b ${selectedVote === "B" ? "selected" : ""}`}
          onClick={() => castVote("B")}
          disabled={Boolean(userVote) || loadingVote}
        >
          B: {dilemma.option_b}
          {selectedVote === "B" ? <span className="vote-check">✓</span> : null}
        </button>
      </div>
      {userVote ? (
        <>
          <div className={`poll-results ${revealResults ? "reveal" : ""}`}>
            <div className="poll-row">
              <p className="meta">A · {dilemma.option_a}</p>
              <div className="poll-track option-a">
                <span className="poll-fill option-a" style={{ width: revealResults ? `${aPercent}%` : "0%" }} />
              </div>
            </div>
            <div className="poll-row">
              <p className="meta">B · {dilemma.option_b}</p>
              <div className="poll-track option-b">
                <span className="poll-fill option-b" style={{ width: revealResults ? `${bPercent}%` : "0%" }} />
              </div>
            </div>
          </div>
          <p className="meta community-split">{aPercent}% vs {bPercent}%</p>
          <p className="meta">Live voters: {aVotes + bVotes}</p>
          <p className="daily-majority">{majority}</p>
          <p className="daily-ai-label">⚡ AI Verdict</p>
          {loadingAi && !aiPick ? <p className="meta">AI verdict is loading...</p> : null}
          {aiPick ? <p className="daily-ai-verdict">{formatAIVerdict(aiPick)}</p> : null}

          <div className="daily-dilemma-share-pack">
            <CollapsibleShareImageBlock
              revealLabel="Share your Daily Dilemma"
              exportRef={dailyShareCardRef}
              captionText={dailyShareCaption}
              filename="decide-for-me-daily-dilemma.png"
            >
              <div
                ref={dailyShareCardRef}
                className="life-mode-share-export-card life-mode-share-export-card--rank-lieutenant daily-dilemma-share-card"
              >
                <div className="life-mode-share-export-bg" aria-hidden="true" />
                <div className="life-mode-share-export-body">
                  <header className="life-mode-share-export-head">
                    <p className="life-mode-share-export-brand">Decide For Me</p>
                    <p className="life-mode-share-export-mode">Daily Dilemma</p>
                  </header>
                  <p className="daily-share-export-question">{clampShareCardLine(dilemma.question, 220)}</p>
                  <section className="life-mode-share-export-block life-mode-share-export-block--command">
                    <p className="life-mode-share-export-kicker">My pick · {userVote}</p>
                    <p className="life-mode-share-export-command">
                      {userVote === "A" ? dilemma.option_a : dilemma.option_b}
                    </p>
                  </section>
                  <section className="life-mode-share-export-block">
                    <p className="life-mode-share-export-kicker">Community</p>
                    <p className="daily-share-split-line">
                      {aPercent}% · A · {clampShareCardLine(dilemma.option_a, 80)}
                    </p>
                    <p className="daily-share-split-line">
                      {bPercent}% · B · {clampShareCardLine(dilemma.option_b, 80)}
                    </p>
                  </section>
                  {aiPick ? (
                    <section className="life-mode-share-export-block">
                      <p className="life-mode-share-export-kicker">AI verdict</p>
                      <p className="life-mode-share-export-verdict">{formatAIVerdict(aiPick)}</p>
                    </section>
                  ) : null}
                  <footer className="life-mode-share-export-foot">
                    <p className="life-mode-share-export-url">decideforme.org</p>
                  </footer>
                </div>
              </div>
            </CollapsibleShareImageBlock>
          </div>
        </>
      ) : (
        <p className="meta">You can vote once today. Results unlock right after you vote.</p>
      )}
    </section>
  );
}

function ChatScreen({ session }) {
  const { currency, formatMonth, formatYear } = useCommerceCurrency();
  const DAILY_FREE_LIMIT = DAILY_FREE_DECISION_LIMIT;
  const GUEST_DAILY_FREE_LIMIT = DAILY_FREE_DECISION_LIMIT;
  const LIFE_MODE_STORAGE_KEY = "decide_for_me_life_mode_session";
  const LIFE_SETUP_STORAGE_KEY = "dfm_lm_setup_v2";
  const LIFE_STREAK_STORAGE_KEY = "dfm_lm_consecutive_days";
  const GUEST_ID_STORAGE_KEY = "decide_for_me_guest_id";

  const loadLifeSetupFromStorage = (sessionId) => {
    if (!sessionId) return null;
    try {
      const raw = localStorage.getItem(LIFE_SETUP_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.sessionId === sessionId && parsed?.setup && typeof parsed.setup === "object") return parsed.setup;
    } catch {
      /* ignore */
    }
    return null;
  };

  const persistLifeSetup = (sessionId, setup) => {
    if (!sessionId || !setup) return;
    try {
      localStorage.setItem(LIFE_SETUP_STORAGE_KEY, JSON.stringify({ sessionId, setup }));
    } catch {
      /* ignore */
    }
  };
  const quickCategories = [
    { label: "🍕 Food", value: "Help me decide what to eat tonight." },
    { label: "🎬 Watch", value: "Help me choose what to watch tonight." },
    { label: "✈️ Travel", value: "Help me decide where to go for my next trip." },
    { label: "💪 Fitness", value: "Help me pick the best workout for today." },
    { label: "🍺 Nightlife", value: "Help me decide where to go out tonight — bars, clubs, or something low-key." },
    { label: "🛍️ Shopping", value: "Help me choose what to buy or where to shop for what I need." },
    { label: "💆 Wellness", value: "Help me pick a self-care or wellness move for today." },
    { label: "🎮 Gaming", value: "Help me decide what to play tonight — game, genre, or session length." }
  ];
  const learningSignals = ["Pattern detected.", "Noted. Your profile is updating.", "Signal logged.", "Preference map sharpening."];
  const buildDecisionInsights = (historyRows) => {
    const rows = Array.isArray(historyRows) ? historyRows : [];
    if (!rows.length) return [];
    let socialCount = 0;
    let moneyCount = 0;
    let foodCount = 0;
    let reconsiderCount = 0;
    for (const row of rows) {
      const answer = String(row?.answer || "").toLowerCase();
      const conversationItems = Array.isArray(row?.conversation) ? row.conversation : [];
      const userMessages = conversationItems.filter((item) => item?.role === "user").map((item) => String(item?.content || "").toLowerCase());
      const allText = `${answer} ${userMessages.join(" ")}`;
      if (/(friend|social|party|date|people|text|call|group)/i.test(allText)) socialCount += 1;
      if (/(money|budget|cheap|price|cost|spend|save|expensive)/i.test(allText)) moneyCount += 1;
      if (/(food|eat|dinner|lunch|breakfast|restaurant|takeout|cook)/i.test(allText)) foodCount += 1;
      if (/(actually|instead|change|not feeling|maybe)/i.test(allText)) reconsiderCount += 1;
    }

    const insights = [];
    if (socialCount >= 2) insights.push("You tend to overthink social situations more than practical choices.");
    if (foodCount >= 2 && moneyCount >= 2) insights.push("You decide quickly on food, but slow down when money is involved.");
    if (reconsiderCount >= 2) insights.push("You explore alternatives before committing, especially when stakes feel high.");
    if (!insights.length) insights.push("You move best with clear options and a decisive final call.");
    return insights.slice(0, 3);
  };
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [conversation, setConversation] = useState([]);
  const [nearbyPlacesLoading, setNearbyPlacesLoading] = useState(false);
  const [showNearbyFindButton, setShowNearbyFindButton] = useState(false);
  const [nearbyPlacePromptContext, setNearbyPlacePromptContext] = useState("");
  const [nearbyFetchError, setNearbyFetchError] = useState("");
  const [nearbyRadiusMeters, setNearbyRadiusMeters] = useState(DEFAULT_NEARBY_RADIUS_METERS);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [crisisSupportActive, setCrisisSupportActive] = useState(false);
  const [samaritansBannerActive, setSamaritansBannerActive] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState([]);
  const [pendingImage, setPendingImage] = useState(null);
  const attachInputRef = useRef(null);
  const [liveCount, setLiveCount] = useState(0);
  const [learnedPreferences, setLearnedPreferences] = useState([]);
  const [totalDecisions, setTotalDecisions] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [showFirstTimeNote, setShowFirstTimeNote] = useState(false);
  const [dailyUsage, setDailyUsage] = useState(0);
  const [guestDailyUsage, setGuestDailyUsage] = useState(0);
  const [profileInsights, setProfileInsights] = useState([]);
  const [profileDecisionCount, setProfileDecisionCount] = useState(0);
  const [isProUser, setIsProUser] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradePromptReason, setUpgradePromptReason] = useState("limit");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [lifeModeExitNotice, setLifeModeExitNotice] = useState("");
  const [syncProAfterCheckout, setSyncProAfterCheckout] = useState(false);
  const [promptRef, setPromptRef] = useState(null);
  const [replyRef, setReplyRef] = useState(null);
  const [lifeModeWizardOpen, setLifeModeWizardOpen] = useState(false);
  const [lifeModeWizardStep, setLifeModeWizardStep] = useState(0);
  const [lifeModeDraftWake, setLifeModeDraftWake] = useState(7);
  const [lifeModeDraftDayType, setLifeModeDraftDayType] = useState("work");
  const [lifeModeDraftEnergy, setLifeModeDraftEnergy] = useState("medium");
  const [lifeModeDraftIntensity, setLifeModeDraftIntensity] = useState("strict");
  const [lifeModeSession, setLifeModeSession] = useState(null);
  const [lifeModeSetup, setLifeModeSetup] = useState(null);
  const [lifeModeCountdownLabel, setLifeModeCountdownLabel] = useState("");
  const [lifeModeGlobalCount, setLifeModeGlobalCount] = useState(0);
  const [lifeModeRecap, setLifeModeRecap] = useState(null);
  const [activatingLifeMode, setActivatingLifeMode] = useState(false);
  const [copiedLifeCaption, setCopiedLifeCaption] = useState(false);
  const [lifeModeDecisionFeed, setLifeModeDecisionFeed] = useState([]);
  const [lifeModeWeather, setLifeModeWeather] = useState(null);
  const [lifeModePhaseTick, setLifeModePhaseTick] = useState(0);
  const [lifeModeComplianceMap, setLifeModeComplianceMap] = useState({});
  const [lifeModeResponsePicks, setLifeModeResponsePicks] = useState({});
  const [lifeModeEmergencyShame, setLifeModeEmergencyShame] = useState("");
  const [showEmergencyExitModal, setShowEmergencyExitModal] = useState(false);
  const [emergencyExitWorking, setEmergencyExitWorking] = useState(false);
  const [lifeModeFreePreviewOpen, setLifeModeFreePreviewOpen] = useState(false);
  const [lifeModeMissionShareCopied, setLifeModeMissionShareCopied] = useState(false);
  /** undefined = loading AI orders; null = fallback to built-in library; array = Claude-generated */
  const [lifeAiCommands, setLifeAiCommands] = useState(undefined);
  const [lifeAiCommandsError, setLifeAiCommandsError] = useState(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [chatHistoryRows, setChatHistoryRows] = useState([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const activeChatSessionIdRef = useRef(null);
  const lifeModeShareCardRef = useRef(null);
  const lifeMissionShareCardRef = useRef(null);
  const chatShareCardRef = useRef(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const [lifeModeHydrated, setLifeModeHydrated] = useState(() => !session?.user?.id);
  const [pendingLifeModeDeepLink, setPendingLifeModeDeepLink] = useState(false);
  const lifeModeDeepLinkConsumedRef = useRef(false);

  useEffect(() => {
    if (session?.user?.id) setLifeModeHydrated(false);
    else setLifeModeHydrated(true);
  }, [session?.user?.id]);

  useEffect(() => {
    const raw = searchParams.get("q");
    if (!raw) return;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      /* use raw */
    }
    setPrompt(decoded);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("q");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (!checkout) return;
    if (checkout === "success") {
      setCheckoutNotice("Welcome to Pro — unlimited decisions and full Life Mode are unlocked.");
      setSyncProAfterCheckout(true);
    } else if (checkout === "cancelled") {
      setCheckoutNotice("Checkout was cancelled. No charge was made.");
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("checkout");
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!syncProAfterCheckout) return undefined;
    if (!supabase || !session?.user?.id) {
      setSyncProAfterCheckout(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        for (let i = 0; i < 15 && !cancelled; i++) {
          const { data } = await supabase.from("profiles").select("is_pro").eq("id", session.user.id).maybeSingle();
          if (data?.is_pro) {
            setIsProUser(true);
            setShowUpgradePrompt(false);
            break;
          }
          await new Promise((r) => setTimeout(r, 450));
        }
      } finally {
        if (!cancelled) setSyncProAfterCheckout(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncProAfterCheckout, session?.user?.id, supabase]);

  useEffect(() => {
    const raw = searchParams.get("lifeMode") ?? searchParams.get("lifemode");
    if (raw == null || raw === "" || raw === "0" || raw === "false") return;
    lifeModeDeepLinkConsumedRef.current = false;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("lifeMode");
        next.delete("lifemode");
        return next;
      },
      { replace: true }
    );
    setPendingLifeModeDeepLink(true);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!pendingLifeModeDeepLink) return;
    if (!session?.user?.id) {
      setUpgradePromptReason("feature");
      setShowUpgradePrompt(true);
      setPendingLifeModeDeepLink(false);
      return;
    }
    if (!lifeModeHydrated) return;
    const active =
      lifeModeSession?.ends_at && new Date(lifeModeSession.ends_at).getTime() > Date.now();
    if (active) {
      setPendingLifeModeDeepLink(false);
      return;
    }
    if (lifeModeDeepLinkConsumedRef.current) {
      setPendingLifeModeDeepLink(false);
      return;
    }
    lifeModeDeepLinkConsumedRef.current = true;
    setLifeModeWizardStep(0);
    setLifeModeWizardOpen(true);
    setPendingLifeModeDeepLink(false);
  }, [pendingLifeModeDeepLink, session?.user?.id, lifeModeHydrated, lifeModeSession]);

  useEffect(() => {
    activeChatSessionIdRef.current = null;
    setChatHistoryRows([]);
    setChatHistoryOpen(false);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!chatHistoryOpen) return;
    const onKey = (event) => {
      if (event.key === "Escape") setChatHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatHistoryOpen]);

  useEffect(() => {
    if (!chatHistoryOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [chatHistoryOpen]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const userTimeZone = useMemo(() => getUserTimeZone(), []);
  const startOfTodayIso = new Date(`${todayKey}T00:00:00`).toISOString();
  const lifeModeCaption = "I let AI run my life for 24 hours at decideforme.org 🤖 here’s what happened…";
  const getOrCreateGuestId = () => {
    try {
      const existing = localStorage.getItem(GUEST_ID_STORAGE_KEY);
      if (existing) return existing;
      const created = crypto.randomUUID();
      localStorage.setItem(GUEST_ID_STORAGE_KEY, created);
      return created;
    } catch {
      return `guest-${Date.now()}`;
    }
  };

  useEffect(() => {
    if (!("Notification" in window) || !session) return;
    Notification.requestPermission().catch(() => {});
    const now = new Date();
    const nearMidnight = new Date();
    nearMidnight.setHours(23, 20, 0, 0);
    const wait = nearMidnight.getTime() - now.getTime();
    if (wait > 0) {
      const id = setTimeout(() => {
        if (Notification.permission === "granted") {
          new Notification("Keep your streak alive 🔥", {
            body: "Drop one decision or vote on today's dilemma before midnight."
          });
        }
      }, wait);
      return () => clearTimeout(id);
    }
  }, [session]);

  useEffect(() => {
    if (!supabase) {
      setLiveCount(0);
      return;
    }

    const loadGlobalDecisionCount = async () => {
      const [{ count: memberCount }, { count: guestCount }] = await Promise.all([
        supabase
          .from("decision_history")
          .select("id", { count: "exact", head: true })
          .gte("created_at", startOfTodayIso),
        supabase
          .from("guest_decision_history")
          .select("id", { count: "exact", head: true })
          .gte("created_at", startOfTodayIso)
      ]);
      setLiveCount((memberCount || 0) + (guestCount || 0));
    };

    loadGlobalDecisionCount();
  }, [todayKey]);

  useEffect(() => {
    if (!supabase) {
      setLearnedPreferences([]);
      setTotalDecisions(0);
      setDailyUsage(0);
      setGuestDailyUsage(0);
      setShowUpgradePrompt(false);
      return;
    }

    if (!session?.user?.id) {
      const loadGuestUsage = async () => {
        const guestId = getOrCreateGuestId();
        const startOfTodayIso = new Date(`${todayKey}T00:00:00`).toISOString();
        const [{ count }, { data: guestHistory }] = await Promise.all([
          supabase
            .from("guest_decision_history")
            .select("id", { count: "exact", head: true })
            .eq("guest_id", guestId)
            .gte("created_at", startOfTodayIso),
          supabase
            .from("guest_decision_history")
            .select("id, answer, created_at")
            .eq("guest_id", guestId)
            .order("created_at", { ascending: false })
            .limit(50)
        ]);
        const guestRows = (guestHistory ?? []).map((row) => ({
          ...row,
          conversation: []
        }));
        const guestInsights = buildDecisionInsights(guestRows);
        setProfileDecisionCount(guestRows.length);
        setProfileInsights(guestInsights);
        setIsProUser(false);
        const nextGuestUsage = count || 0;
        setLearnedPreferences([]);
        setTotalDecisions(0);
        setDailyUsage(0);
        setGuestDailyUsage(nextGuestUsage);
        setShowUpgradePrompt(nextGuestUsage >= GUEST_DAILY_FREE_LIMIT);
      };

      loadGuestUsage();
      return;
    }

    const loadPersonalization = async () => {
      const { data: preferenceRows } = await supabase
        .from("user_preferences")
        .select("id, preference")
        .eq("user_id", session.user.id)
        .order("updated_at", { ascending: false });
      setLearnedPreferences(preferenceRows ?? []);

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      setCurrentStreak(profile?.current_streak || 0);
      setIsProUser(Boolean(profile?.is_pro));
      if (profile?.is_pro && !String(profile?.referral_code || "").trim()) {
        const generatedCode = await reserveRandomReferralCode(session.user.id);
        await supabase.from("profiles").update({ referral_code: generatedCode }).eq("id", session.user.id);
        await supabase.from("referrals").update({ referral_code: generatedCode }).eq("referrer_id", session.user.id);
      }

      const { count: decisionHistoryTotal, data: decisionHistoryRows } = await supabase
        .from("decision_history")
        .select("id, answer, conversation, created_at", { count: "exact" })
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setTotalDecisions(decisionHistoryTotal || 0);
      setProfileDecisionCount(decisionHistoryTotal || 0);
      setProfileInsights(buildDecisionInsights(decisionHistoryRows ?? []));

      const { data: usage } = await supabase
        .from("daily_usage")
        .select("decision_count")
        .eq("user_id", session.user.id)
        .eq("usage_date", todayKey)
        .single();
      const count = usage?.decision_count || 0;
      setDailyUsage(count);
      setGuestDailyUsage(0);
      setShowUpgradePrompt(count >= DAILY_FREE_LIMIT);
    };

    loadPersonalization();
  }, [session?.user?.id, todayKey]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined;
    const uid = session.user.id;
    const channel = supabase
      .channel(`profiles-pro-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
        (payload) => {
          const row = payload.new;
          if (row && typeof row.is_pro === "boolean") {
            setIsProUser(Boolean(row.is_pro));
            if (row.is_pro) setShowUpgradePrompt(false);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, supabase]);

  useEffect(() => {
    if (session?.user?.id) return;
    setIsProUser(false);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!profileDecisionCount || profileDecisionCount < 5) return;
    if (!session?.user?.id) return;
    // Keep profile card feeling alive as decisions are made in the current session.
    setProfileDecisionCount((prev) => prev);
  }, [conversation.length, profileDecisionCount, session?.user?.id]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    const refreshProfileInsightsAfterDecision = async () => {
      const { count: decisionHistoryTotal, data: decisionHistoryRows } = await supabase
        .from("decision_history")
        .select("id, answer, conversation, created_at", { count: "exact" })
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setProfileDecisionCount(decisionHistoryTotal || 0);
      setProfileInsights(buildDecisionInsights(decisionHistoryRows ?? []));
    };
    if (!loading) refreshProfileInsightsAfterDecision();
  }, [loading, session?.user?.id, supabase]);

  useEffect(() => {
    if (!lifeModeSession?.id || String(lifeModeSession.id).startsWith("local-")) {
      const localPairs = [];
      let lastUserPrompt = "";
      conversation.forEach((item, idx) => {
        if (item.role === "user") {
          lastUserPrompt = item.content || "";
          return;
        }
        if (item.role === "assistant") {
          localPairs.push({
            id: `local-${idx}-${String(item.content || "").slice(0, 12) || "decision"}`,
            prompt: lastUserPrompt || "Input captured.",
            answer: item.content,
            created_at: new Date().toISOString()
          });
          lastUserPrompt = "";
        }
      });
      const localFeed = localPairs.slice(-20).reverse();
      setLifeModeDecisionFeed(localFeed);
      return;
    }
    if (!supabase) return;

    const loadLifeModeDecisionFeed = async () => {
      const { data } = await supabase
        .from("life_mode_decisions")
        .select("id, prompt, answer, created_at")
        .eq("session_id", lifeModeSession.id)
        .gte("created_at", startOfTodayIso)
        .order("created_at", { ascending: false })
        .limit(25);
      setLifeModeDecisionFeed(data ?? []);
    };

    loadLifeModeDecisionFeed();

    const channel = supabase
      .channel(`life-mode-feed-${lifeModeSession.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "life_mode_decisions",
          filter: `session_id=eq.${lifeModeSession.id}`
        },
        () => loadLifeModeDecisionFeed()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lifeModeSession?.id, startOfTodayIso, supabase, conversation]);

  useEffect(() => {
    autosizeTextarea(promptRef, 5);
  }, [prompt, promptRef]);

  useEffect(() => {
    autosizeTextarea(replyRef, 5);
  }, [reply, replyRef]);

  const refreshLifeModeGlobalCount = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_active_life_mode_user_count");
    if (!error && typeof data === "number") {
      setLifeModeGlobalCount(data);
      return;
    }

    // Fallback for environments where the RPC isn't installed yet.
    const { count } = await supabase
      .from("life_mode_sessions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .gt("ends_at", new Date().toISOString());
    setLifeModeGlobalCount(count || 0);
  };

  const loadLifeModeFromStorage = () => {
    try {
      const raw = localStorage.getItem(LIFE_MODE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ends_at) return null;
      if (new Date(parsed.ends_at).getTime() <= Date.now()) {
        localStorage.removeItem(LIFE_MODE_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      localStorage.removeItem(LIFE_MODE_STORAGE_KEY);
      return null;
    }
  };

  const finalizeLifeModeIfNeeded = async (sessionRow) => {
    if (!supabase || !sessionRow?.id || sessionRow.recap_json) return sessionRow?.recap_json || null;
    const { data: logs } = await supabase
      .from("life_mode_decisions")
      .select("prompt, answer, created_at")
      .eq("session_id", sessionRow.id)
      .order("created_at", { ascending: false });
    const list = logs ?? [];
    const highlights = list.slice(0, 3).map((item) => ({
      prompt: item.prompt,
      answer: item.answer,
      created_at: item.created_at
    }));
    let verdict = "Your AI thinks you need more adventure in your life.";
    if (highlights.length) {
      try {
        const response = await fetch(apiUrl("/api/decide"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `Based on these decisions, give one bold personality verdict in one sentence.
${highlights.map((item, idx) => `${idx + 1}. ${item.prompt} -> ${item.answer}`).join("\n")}`
          })
        });
        const data = await response.json();
        if (response.ok && data?.answer) verdict = data.answer;
      } catch {
        // Keep fallback verdict.
      }
    }

    let codename = "COMMANDER";
    try {
      const rawSetup = localStorage.getItem(LIFE_SETUP_STORAGE_KEY);
      if (rawSetup) {
        const p = JSON.parse(rawSetup);
        if (p?.sessionId === sessionRow.id && typeof p?.setup?.codename === "string") codename = p.setup.codename;
      }
    } catch {
      /* ignore */
    }

    let complianceScore = null;
    try {
      const rawPct = localStorage.getItem(`dfm_lm_pct_${sessionRow.id}`);
      if (rawPct != null && rawPct !== "") {
        const n = Number(rawPct);
        if (Number.isFinite(n)) complianceScore = n;
      }
    } catch {
      /* ignore */
    }

    let emergencyOverride = false;
    try {
      emergencyOverride = localStorage.getItem(`dfm_lm_emergency_${sessionRow.id}`) === "1";
    } catch {
      /* ignore */
    }

    const roast =
      complianceScore != null && Number.isFinite(complianceScore)
        ? roastFromCompliance(complianceScore, codename)
        : null;

    let streakPrev = 0;
    try {
      const r = localStorage.getItem(LIFE_STREAK_STORAGE_KEY);
      streakPrev = Number.isFinite(Number(r)) ? Math.max(0, Math.floor(Number(r))) : 0;
    } catch {
      streakPrev = 0;
    }
    let streakNext = streakPrev;
    if (emergencyOverride) {
      streakNext = 0;
    } else if (complianceScore != null && Number.isFinite(complianceScore)) {
      if (complianceScore >= 50) streakNext = streakPrev + 1;
      else streakNext = 0;
    }
    try {
      localStorage.setItem(LIFE_STREAK_STORAGE_KEY, String(streakNext));
    } catch {
      /* ignore */
    }

    const profileUserId = sessionRow.user_id;
    if (supabase && profileUserId) {
      await supabase.from("profiles").update({ life_mode_streak_days: streakNext }).eq("id", profileUserId);
    }

    let viralSummary = null;
    try {
      const dayKeyEnd = new Date().toISOString().slice(0, 10);
      const cmpRaw = localStorage.getItem(`dfm_lm_cmp_${sessionRow.id}_${dayKeyEnd}`);
      const cmpParsed = cmpRaw ? JSON.parse(cmpRaw) : null;
      const picks =
        cmpParsed?.responses && typeof cmpParsed.responses === "object" ? cmpParsed.responses : {};
      let intensityVir = "strict";
      try {
        const rs = localStorage.getItem(LIFE_SETUP_STORAGE_KEY);
        if (rs) {
          const pr = JSON.parse(rs);
          if (pr?.sessionId === sessionRow.id && pr?.setup?.intensity) intensityVir = pr.setup.intensity;
        }
      } catch {
        /* ignore */
      }
      const csNum = complianceScore != null && Number.isFinite(complianceScore) ? complianceScore : 0;
      viralSummary = summarizeLifeDayVirality({
        picks,
        compliancePct: csNum,
        intensity: intensityVir,
        codename,
        streakDaysBefore: streakPrev
      });
    } catch {
      /* ignore */
    }

    try {
      localStorage.removeItem(`dfm_lm_pct_${sessionRow.id}`);
      localStorage.removeItem(`dfm_lm_emergency_${sessionRow.id}`);
      const dayKey = new Date().toISOString().slice(0, 10);
      localStorage.removeItem(`dfm_lm_cmp_${sessionRow.id}_${dayKey}`);
    } catch {
      /* ignore */
    }

    let verdictAugmented = verdict;
    if (roast) {
      verdictAugmented = `${verdict} Mission compliance: ${complianceScore}%. ${roast}`;
    }
    if (viralSummary?.verdict) {
      verdictAugmented = `${verdictAugmented} ${viralSummary.verdict}`;
    }

    const recap = {
      totalDecisions: list.length,
      highlights,
      verdict: verdictAugmented,
      complianceScore,
      roast,
      codename,
      emergencyOverride,
      lifeModeStreakAfter: streakNext,
      viralSummary
    };
    await supabase.from("life_mode_sessions").update({ is_active: false, recap_json: recap }).eq("id", sessionRow.id);
    return recap;
  };

  useEffect(() => {
    const persisted = loadLifeModeFromStorage();
    if (persisted) {
      setLifeModeSession(persisted);
      setLifeModeRecap(null);
    }
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      const persisted = loadLifeModeFromStorage();
      if (!persisted) {
        setLifeModeSession(null);
        setLifeModeRecap(null);
      }
      setLifeModeHydrated(true);
      return;
    }

    const loadLifeMode = async () => {
      try {
        const { data: activeSession } = await supabase
          .from("life_mode_sessions")
          .select("*")
          .eq("user_id", session.user.id)
          .eq("is_active", true)
          .gt("ends_at", new Date().toISOString())
          .order("started_at", { ascending: false })
          .limit(1)
          .single();
        if (activeSession) {
          setLifeModeSession(activeSession);
          setLifeModeRecap(null);
        } else {
          const persisted = loadLifeModeFromStorage();
          setLifeModeSession(persisted || null);
          const { data: lastSession } = await supabase
            .from("life_mode_sessions")
            .select("*")
            .eq("user_id", session.user.id)
            .order("started_at", { ascending: false })
            .limit(1)
            .single();
          if (lastSession && !lastSession.is_active && lastSession.recap_json) {
            setLifeModeRecap(lastSession.recap_json);
          } else if (lastSession && lastSession.is_active && new Date(lastSession.ends_at).getTime() <= Date.now()) {
            const recap = await finalizeLifeModeIfNeeded(lastSession);
            setLifeModeRecap(recap);
          }
        }
        refreshLifeModeGlobalCount();
      } finally {
        setLifeModeHydrated(true);
      }
    };

    loadLifeMode();
  }, [session?.user?.id]);

  useEffect(() => {
    if (lifeModeSession?.ends_at && new Date(lifeModeSession.ends_at).getTime() > Date.now()) {
      localStorage.setItem(LIFE_MODE_STORAGE_KEY, JSON.stringify(lifeModeSession));
      return;
    }
    localStorage.removeItem(LIFE_MODE_STORAGE_KEY);
  }, [lifeModeSession]);

  useEffect(() => {
    refreshLifeModeGlobalCount();
    const id = setInterval(() => {
      refreshLifeModeGlobalCount();
    }, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lifeModeSession?.ends_at) {
      setLifeModeCountdownLabel("");
      return;
    }

    setLifeModeCountdownLabel(lifeModeCountdown(lifeModeSession.ends_at));
    const id = setInterval(async () => {
      const remaining = new Date(lifeModeSession.ends_at).getTime() - Date.now();
      if (remaining <= 0) {
        clearInterval(id);
        const recap = await finalizeLifeModeIfNeeded(lifeModeSession);
        setLifeModeSession(null);
        localStorage.removeItem(LIFE_MODE_STORAGE_KEY);
        setLifeModeRecap(recap);
        refreshLifeModeGlobalCount();
        setLifeModeCountdownLabel("00:00:00");
      } else {
        setLifeModeCountdownLabel(lifeModeCountdown(lifeModeSession.ends_at));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lifeModeSession?.id, lifeModeSession?.ends_at]);

  useEffect(() => {
    if (!lifeModeSession?.id) return;
    const loaded = loadLifeSetupFromStorage(lifeModeSession.id);
    if (loaded) setLifeModeSetup(loaded);
  }, [lifeModeSession?.id]);

  useEffect(() => {
    if (!lifeModeSession?.id) return;
    const key = `dfm_lm_cmp_${lifeModeSession.id}_${todayKey}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.completed && typeof p.completed === "object") setLifeModeComplianceMap(p.completed);
        else setLifeModeComplianceMap({});
        if (p?.responses && typeof p.responses === "object") setLifeModeResponsePicks(p.responses);
        else setLifeModeResponsePicks({});
      } else {
        setLifeModeComplianceMap({});
        setLifeModeResponsePicks({});
      }
    } catch {
      setLifeModeComplianceMap({});
      setLifeModeResponsePicks({});
    }
  }, [lifeModeSession?.id, todayKey]);

  useEffect(() => {
    if (!lifeModeSession) return;
    const id = setInterval(() => setLifeModePhaseTick((x) => x + 1), 45000);
    return () => clearInterval(id);
  }, [lifeModeSession?.id]);

  useEffect(() => {
    if (!lifeModeSession?.ends_at || new Date(lifeModeSession.ends_at).getTime() <= Date.now()) return;
    if (!("geolocation" in navigator)) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (cancelled) return;
        const w = await fetchOpenMeteoCurrent(position.coords.latitude, position.coords.longitude, userTimeZone);
        if (!cancelled && w) setLifeModeWeather(w);
      },
      () => {},
      { maximumAge: 300000, timeout: 15000, enableHighAccuracy: false }
    );
    return () => {
      cancelled = true;
    };
  }, [lifeModeSession?.id, userTimeZone]);

  const requestUserLocation = async () => {
    if (!("geolocation" in navigator)) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          }),
        () => resolve(null),
        { maximumAge: 300000, timeout: 15000, enableHighAccuracy: false }
      );
    });
  };

  const fetchNearbyPlacesForContext = async () => {
    const ctx = nearbyPlacePromptContext || "";
    setNearbyFetchError("");
    if (!("geolocation" in navigator)) {
      setNearbyFetchError("Location is not available in this browser.");
      return;
    }
    setNearbyPlacesLoading(true);
    try {
      const pos = await requestUserLocation();
      if (!pos) {
        setNearbyFetchError("Could not get your location. Allow location access and try again.");
        return;
      }
      setUserLocation(pos);
      const nr = await fetch(apiUrl("/api/nearby-places"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: pos.lat,
          lng: pos.lng,
          type: inferNearbyPlaceType(ctx),
          radiusMeters: nearbyRadiusMeters
        })
      });
      const rawText = await nr.text();
      let nd = {};
      try {
        nd = rawText ? JSON.parse(rawText) : {};
      } catch {
        setNearbyFetchError("Unexpected response from the server.");
        return;
      }
      if (!nr.ok) {
        setNearbyFetchError(nd?.error || `Request failed (${nr.status}).`);
        return;
      }
      const rawPlaces = Array.isArray(nd.places) ? nd.places : [];
      if (!rawPlaces.length) {
        setNearbyFetchError("No places found near you for this topic.");
        return;
      }
      const lastAssistant = [...conversation].reverse().find((m) => m.role === "assistant");
      const placesWithReasons = rawPlaces.map((p, i) => ({
        name: p.name,
        rating: p.rating,
        address: p.address || "",
        mapsUrl: p.mapsUrl,
        cuisineType: p.cuisineType || "",
        reason: buildNearbyPickReason(
          {
            userPrompt: ctx,
            assistantReply: lastAssistant?.content,
            cuisineType: p.cuisineType || ""
          },
          i
        )
      }));
      setConversation((prev) => [...prev, { role: "nearby", places: placesWithReasons }]);
      setShowNearbyFindButton(false);
    } catch (err) {
      setNearbyFetchError(err?.message || "Could not load nearby places.");
    } finally {
      setNearbyPlacesLoading(false);
    }
  };

  const activateLifeMode = async (setupPayload = null) => {
    if (activatingLifeMode) return;
    setActivatingLifeMode(true);
    const endsAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const authSession = supabase ? (await supabase.auth.getSession()).data.session : null;
    const resolvedUserId = session?.user?.id || authSession?.user?.id || null;
    const optimisticSession = {
      id: `local-${Date.now()}`,
      user_id: resolvedUserId,
      started_at: new Date().toISOString(),
      ends_at: endsAt,
      is_active: true
    };
    setLifeModeComplianceMap({});
    setLifeModeResponsePicks({});
    setLifeModeEmergencyShame("");
    setLifeModeSession(optimisticSession);
    setLifeModeRecap(null);
    setLifeModeWizardOpen(false);

    if (setupPayload && typeof setupPayload === "object") {
      setLifeModeSetup(setupPayload);
      persistLifeSetup(optimisticSession.id, setupPayload);
    }

    if (!supabase || !resolvedUserId) {
      setActivatingLifeMode(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("life_mode_sessions")
        .insert({
          user_id: resolvedUserId,
          ends_at: endsAt,
          is_active: true
        })
        .select("*")
        .single();
      if (error) {
        setError(`Life Mode activation failed to save: ${error.message}`);
      } else if (data) {
        setLifeModeSession(data);
        if (setupPayload && typeof setupPayload === "object") {
          setLifeModeSetup(setupPayload);
          persistLifeSetup(data.id, setupPayload);
        }
      }
      await refreshLifeModeGlobalCount();
    } finally {
      setActivatingLifeMode(false);
    }
  };

  const beginLifeModeActivationFlow = () => {
    const codename = pickCodename();
    const setup = {
      wakeHour: lifeModeDraftWake,
      dayType: lifeModeDraftDayType,
      energy: lifeModeDraftEnergy,
      intensity: lifeModeDraftIntensity,
      codename
    };
    setLifeModeWizardOpen(false);
    void activateLifeMode(setup);
  };

  const openLifeModePrompt = (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (event?.stopPropagation) event.stopPropagation();
    if (!session?.user?.id) {
      setUpgradePromptReason("feature");
      setShowUpgradePrompt(true);
      return;
    }
    /* TEMP (Life Mode QA): Pro gate disabled — restore after testing:
    if (!isProUser) {
      setLifeModeFreePreviewOpen(true);
      return;
    }
    */
    setLifeModeWizardStep(0);
    setLifeModeWizardOpen(true);
  };

  const startProCheckout = async (plan = "month") => {
    const accessToken = await resolveAccessToken(session?.access_token);
    if (!accessToken) {
      setCheckoutError("");
      setError("Sign in to upgrade to Pro.");
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError("");
    setError("");
    try {
      const url = await fetchStripeCheckoutSessionUrl(accessToken, {
        plan: plan === "year" ? "year" : "month",
        currency
      });
      goToStripeCheckout(url, {
        onStuck: () => {
          setCheckoutLoading(false);
          const stuckMsg =
            "Stripe Checkout did not open in this tab. Allow redirects to checkout.stripe.com, or open the site in a normal (non–in-app) browser and try again.";
          setCheckoutError(stuckMsg);
          setError(stuckMsg);
        }
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Failed to start Stripe checkout.";
      setCheckoutError(message);
      setError(message);
      setCheckoutLoading(false);
    }
  };

  const copyLifeModeCaption = async () => {
    const recapText = buildMissionRecapCaption(lifeModeRecap, lifeModeCaption);
    await copyText(recapText);
    setCopiedLifeCaption(true);
    setTimeout(() => setCopiedLifeCaption(false), 1400);
  };

  const sendToAI = async (content, isInitial = false) => {
    const isGuest = !session?.user?.id;
    if (session?.user?.id && dailyUsage >= DAILY_FREE_LIMIT) {
      setUpgradePromptReason("limit");
      setShowUpgradePrompt(true);
      setError("");
      return;
    }
    if (isGuest && guestDailyUsage >= GUEST_DAILY_FREE_LIMIT) {
      setUpgradePromptReason("limit");
      setShowUpgradePrompt(true);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    setCrisisSupportActive(false);
    setSamaritansBannerActive(false);
    setFollowUpSuggestions([]);
    const attachment = pendingImage;
    setPendingImage(null);
    if (attachment?.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }

    const resolvedText =
      String(content ?? "").trim() || (attachment ? "Help me decide based on this image." : "");
    if (!resolvedText.trim() && !attachment) {
      setLoading(false);
      return;
    }

    setNearbyFetchError("");
    setShowNearbyFindButton(false);
    setNearbyPlacePromptContext("");
    const userMessage = {
      role: "user",
      content: resolvedText,
      ...(attachment ? { imageBase64: attachment.base64, imageMediaType: attachment.mediaType } : {})
    };
    const updatedConversation = isInitial ? [userMessage] : [...conversation, userMessage];
    if (isInitial) setConversation([userMessage]);
    else setConversation(updatedConversation);

    try {
      let locationForRequest = userLocation;
      if (shouldUseNearby(resolvedText) && !locationForRequest && "geolocation" in navigator) {
        locationForRequest = await requestUserLocation();
        if (locationForRequest) setUserLocation(locationForRequest);
      }

      const response = await fetch(apiUrl("/api/decide"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: resolvedText,
          conversation: conversationForApi(updatedConversation),
          userLocation: locationForRequest,
          userPreferences: learnedPreferences.map((item) => item.preference),
          lifeMode: Boolean(lifeModeSession)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI failed.");
      setCrisisSupportActive(Boolean(data.crisisSupport));
      if (data.crisisSupport) {
        setSamaritansBannerActive(false);
        setFollowUpSuggestions([]);
      } else {
        setSamaritansBannerActive(Boolean(data.showSamaritansBanner));
        const raw = Array.isArray(data.followUpSuggestions) ? data.followUpSuggestions : [];
        setFollowUpSuggestions(raw.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 3));
      }
      const assistantTurnsSoFar = conversationForApi(updatedConversation).filter((item) => item.role === "assistant")
        .length;
      const ensuredLifeModeAnswer =
        lifeModeSession && !String(data.answer || "").endsWith("Directive issued.")
          ? `${String(data.answer || "").trim()} Directive issued.`
          : data.answer;
      let finalAssistantText = String(ensuredLifeModeAnswer || "").trim();
      if (!lifeModeSession && assistantTurnsSoFar >= 2) {
        const shouldAddSignal = Math.random() < 0.35;
        if (shouldAddSignal) {
          const signal = learningSignals[Math.floor(Math.random() * learningSignals.length)];
          finalAssistantText = `${finalAssistantText}\n\n_${signal}_`;
        }
      }
      const aiMessage = {
        role: "assistant",
        content: finalAssistantText,
        ...(Array.isArray(data.bookingLinks) && data.bookingLinks.length ? { bookingLinks: data.bookingLinks } : {})
      };
      const finalConversation = [...updatedConversation, aiMessage];
      setConversation(finalConversation);

      if (shouldShowFindPlacesCta(resolvedText)) {
        setShowNearbyFindButton(true);
        setNearbyPlacePromptContext(resolvedText);
      }

      const changedMind = /actually|instead|not feeling|change/i.test(resolvedText) ? 1 : 0;
      setReply("");

      if (session?.user?.id && supabase) {
        const isFirstDecision = totalDecisions === 0;
        await supabase.from("decision_history").insert({
          user_id: session.user.id,
          category: "Natural language",
          mood: "Inferred tone",
          answer: finalAssistantText,
          conversation: conversationForStorage(finalConversation)
        });
        setLiveCount((prev) => prev + 1);
        await touchActivity(session.user.id, { didDecision: true, mindsChanged: changedMind });
        if (isFirstDecision) setShowFirstTimeNote(true);
        setTotalDecisions((prev) => prev + 1);
        setCurrentStreak((prev) => Math.max(prev, 1));
        const nextUsage = dailyUsage + 1;
        setDailyUsage(nextUsage);
        await supabase.from("daily_usage").upsert(
          {
            user_id: session.user.id,
            usage_date: todayKey,
            decision_count: nextUsage,
            updated_at: new Date().toISOString()
          },
          { onConflict: "user_id,usage_date" }
        );
        if (nextUsage >= DAILY_FREE_LIMIT) {
          setShowUpgradePrompt(true);
        }

        if (!lifeModeSession) {
          const historyPayload = conversationForChatHistoryStorage(finalConversation);
          try {
            let sid = activeChatSessionIdRef.current;
            if (!sid) {
              const title = chatTitleFromFirstTurn(finalConversation);
              const { data: ins, error: chatInsErr } = await supabase
                .from("chat_sessions")
                .insert({
                  user_id: session.user.id,
                  title,
                  messages: historyPayload,
                  updated_at: new Date().toISOString()
                })
                .select("id")
                .single();
              if (!chatInsErr && ins?.id) {
                sid = ins.id;
                activeChatSessionIdRef.current = sid;
              }
            } else {
              await supabase
                .from("chat_sessions")
                .update({
                  messages: historyPayload,
                  updated_at: new Date().toISOString()
                })
                .eq("id", sid)
                .eq("user_id", session.user.id);
            }
          } catch {
            /* chat history is best-effort */
          }
        }

        if (lifeModeSession?.id && !String(lifeModeSession.id).startsWith("local-")) {
          await supabase.from("life_mode_decisions").insert({
            session_id: lifeModeSession.id,
            user_id: session.user.id,
            prompt: resolvedText,
            answer: finalAssistantText
          });
          setLifeModeDecisionFeed((prev) => [
            {
              id: `pending-${Date.now()}`,
              prompt: resolvedText,
              answer: ensuredLifeModeAnswer,
              created_at: new Date().toISOString()
            },
            ...prev
          ]);
        }

        fetch(apiUrl("/api/extract-preferences"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation: conversationForPreferenceExtract(finalConversation),
            answer: finalAssistantText
          })
        })
          .then((res) => res.json())
          .then(async (payload) => {
            if (!Array.isArray(payload?.preferences) || !payload.preferences.length) return;
            const deduped = payload.preferences
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .map((item) => ({
                user_id: session.user.id,
                preference: item,
                preference_normalized: normalizePreferenceText(item),
                updated_at: new Date().toISOString()
              }))
              .filter((item) => item.preference_normalized);
            if (!deduped.length) return;

            await supabase.from("user_preferences").upsert(deduped, {
              onConflict: "user_id,preference_normalized"
            });

            const { data: refreshed } = await supabase
              .from("user_preferences")
              .select("id, preference")
              .eq("user_id", session.user.id)
              .order("updated_at", { ascending: false });
            setLearnedPreferences(refreshed ?? []);
          })
          .catch(() => {});
      } else if (supabase) {
        const guestId = getOrCreateGuestId();
        await supabase.from("guest_decision_history").insert({
          guest_id: guestId,
          answer: ensuredLifeModeAnswer
        });
        setLiveCount((prev) => prev + 1);
        const nextGuestUsage = guestDailyUsage + 1;
        setGuestDailyUsage(nextGuestUsage);
        if (nextGuestUsage >= GUEST_DAILY_FREE_LIMIT) {
          setUpgradePromptReason("limit");
          setShowUpgradePrompt(true);
        }
      }
    } catch (err) {
      setError(err.message);
      setFollowUpSuggestions([]);
      setSamaritansBannerActive(false);
    } finally {
      setLoading(false);
    }
  };

  const displayedGuestDailyUsage = Math.min(guestDailyUsage, GUEST_DAILY_FREE_LIMIT);
  const universalAssistantBubbleStyle = {
    fontSize: "14px"
  };

  const getFollowUpEmoji = (text) => {
    const v = String(text || "").toLowerCase();
    if (/(money|budget|save|cost|price|invest)/.test(v)) return "💸";
    if (/(food|eat|dinner|lunch|breakfast|restaurant|cafe|drink|coffee)/.test(v)) return "🍽️";
    if (/(gym|workout|fitness|run|health|sleep)/.test(v)) return "💪";
    if (/(trip|travel|holiday|vacation|flight|hotel)/.test(v)) return "✈️";
    if (/(date|friend|party|social|text|call|relationship)/.test(v)) return "💬";
    if (/(work|career|job|study|exam|project)/.test(v)) return "🧠";
    return "⚡";
  };

  const renderChatMessage = (msg, idx) => {
    if (msg.role === "nearby" && Array.isArray(msg.places)) {
      return (
        <div key={`nearby-${idx}`} className="message-row assistant nearby-inline-row">
          <div className="avatar nearby-avatar" aria-hidden="true">
            📍
          </div>
          <div className="bubble nearby-inline-bubble">
            <p className="nearby-inline-heading">Nearby places</p>
            <div className="nearby-inline-list">
              {msg.places.map((p, i) => (
                <div key={`${p.name}-${i}`} className="nearby-inline-item">
                  <div className="nearby-inline-head">
                    <strong className="nearby-inline-name">{p.name}</strong>
                    <span className="meta nearby-inline-cuisine">
                      {p.cuisineType || "Venue"}
                      {p.rating != null ? ` · ⭐ ${p.rating}` : ""}
                    </span>
                  </div>
                  {p.address ? <p className="meta nearby-inline-address">{p.address}</p> : null}
                  <p className="nearby-inline-reason">{p.reason}</p>
                  {p.mapsUrl ? (
                    <a className="nearby-inline-maps" href={p.mapsUrl} target="_blank" rel="noreferrer">
                      Open in Maps
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    if (msg.role === "user" || msg.role === "assistant") {
      return (
        <div key={idx} className={`message-row ${msg.role}`} style={{ animationDelay: `${idx * 45}ms` }}>
          {msg.role === "assistant" ? (
            <div className="avatar assistant avatar-ai-icon" aria-hidden="true">
              <Zap size={15} strokeWidth={2.2} />
            </div>
          ) : (
            <div className="avatar user" aria-hidden="true">
              <User size={14} strokeWidth={2} />
            </div>
          )}
          <div className={`bubble ${msg.role}`} style={msg.role === "assistant" ? universalAssistantBubbleStyle : undefined}>
            {msg.role === "assistant" ? (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                {Array.isArray(msg.bookingLinks) && msg.bookingLinks.length ? (
                  <div className="booking-pills-row" role="navigation" aria-label="Compare and book">
                    {msg.bookingLinks.map((link) => (
                      <a
                        key={link.label}
                        href={link.url}
                        className="booking-pill"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {link.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {msg.imageBase64 && msg.imageMediaType ? (
                  <img
                    className="message-user-image"
                    alt=""
                    src={`data:${msg.imageMediaType};base64,${msg.imageBase64}`}
                  />
                ) : null}
                <span className="message-user-text">{msg.content}</span>
              </>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const clearPendingImage = () => {
    setPendingImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  };

  const onAttachFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    try {
      setError("");
      const { base64, mediaType } = await compressImageToJpeg(file);
      setPendingImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { base64, mediaType, previewUrl: URL.createObjectURL(file) };
      });
    } catch (err) {
      setError(err.message || "Could not load image.");
    }
  };

  const composerEnterSubmit = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const decisionsForRank = session?.user?.id ? totalDecisions : profileDecisionCount;
  const decisionRank = useMemo(() => getDecisionRank(decisionsForRank), [decisionsForRank]);
  const chatOperatorName =
    session?.user?.email?.split("@")[0] ||
    (typeof session?.user?.user_metadata?.full_name === "string"
      ? String(session.user.user_metadata.full_name).trim().split(/\s+/)[0]
      : null) ||
    "Operator";

  const effectiveLifeSetup = useMemo(() => {
    if (lifeModeSetup && typeof lifeModeSetup === "object") return lifeModeSetup;
    if (lifeModeSession?.id) {
      const loaded = loadLifeSetupFromStorage(lifeModeSession.id);
      if (loaded) return loaded;
    }
    return {
      wakeHour: 7,
      dayType: "work",
      energy: "medium",
      intensity: "strict",
      codename: "COMMANDER"
    };
  }, [lifeModeSetup, lifeModeSession?.id]);

  const lifePhaseNow = useMemo(
    () => getDayPhaseForNow(new Date(), userTimeZone),
    [lifeModePhaseTick, userTimeZone]
  );

  useEffect(() => {
    if (!lifeModeSession?.id) {
      setLifeAiCommands(undefined);
      setLifeAiCommandsError(null);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    setLifeAiCommands(undefined);
    setLifeAiCommandsError(null);
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/life-mode-commands"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            userName: chatOperatorName,
            rankName: decisionRank.name,
            rankLabel: decisionRank.label,
            codename: effectiveLifeSetup.codename,
            intensity: effectiveLifeSetup.intensity,
            dayType: effectiveLifeSetup.dayType,
            energy: effectiveLifeSetup.energy,
            wakeHour: effectiveLifeSetup.wakeHour,
            phase: lifePhaseNow,
            localTime: formatLocalTimeShort(new Date(), userTimeZone),
            timeZone: getUserTimeZone(userTimeZone),
            isoTimestamp: new Date().toISOString(),
            weather: lifeModeWeather
              ? {
                  tempC: typeof lifeModeWeather.tempC === "number" ? lifeModeWeather.tempC : undefined,
                  isRainy: Boolean(lifeModeWeather.isRainy)
                }
              : undefined
          })
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const cmds = Array.isArray(data.commands) ? data.commands : [];
        if (res.ok && cmds.length > 0) {
          setLifeAiCommands(cmds);
          setLifeAiCommandsError(null);
        } else {
          setLifeAiCommands(null);
          setLifeAiCommandsError(data?.error || "Using built-in orders.");
        }
      } catch (e) {
        if (cancelled || e?.name === "AbortError") return;
        setLifeAiCommands(null);
        setLifeAiCommandsError(e?.message || "Using built-in orders.");
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    lifeModeSession?.id,
    lifePhaseNow,
    chatOperatorName,
    decisionRank.name,
    decisionRank.label,
    effectiveLifeSetup.codename,
    effectiveLifeSetup.intensity,
    effectiveLifeSetup.dayType,
    effectiveLifeSetup.energy,
    effectiveLifeSetup.wakeHour,
    userTimeZone,
    lifeModeWeather?.tempC,
    lifeModeWeather?.isRainy
  ]);

  const staticLifeOrdersLibrary = useMemo(
    () =>
      buildLifeOrders({
        setup: effectiveLifeSetup,
        phase: lifePhaseNow,
        weather: lifeModeWeather,
        rankName: decisionRank.name,
        operatorName: chatOperatorName
      }),
    [effectiveLifeSetup, lifeModeWeather, decisionRank.name, chatOperatorName, lifePhaseNow]
  );

  const lifeOrdersRawUnsplit = useMemo(() => {
    if (lifeAiCommands === undefined) return null;
    if (Array.isArray(lifeAiCommands) && lifeAiCommands.length > 0) return lifeAiCommands;
    return staticLifeOrdersLibrary;
  }, [lifeAiCommands, staticLifeOrdersLibrary]);

  const lifeOrdersRaw = useMemo(() => {
    if (lifeOrdersRawUnsplit === null) return null;
    return attachCommunitySplitsToOrders(lifeOrdersRawUnsplit);
  }, [lifeOrdersRawUnsplit]);

  const lifeOrdersFiltered = useMemo(
    () =>
      lifeOrdersRaw === null ? null : filterOrdersFromLocalNow(lifeOrdersRaw, new Date(), userTimeZone),
    [lifeOrdersRaw, lifeModePhaseTick, userTimeZone]
  );

  const lifeOrders = useMemo(() => {
    if (lifeOrdersFiltered === null) return [];
    if (lifeOrdersFiltered.length > 0) return lifeOrdersFiltered;
    return [
      buildFallbackLifeOrder(
        lifePhaseNow,
        effectiveLifeSetup.intensity,
        effectiveLifeSetup,
        new Date(),
        userTimeZone
      )
    ];
  }, [
    lifeOrdersFiltered,
    lifePhaseNow,
    effectiveLifeSetup,
    lifeModePhaseTick,
    userTimeZone
  ]);

  const lifeCompliancePct = useMemo(
    () => computeEngagementPercent(lifeModeComplianceMap, lifeModeResponsePicks, lifeOrders),
    [lifeModeComplianceMap, lifeModeResponsePicks, lifeOrders]
  );

  const lifeModeStreakDays = useMemo(() => {
    try {
      return Math.max(0, Number(localStorage.getItem(LIFE_STREAK_STORAGE_KEY)) || 0);
    } catch {
      return 0;
    }
  }, [lifeModePhaseTick, lifeModeSession?.id, lifeModeComplianceMap]);

  useEffect(() => {
    if (!lifeModeSession?.id || !lifeOrders.length) return;
    const pct = computeEngagementPercent(lifeModeComplianceMap, lifeModeResponsePicks, lifeOrders);
    try {
      localStorage.setItem(`dfm_lm_pct_${lifeModeSession.id}`, String(pct));
    } catch {
      /* ignore */
    }
  }, [lifeModeComplianceMap, lifeModeResponsePicks, lifeOrders, lifeModeSession?.id]);

  const persistLifeEngagementToDay = (nextCompleted, nextResponses) => {
    if (!lifeModeSession?.id) return;
    const key = `dfm_lm_cmp_${lifeModeSession.id}_${todayKey}`;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          completed: nextCompleted,
          responses: nextResponses
        })
      );
    } catch {
      /* ignore */
    }
  };

  const pickLifeModeResponse = (order, response) => {
    if (!order?.id || !response) return;
    setLifeModeResponsePicks((prev) => {
      const next = {
        ...prev,
        [order.id]: {
          responseId: response.id,
          label: response.label,
          excuseTag: response.excuseTag,
          instantRoast: response.instantRoast,
          laterRoast: response.laterRoast,
          fireLaterInPhase: response.fireLaterInPhase
        }
      };
      persistLifeEngagementToDay(lifeModeComplianceMap, next);
      return next;
    });
  };

  const performEmergencyLifeExit = async () => {
    if (!lifeModeSession?.id || emergencyExitWorking) return;
    setEmergencyExitWorking(true);
    const snap = lifeModeSession;
    const sid = snap.id;

    try {
      try {
        localStorage.setItem(`dfm_lm_emergency_${sid}`, "1");
        localStorage.setItem(LIFE_STREAK_STORAGE_KEY, "0");
      } catch {
        /* ignore */
      }

      if (supabase && session?.user?.id) {
        const { error: streakErr } = await supabase.from("profiles").update({ life_mode_streak_days: 0 }).eq("id", session.user.id);
        if (streakErr) console.warn("[life mode emergency] profile streak reset:", streakErr.message);
      }

      const persistedToDb = Boolean(sid && !String(sid).startsWith("local-"));
      if (supabase && persistedToDb) {
        await finalizeLifeModeIfNeeded(snap);
        if (session?.user?.id) {
          await supabase.from("life_mode_sessions").update({ is_active: false }).eq("id", sid).eq("user_id", session.user.id);
        }
      }

      try {
        localStorage.removeItem(LIFE_MODE_STORAGE_KEY);
        localStorage.removeItem(LIFE_SETUP_STORAGE_KEY);
        localStorage.removeItem(`dfm_lm_pct_${sid}`);
        localStorage.removeItem(`dfm_lm_emergency_${sid}`);
        const dayKey = new Date().toISOString().slice(0, 10);
        localStorage.removeItem(`dfm_lm_cmp_${sid}_${dayKey}`);
      } catch {
        /* ignore */
      }

      setLifeModeComplianceMap({});
      setLifeModeResponsePicks({});
      setLifeModeEmergencyShame("");
      setLifeModeSetup(null);
      setLifeModeSession(null);
      setLifeModeRecap(null);
      await refreshLifeModeGlobalCount();

      setLifeModeExitNotice("Streak forfeited. The machine is disappointed.");
      window.setTimeout(() => setLifeModeExitNotice(""), 4800);
    } finally {
      setEmergencyExitWorking(false);
      setShowEmergencyExitModal(false);
    }
  };

  useEffect(() => {
    if (!showEmergencyExitModal) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !emergencyExitWorking) setShowEmergencyExitModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showEmergencyExitModal, emergencyExitWorking]);

  const renderChatRankStrip = (compact) => (
    <div
      className={`prestige-chat-strip${compact ? " prestige-chat-strip--compact" : ""}`}
      role="group"
      aria-label={`Rank ${decisionRank.label}`}
    >
      <span className="prestige-chat-name">{session?.user?.id ? chatOperatorName : "Guest"}</span>
      <span
        className={`prestige-mini-badge prestige-mini--${decisionRank.tier}${
          decisionRank.tier === "prestige" && decisionRank.prestigeVariant
            ? ` prestige-mini--p${decisionRank.prestigeVariant}`
            : ""
        }`}
        title={`${decisionRank.label} · ${decisionsForRank} ${session?.user?.id ? "lifetime" : "session"} decisions`}
      >
        <span className="prestige-mini-emoji" aria-hidden="true">
          {decisionRank.emoji}
        </span>
        <span className="prestige-mini-tag">{decisionRank.shortTag}</span>
      </span>
    </div>
  );

  const loadChatSessions = async () => {
    if (!supabase || !session?.user?.id) return;
    setChatHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id, title, updated_at")
        .eq("user_id", session.user.id)
        .order("updated_at", { ascending: false })
        .limit(50);
      setChatHistoryRows(!error && Array.isArray(data) ? data : []);
    } catch {
      setChatHistoryRows([]);
    } finally {
      setChatHistoryLoading(false);
    }
  };

  const openChatHistoryPanel = async () => {
    setChatHistoryOpen(true);
    await loadChatSessions();
  };

  const startNewChat = () => {
    activeChatSessionIdRef.current = null;
    setConversation([]);
    setReply("");
    setPrompt("");
    setFollowUpSuggestions([]);
    setShowNearbyFindButton(false);
    setNearbyFetchError("");
    setNearbyPlacePromptContext("");
    setCrisisSupportActive(false);
    setSamaritansBannerActive(false);
    setError("");
    setPendingImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setChatHistoryOpen(false);
  };

  const resumeChatSession = async (row) => {
    if (!supabase || !session?.user?.id || !row?.id) return;
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, messages")
      .eq("id", row.id)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error || !data) return;
    activeChatSessionIdRef.current = data.id;
    setConversation(hydrateConversationFromHistory(data.messages));
    setReply("");
    setPrompt("");
    setFollowUpSuggestions([]);
    setShowNearbyFindButton(false);
    setNearbyFetchError("");
    setNearbyPlacePromptContext("");
    setCrisisSupportActive(false);
    setSamaritansBannerActive(false);
    setError("");
    setPendingImage((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setChatHistoryOpen(false);
  };

  const chatHistoryDrawer =
    session?.user?.id && !lifeModeSession && chatHistoryOpen ? (
      <div className="chat-history-shell" role="dialog" aria-modal="true" aria-label="Chat history" id="chat-history-panel-root">
        <button
          type="button"
          className="chat-history-backdrop"
          aria-label="Close chat history"
          onClick={() => setChatHistoryOpen(false)}
        />
        <aside className="chat-history-panel" id="chat-history-panel">
          <header className="chat-history-panel-head">
            <h2>Chat history</h2>
            <button type="button" className="chat-history-close" onClick={() => setChatHistoryOpen(false)} aria-label="Close">
              <X size={18} strokeWidth={2.25} />
            </button>
          </header>
          <p className="meta chat-history-hint">Resume a past conversation or start fresh with New chat.</p>
          <div className="chat-history-list" role="list">
            {chatHistoryLoading ? (
              <p className="meta chat-history-loading">Loading…</p>
            ) : chatHistoryRows.length ? (
              chatHistoryRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="chat-history-item"
                  role="listitem"
                  onClick={() => resumeChatSession(row)}
                >
                  <span className="chat-history-item-title">{row.title || "Conversation"}</span>
                  <span className="chat-history-item-meta">
                    {row.updated_at
                      ? new Date(row.updated_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short"
                        })
                      : ""}
                  </span>
                </button>
              ))
            ) : (
              <p className="meta chat-history-empty">No saved chats yet.</p>
            )}
          </div>
        </aside>
      </div>
    ) : null;

  const chatExportLines = useMemo(() => {
    if (!conversation.length) return { userLine: "", assistantLine: "" };
    let u = "";
    let a = "";
    for (let i = conversation.length - 1; i >= 0; i--) {
      const m = conversation[i];
      if (!a && m.role === "assistant") a = trimDecisionSnippet(String(m.content || ""), 320);
      if (!u && m.role === "user") u = trimDecisionSnippet(String(m.content || ""), 200);
      if (u && a) break;
    }
    return { userLine: u, assistantLine: a };
  }, [conversation]);

  const chatShareCaption = useMemo(() => {
    if (!chatExportLines.userLine && !chatExportLines.assistantLine) return "Decide For Me · decideforme.org";
    return `Decide For Me — latest decision\nMe: ${chatExportLines.userLine}\nAI: ${chatExportLines.assistantLine}\n\ndecideforme.org`;
  }, [chatExportLines]);

  if (lifeModeSession) {
    const nowTimeLabel = formatLocalTimeShort(new Date(), userTimeZone);
    const checkInLine = pickCheckIn(lifeModePhaseTick);
    const pulseLine = pulseLineForDay(calendarDayKeyInTimeZone(new Date(), userTimeZone));
    const nightMode = lifePhaseNow === "night";
    const viralShare = summarizeLifeDayVirality({
      picks: lifeModeResponsePicks,
      compliancePct: lifeCompliancePct,
      intensity: effectiveLifeSetup.intensity,
      codename: effectiveLifeSetup.codename,
      streakDaysBefore: lifeModeStreakDays
    });
    const missionShareLine = viralShare.shareCaption;
    let phaseCallbackRoast = null;
    for (const v of Object.values(lifeModeResponsePicks)) {
      if (v?.fireLaterInPhase === lifePhaseNow && v?.laterRoast) {
        phaseCallbackRoast = v.laterRoast;
        break;
      }
    }

    const commandOfDayLine = (() => {
      if (!lifeOrders?.length) return "";
      const withText = lifeOrders.filter((o) => String(o.text || "").trim());
      if (!withText.length) return "";
      const pick = [...withText].sort((a, b) => String(b.text || "").length - String(a.text || "").length)[0];
      return clampShareCardLine(pick.text, 260);
    })();

    const complianceWord =
      Number.isFinite(lifeCompliancePct) && lifeCompliancePct != null
        ? lifeCompliancePct >= 78
          ? "Actually acceptable"
          : lifeCompliancePct >= 55
            ? "Questionable"
            : lifeCompliancePct >= 35
              ? "Rough"
              : "A cry for help"
        : "—";

    const copyMissionShare = async () => {
      await copyText(missionShareLine);
      setLifeModeMissionShareCopied(true);
      setTimeout(() => setLifeModeMissionShareCopied(false), 1600);
    };

    /* TEMP (Life Mode QA): locked Command Centre disabled — uncomment block below after testing:
    if (!isProUser) {
      const teaserOrders = buildLifeOrders({
        setup: {
          wakeHour: 7,
          dayType: "work",
          energy: "medium",
          intensity: "brutal",
          codename: "COMMANDER"
        },
        phase: lifePhaseNow,
        weather: lifeModeWeather,
        rankName: decisionRank.name,
        operatorName: chatOperatorName
      });
      const previewOrder = teaserOrders[0];
      return (
        <section className="card premium life-command-centre life-command-centre--locked">
          <div className="life-mode-veil" />
          <header className="life-cc-head">
            <p className="hero-kicker life-cc-kicker">Life Mode · Pro only</p>
            <h1 className="life-cc-title">COMMAND CENTRE LOCKED</h1>
            <p className="life-mode-timer">{lifeModeCountdownLabel || lifeModeCountdown(lifeModeSession.ends_at)}</p>
            <p className="meta">Session active — upgrade to receive full orders.</p>
          </header>
          <article className="life-cc-order life-cc-order--single">
            <p className="life-cc-time">{previewOrder?.timeLabel ?? "0000"}</p>
            <p className="life-cc-text">{previewOrder?.text ?? "Stand by."}</p>
          </article>
          <p className="life-cc-teaser-hint">You are seeing one surface directive. Pro unlocks the full daily battle rhythm.</p>
          <button
            type="button"
            className="primary-btn life-cc-upgrade"
            onClick={() => {
              setUpgradePromptReason("lifemode");
              setShowUpgradePrompt(true);
            }}
          >
            Unlock full Life Mode (Pro)
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      );
    }
    */

    return (
      <section
        className={
          "card premium life-command-centre" + (nightMode ? " life-command-centre--night" : "")
        }
      >
        <div className="life-mode-veil" />
        <header className="life-cc-head">
          <p className="life-cc-manifesto">
            For the next 24 hours, AI controls your decisions. No arguments.
          </p>
          <div className="life-cc-codename-row">
            <span className="life-cc-codename">{effectiveLifeSetup.codename}</span>
            <span className={`life-cc-intensity life-cc-intensity--${effectiveLifeSetup.intensity}`}>
              {effectiveLifeSetup.intensity}
            </span>
          </div>
          <p className="life-cc-open-line">
            It&apos;s {nowTimeLabel}. I&apos;m in control now.
          </p>
          <p className="life-mode-timer">{lifeModeCountdownLabel || lifeModeCountdown(lifeModeSession.ends_at)}</p>
          <p className="meta life-cc-session-meta">Session time left</p>
        </header>

        {lifeModeEmergencyShame ? <p className="life-cc-shame">{lifeModeEmergencyShame}</p> : null}
        {phaseCallbackRoast ? (
          <p className="life-cc-phase-callback" role="status">
            {phaseCallbackRoast}
          </p>
        ) : null}

        <div className="life-cc-streak-panel" role="status" aria-live="polite">
          <Flame size={20} strokeWidth={2} className="life-cc-streak-flame" aria-hidden />
          <div className="life-cc-streak-panel-inner">
            <span className="life-cc-streak-value">{lifeModeStreakDays}</span>
            <span className="life-cc-streak-caption">
              {lifeModeStreakDays === 1 ? "day" : "days"} in a row in Life Mode
            </span>
          </div>
        </div>

        {lifeAiCommands === undefined ? (
          <p className="meta life-cc-ai-loading" role="status">
            Cooking up personalised orders…
          </p>
        ) : null}
        {lifeAiCommands !== undefined && lifeAiCommandsError ? (
          <p className="meta life-cc-ai-warning">{lifeAiCommandsError}</p>
        ) : null}

        {lifeAiCommands !== undefined ? (
          <ul className="life-cc-orders" aria-label="Today's orders">
            {lifeOrders.map((order) => (
              <li
                key={order.id}
                className={"life-cc-order" + (order.isFallback ? " life-cc-order--fallback" : "")}
              >
                <div className="life-cc-order-body">
                  <p className="life-cc-time">{formatOrderTimeLabel(order.timeLabel)}</p>
                  <p className="life-cc-text">{order.text}</p>
                  {order.responses?.length ? (
                    <div className="life-cc-responses" role="group" aria-label="Replies">
                      {order.responses.map((r) => (
                        <div key={r.id} className="life-cc-response-row">
                          <button
                            type="button"
                            className={
                              "life-cc-response-btn" +
                              (lifeModeResponsePicks[order.id]?.responseId === r.id ? " life-cc-response-btn--picked" : "")
                            }
                            disabled={Boolean(lifeModeResponsePicks[order.id])}
                            onClick={() => pickLifeModeResponse(order, r)}
                          >
                            <span className="life-cc-response-emoji" aria-hidden="true">
                              {r.emoji}{" "}
                            </span>
                            {r.label}
                          </button>
                          <span className="life-cc-community-pct">
                            ~{r.communityPct}% picked this vibe (live demo mix)
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {lifeModeResponsePicks[order.id]?.instantRoast ? (
                    <p className="life-cc-instant-roast">{lifeModeResponsePicks[order.id].instantRoast}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="life-cc-check-in">{checkInLine}</p>

        <button
          type="button"
          className="life-cc-emergency"
          onClick={() => {
            if (!emergencyExitWorking) setShowEmergencyExitModal(true);
          }}
        >
          <ShieldAlert size={18} strokeWidth={2} /> Emergency override — forfeits streak
        </button>

        <article className="life-cc-share-card">
          <CollapsibleShareImageBlock
            className="share-widget"
            revealLabel="Share today's orders"
            toolbarClassName="life-cc-actions life-cc-share-toolbar"
            exportRef={lifeModeShareCardRef}
            captionText={missionShareLine}
            filename="decide-for-me-life-mode.png"
            showCopyCaption
            onCopyCaption={() => void copyMissionShare()}
            copyLabel={lifeModeMissionShareCopied ? "Copied caption" : "Copy caption"}
          >
            <div ref={lifeModeShareCardRef} className={`life-mode-share-export-card life-mode-share-export-card--rank-${decisionRank.tier}`}>
              <div className="life-mode-share-export-bg" aria-hidden="true" />
              <div className="life-mode-share-export-body">
                <header className="life-mode-share-export-head">
                  <p className="life-mode-share-export-brand">Decide For Me</p>
                  <p className="life-mode-share-export-mode">Life Mode</p>
                </header>

                <div className="life-mode-share-export-identity">
                  <p className="life-mode-share-export-codename">{effectiveLifeSetup.codename}</p>
                  <div className={`life-mode-share-export-rank life-mode-share-export-rank--${decisionRank.tier}`}>
                    <span className="life-mode-share-export-rank-emoji" aria-hidden="true">
                      {decisionRank.emoji}
                    </span>
                    <span className="life-mode-share-export-rank-label">{decisionRank.label}</span>
                  </div>
                </div>

                <section className="life-mode-share-export-block life-mode-share-export-block--command" aria-label="Command of the day">
                  <p className="life-mode-share-export-kicker">Today&apos;s command</p>
                  <p className="life-mode-share-export-command">
                    {commandOfDayLine || "Your personalised directives are on the way…"}
                  </p>
                  {viralShare.worstExcuse?.label ? (
                    <p className="life-mode-share-export-excuse">
                      Most relatable excuse: &ldquo;{viralShare.worstExcuse.label}&rdquo;
                    </p>
                  ) : null}
                </section>

                <section className="life-mode-share-export-block" aria-label="Compliance">
                  <p className="life-mode-share-export-kicker">Compliance</p>
                  <div className="life-mode-share-export-compliance-row">
                    <span className="life-mode-share-export-pct">
                      {Number.isFinite(lifeCompliancePct) ? `${Math.round(lifeCompliancePct)}%` : "—"}
                    </span>
                    <span className="life-mode-share-export-status">{complianceWord}</span>
                  </div>
                </section>

                <section className="life-mode-share-export-block" aria-label="AI verdict">
                  <p className="life-mode-share-export-kicker">AI verdict</p>
                  <p className="life-mode-share-export-verdict">&ldquo;{viralShare.verdict}&rdquo;</p>
                  <p className="life-mode-share-export-roast">{viralShare.roastLine}</p>
                </section>

                <footer className="life-mode-share-export-foot">
                  <p className="life-mode-share-export-url">decideforme.org</p>
                </footer>
              </div>
            </div>
          </CollapsibleShareImageBlock>
        </article>

        <section className="life-cc-global-feed" aria-label="Community pulse">
          <p className="hero-kicker life-cc-kicker-quiet">Pulse</p>
          <p className="life-cc-feed-line">{pulseLine}</p>
        </section>

        {showEmergencyExitModal ? (
          <div
            className="life-emergency-confirm-overlay"
            role="presentation"
            onClick={() => {
              if (!emergencyExitWorking) setShowEmergencyExitModal(false);
            }}
          >
            <div
              className="life-emergency-confirm-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="life-emergency-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <p id="life-emergency-confirm-title" className="life-emergency-confirm-message">
                Are you sure? This will forfeit your Life Mode streak.
              </p>
              <div className="life-emergency-confirm-actions">
                <button
                  type="button"
                  className="ghost-btn life-emergency-confirm-cancel"
                  disabled={emergencyExitWorking}
                  onClick={() => setShowEmergencyExitModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-btn life-emergency-confirm-danger"
                  disabled={emergencyExitWorking}
                  onClick={() => void performEmergencyLifeExit()}
                >
                  {emergencyExitWorking ? "Ending…" : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
        {checkoutNotice ? <p className="answer chat-checkout-notice">{checkoutNotice}</p> : null}
      </section>
    );
  }

  return (
    <section className="card premium home-hub">
      <div className="home-card">
      <div className="hero-glow" />
      <div className="hero-stack">
        <p className="hero-kicker">⚡ Decision intelligence</p>
        <h1 className="hero-title">Decide For Me</h1>
        <p className="home-brand-tagline">Stop Overthinking. Just Decide.</p>
        <p className="hero-subtitle">What do you need help deciding?</p>
      </div>
      {!lifeModeSession && lifeModeRecap ? (
        <article className="life-mission-share-wrap">
          <CollapsibleShareImageBlock
            className="share-widget"
            revealLabel="Share your mission report"
            exportRef={lifeMissionShareCardRef}
            captionText={buildMissionRecapCaption(lifeModeRecap, lifeModeCaption)}
            filename="decide-for-me-life-mode-mission.png"
            showCopyCaption
            onCopyCaption={() => void copyLifeModeCaption()}
            copyLabel={copiedLifeCaption ? "Copied caption" : "Copy caption"}
          >
            <div
              ref={lifeMissionShareCardRef}
              className={`life-mode-share-export-card life-mode-share-export-card--rank-${decisionRank.tier}`}
            >
              <div className="life-mode-share-export-bg" aria-hidden="true" />
              <div className="life-mode-share-export-body">
                <header className="life-mode-share-export-head">
                  <p className="life-mode-share-export-brand">Decide For Me</p>
                  <p className="life-mode-share-export-mode">Life Mode · Mission report</p>
                </header>
                <div className="life-mode-share-export-identity">
                  <p className="life-mode-share-export-codename">{lifeModeRecap.codename || effectiveLifeSetup.codename}</p>
                  <div className={`life-mode-share-export-rank life-mode-share-export-rank--${decisionRank.tier}`}>
                    <span className="life-mode-share-export-rank-emoji" aria-hidden="true">
                      {decisionRank.emoji}
                    </span>
                    <span className="life-mode-share-export-rank-label">{decisionRank.label}</span>
                  </div>
                </div>
                <section className="life-mode-share-export-block life-mode-share-export-block--command">
                  <p className="life-mode-share-export-kicker">Honesty score</p>
                  <p className="life-mission-export-hero-pct">
                    {lifeModeRecap.complianceScore != null ? `${lifeModeRecap.complianceScore}%` : "—"}
                  </p>
                </section>
                {lifeModeRecap.viralSummary?.worstExcuse ? (
                  <section className="life-mode-share-export-block">
                    <p className="life-mode-share-export-kicker">Most relatable excuse</p>
                    <p className="life-mode-share-export-command">
                      {clampShareCardLine(lifeModeRecap.viralSummary.worstExcuse.label, 140)}
                    </p>
                    <p className="life-mode-share-export-excuse">
                      {clampShareCardLine(lifeModeRecap.viralSummary.worstExcuse.roast, 200)}
                    </p>
                  </section>
                ) : null}
                <section className="life-mode-share-export-block">
                  <p className="life-mode-share-export-kicker">AI verdict</p>
                  <p className="life-mode-share-export-verdict">
                    {lifeModeRecap.viralSummary?.verdict
                      ? `“${clampShareCardLine(lifeModeRecap.viralSummary.verdict, 220)}”`
                      : clampShareCardLine(String(lifeModeRecap.verdict || "").trim(), 260)}
                  </p>
                  {lifeModeRecap.roast ? (
                    <p className="life-mode-share-export-roast">{clampShareCardLine(lifeModeRecap.roast, 180)}</p>
                  ) : null}
                </section>
                <footer className="life-mode-share-export-foot">
                  <p className="life-mode-share-export-url">decideforme.org</p>
                </footer>
              </div>
            </div>
          </CollapsibleShareImageBlock>
        </article>
      ) : null}
      {renderChatRankStrip(false)}
      <p className="social-proof">{liveCount.toLocaleString()} decisions made today</p>
      <p className="meta life-global-count">{lifeModeGlobalCount} people currently living AI-controlled lives 🎲</p>
      {session?.user?.id ? (
        <p className="meta usage-meter">
          Free plan: {dailyUsage}/{DAILY_FREE_LIMIT} decisions today
        </p>
      ) : (
        <p className="meta usage-meter">
          Guest mode: {displayedGuestDailyUsage}/{GUEST_DAILY_FREE_LIMIT} free decisions today
        </p>
      )}
      {showFirstTimeNote ? (
        <p className="personalization-note">The more you use Decide For Me, the better it knows you.</p>
      ) : null}
      {profileDecisionCount >= 5 ? (
        <article className="history-item decision-profile-card">
          <p className="hero-kicker">Your Decision Profile</p>
          {isProUser ? (
            <div className="history-list">
              {profileInsights.map((insight) => (
                <p key={insight} className="answer">
                  {insight}
                </p>
              ))}
            </div>
          ) : (
            <>
              <p className="muted">
                Your full decision style revealed — see what drives every choice you make.
              </p>
              <button className="ghost-btn" type="button" onClick={() => setShowUpgradePrompt(true)}>
                Unlock full Decision Profile
              </button>
            </>
          )}
        </article>
      ) : null}
      <div className="chat-divider" />
      {session?.user?.id && !lifeModeSession ? (
        <div className="chat-history-toolbar">
          <button
            type="button"
            className="ghost-btn chat-history-toolbar-btn"
            onClick={() => void openChatHistoryPanel()}
            aria-expanded={chatHistoryOpen}
            aria-controls="chat-history-panel"
          >
            <History size={17} strokeWidth={2} />
            <span>History</span>
          </button>
          {conversation.length > 0 ? (
            <button type="button" className="ghost-btn chat-history-new-btn" onClick={startNewChat}>
              New chat
            </button>
          ) : null}
        </div>
      ) : null}

      {conversation.length || loading ? (
        <div className="chat-and-nearby">
          <div className="chat-frame">
            {lifeModeSession ? (
              <article className="life-chat-banner">
                <p className="hero-kicker">Life Mode in control</p>
                <p className="answer">{lifeModeCountdownLabel || lifeModeCountdown(lifeModeSession.ends_at)} left</p>
              </article>
            ) : null}
            {conversation.map(renderChatMessage)}
            {loading ? <LoadingAssistantShimmer /> : null}
            {showNearbyFindButton && !loading && conversation.length ? (
              <div className="find-nearby-cta find-nearby-cta--in-chat">
                <p className="nearby-cta-label">📍 Find places nearby:</p>
                <div className="nearby-radius-pills" role="group" aria-label="Search radius">
                  {NEARBY_RADIUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.meters}
                      type="button"
                      className={
                        "nearby-radius-pill" +
                        (nearbyRadiusMeters === opt.meters ? " nearby-radius-pill--active" : "")
                      }
                      onClick={() => setNearbyRadiusMeters(opt.meters)}
                      disabled={nearbyPlacesLoading}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ghost-btn find-nearby-btn"
                  onClick={() => fetchNearbyPlacesForContext()}
                  disabled={nearbyPlacesLoading}
                >
                  {nearbyPlacesLoading ? "Finding nearby…" : "Find places near me"}
                </button>
              </div>
            ) : null}
          </div>
          {nearbyFetchError ? <p className="error">{nearbyFetchError}</p> : null}
        </div>
      ) : null}

      {!conversation.length ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!prompt.trim() && !pendingImage) return;
            sendToAI(prompt.trim(), true);
          }}
        >
          {pendingImage ? (
            <div className="pending-attach-preview">
              <img src={pendingImage.previewUrl} alt="" className="pending-attach-thumb" />
              <button type="button" className="pending-attach-remove" onClick={clearPendingImage} aria-label="Remove photo">
                ×
              </button>
            </div>
          ) : null}
          <div className="chat-composer">
            <input
              ref={attachInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              tabIndex={-1}
              onChange={onAttachFile}
            />
            <button
              type="button"
              className="chat-composer-attach"
              disabled={loading || showUpgradePrompt}
              aria-label="Attach image"
              onClick={() => attachInputRef.current?.click()}
            >
              <Paperclip size={18} strokeWidth={1.75} />
            </button>
            <textarea
              ref={setPromptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={composerEnterSubmit}
              className="chat-composer-input"
              placeholder={
                showUpgradePrompt
                  ? "Pro required. Upgrade to continue with unlimited decisions and full Life Mode."
                  : "What should I decide?"
              }
              disabled={showUpgradePrompt}
              rows={1}
            />
            {(prompt.trim() || pendingImage) && !showUpgradePrompt ? (
              <button
                type="submit"
                className="chat-composer-send"
                disabled={loading}
                aria-label="Send"
              >
                <ArrowUp size={18} strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <form
          className="form followup-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reply.trim() && !pendingImage) return;
            sendToAI(reply.trim(), false);
          }}
        >
          {crisisSupportActive || samaritansBannerActive ? (
            <p className="samaritans-resources-strip" role="note">
              If you need someone to talk to: <strong>Samaritans 116 123</strong> (UK, free, 24/7). Immediate danger:{" "}
              <strong>999</strong>.
            </p>
          ) : followUpSuggestions.length ? (
            <div className="suggestion-row">
              {followUpSuggestions.map((text, i) => (
                <button
                  key={`${i}-${text}`}
                  type="button"
                  className="suggestion-chip"
                  onClick={() => {
                    if (loading || showUpgradePrompt) return;
                    sendToAI(text, false);
                  }}
                  disabled={loading || showUpgradePrompt}
                >
                  <span aria-hidden="true">{getFollowUpEmoji(text)}</span> {text}
                </button>
              ))}
            </div>
          ) : null}
          {pendingImage ? (
            <div className="pending-attach-preview">
              <img src={pendingImage.previewUrl} alt="" className="pending-attach-thumb" />
              <button type="button" className="pending-attach-remove" onClick={clearPendingImage} aria-label="Remove photo">
                ×
              </button>
            </div>
          ) : null}
          <div className="chat-composer">
            <input
              ref={attachInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              tabIndex={-1}
              onChange={onAttachFile}
            />
            <button
              type="button"
              className="chat-composer-attach"
              disabled={loading || showUpgradePrompt}
              aria-label="Attach image"
              onClick={() => attachInputRef.current?.click()}
            >
              <Paperclip size={18} strokeWidth={1.75} />
            </button>
            <textarea
              ref={setReplyRef}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={composerEnterSubmit}
              className="chat-composer-input"
              placeholder="Ask a follow-up..."
              disabled={showUpgradePrompt}
              rows={1}
            />
            {(reply.trim() || pendingImage) && !showUpgradePrompt ? (
              <button
                type="submit"
                className="chat-composer-send"
                disabled={loading}
                aria-label="Send"
              >
                <ArrowUp size={18} strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
        </form>
      )}

      {showUpgradePrompt ? (
        <div
          className="upgrade-modal-overlay"
          role="presentation"
          onClick={() => {
            setCheckoutError("");
            setShowUpgradePrompt(false);
          }}
        >
          <article className="upgrade-modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="upgrade-modal-close"
              onClick={() => {
                setCheckoutError("");
                setShowUpgradePrompt(false);
              }}
              aria-label="Close"
            >
              <X size={20} strokeWidth={2.25} />
            </button>
            <p className="hero-kicker">
              {upgradePromptReason === "lifemode"
                ? "Life Mode — full theatre"
                : upgradePromptReason === "feature"
                  ? "Premium feature"
                  : "Daily limit reached"}
            </p>
            <h2>{upgradePromptReason === "lifemode" ? "Unlock the drill sergeant in your pocket" : "Upgrade to Pro"}</h2>
            {upgradePromptReason === "lifemode" ? (
              <p className="muted upgrade-life-blurb">
                Pro includes the complete Command Centre: timed orders, weather-aware directives, compliance scoring, streaks, and
                share-ready mission reports.
              </p>
            ) : null}
            {upgradePromptReason === "limit" ? (
              <p className="muted upgrade-limit-copy">
                {session?.user?.id ? (
                  <>
                    You&apos;ve used all {DAILY_FREE_LIMIT} free decisions for today on the free plan. Upgrade to Pro for{" "}
                    <strong>unlimited decisions</strong>, Life Mode, chat history, and the full experience — starting with a{" "}
                    <strong>3-day free trial</strong> when you subscribe.
                  </>
                ) : (
                  <>
                    You&apos;ve used all {GUEST_DAILY_FREE_LIMIT} free guest decisions for today. Create an account and go Pro for unlimited
                    decisions and full features — or come back after midnight.
                  </>
                )}
              </p>
            ) : null}
            <p className="plan-price">
              {formatMonth()}/mo · {formatYear()}/yr
            </p>
            <div className="upgrade-modal-plans">
              <button
                type="button"
                className="primary-btn upgrade-cta"
                onClick={() => startProCheckout("month")}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? "Redirecting…" : `Monthly · ${formatMonth()}/mo`}
              </button>
              <button
                type="button"
                className="ghost-btn upgrade-cta"
                onClick={() => startProCheckout("year")}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? "Redirecting…" : `Yearly · ${formatYear()}/yr`}
              </button>
            </div>
          </article>
        </div>
      ) : null}
      {!conversation.length ? (
        <>
          <div className="quick-category-scroll">
            <div className="quick-category-row">
              {quickCategories.map((item) => (
                <button key={item.label} type="button" className="quick-category-pill" onClick={() => setPrompt(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {!lifeModeSession ? (
            <button className="life-mode-btn" type="button" onClick={openLifeModePrompt} onTouchEnd={openLifeModePrompt}>
              <span className="life-mode-title">🎲 Let AI Run My Life</span>
              <span className="life-mode-subtitle">Hand control to AI for 24 hours</span>
            </button>
          ) : (
            <article className="life-mode-banner">
              <p className="hero-kicker">Life Mode active</p>
              <p className="answer">{lifeModeCountdownLabel || lifeModeCountdown(lifeModeSession.ends_at)} remaining</p>
            </article>
          )}
          <DailyDilemmaCard session={session} />
        </>
      ) : null}
      <div className="home-insights">
        <article className="streak-spotlight">
          <div className="streak-head">
            <span className="streak-icon">
              <Flame size={16} />
            </span>
            <p className="hero-kicker">Momentum</p>
          </div>
          <h3>{currentStreak} day streak</h3>
          <p className="muted">Stay consistent with one decision today and keep your decision engine hot.</p>
        </article>
      </div>
      {conversation.length ? (
        <div className="chat-share-pack">
          <CollapsibleShareImageBlock
            className="share-widget"
            revealLabel="Share this chat snapshot"
            exportRef={chatShareCardRef}
            captionText={chatShareCaption}
            filename="decide-for-me-chat.png"
          >
            <div ref={chatShareCardRef} className={`life-mode-share-export-card life-mode-share-export-card--rank-${decisionRank.tier}`}>
              <div className="life-mode-share-export-bg" aria-hidden="true" />
              <div className="life-mode-share-export-body chat-share-export-inner">
                <header className="life-mode-share-export-head">
                  <p className="life-mode-share-export-brand">Decide For Me</p>
                  <p className="life-mode-share-export-mode">Decision snapshot</p>
                </header>
                <div className="chat-share-export-rank-row">
                  <span className={`chat-share-mini-badge chat-share-mini-badge--${decisionRank.tier}`}>
                    {decisionRank.emoji} {decisionRank.shortTag}
                  </span>
                </div>
                {chatExportLines.userLine ? (
                  <section className="chat-share-export-msg chat-share-export-msg--user">
                    <p className="life-mode-share-export-kicker">You</p>
                    <p className="chat-share-export-text">{chatExportLines.userLine}</p>
                  </section>
                ) : null}
                {chatExportLines.assistantLine ? (
                  <section className="chat-share-export-msg chat-share-export-msg--ai">
                    <p className="life-mode-share-export-kicker">AI</p>
                    <p className="chat-share-export-text">{chatExportLines.assistantLine}</p>
                  </section>
                ) : null}
                <footer className="life-mode-share-export-foot">
                  <p className="life-mode-share-export-url">decideforme.org</p>
                </footer>
              </div>
            </div>
          </CollapsibleShareImageBlock>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {checkoutNotice ? <p className="answer chat-checkout-notice">{checkoutNotice}</p> : null}
      {lifeModeExitNotice ? <p className="answer chat-checkout-notice">{lifeModeExitNotice}</p> : null}
      {lifeModeWizardOpen ? (
        <div className="life-mode-modal life-cc-wizard-overlay" role="dialog" aria-modal="true" aria-label="Life Mode setup">
          <div className="life-mode-modal-card life-cc-wizard-card">
            <button
              type="button"
              className="upgrade-modal-close"
              onClick={() => setLifeModeWizardOpen(false)}
              aria-label="Close"
            >
              <X size={20} strokeWidth={2.25} />
            </button>
            <p className="hero-kicker">Command Centre · setup</p>
            {lifeModeWizardStep === 0 ? (
              <>
                <h2>Wake time</h2>
                <p className="muted">When do you actually rise?</p>
                <select
                  className="life-cc-select"
                  value={lifeModeDraftWake}
                  onChange={(event) => setLifeModeDraftWake(Number(event.target.value))}
                >
                  {[5, 6, 7, 8, 9].map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <button type="button" className="primary-btn" onClick={() => setLifeModeWizardStep(1)}>
                  Next
                </button>
              </>
            ) : null}
            {lifeModeWizardStep === 1 ? (
              <>
                <h2>Work or rest day?</h2>
                <div className="life-cc-toggle-row">
                  <button
                    type="button"
                    className={"life-cc-pill" + (lifeModeDraftDayType === "work" ? " life-cc-pill--on" : "")}
                    onClick={() => setLifeModeDraftDayType("work")}
                  >
                    Work
                  </button>
                  <button
                    type="button"
                    className={"life-cc-pill" + (lifeModeDraftDayType === "rest" ? " life-cc-pill--on" : "")}
                    onClick={() => setLifeModeDraftDayType("rest")}
                  >
                    Rest
                  </button>
                </div>
                <button type="button" className="primary-btn" onClick={() => setLifeModeWizardStep(2)}>
                  Next
                </button>
                <button type="button" className="ghost-btn" onClick={() => setLifeModeWizardStep(0)}>
                  Back
                </button>
              </>
            ) : null}
            {lifeModeWizardStep === 2 ? (
              <>
                <h2>Energy level</h2>
                <div className="life-cc-toggle-row">
                  {["low", "medium", "high"].map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={"life-cc-pill" + (lifeModeDraftEnergy === e ? " life-cc-pill--on" : "")}
                      onClick={() => setLifeModeDraftEnergy(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <button type="button" className="primary-btn" onClick={() => setLifeModeWizardStep(3)}>
                  Next
                </button>
                <button type="button" className="ghost-btn" onClick={() => setLifeModeWizardStep(1)}>
                  Back
                </button>
              </>
            ) : null}
            {lifeModeWizardStep === 3 ? (
              <>
                <h2>Intensity</h2>
                <p className="muted">Gentle · firm. Strict · relentless. Brutal · savage.</p>
                <div className="life-cc-toggle-row life-cc-toggle-row--stack">
                  {["gentle", "strict", "brutal"].map((i) => (
                    <button
                      key={i}
                      type="button"
                      className={"life-cc-pill" + (lifeModeDraftIntensity === i ? " life-cc-pill--on" : "")}
                      onClick={() => setLifeModeDraftIntensity(i)}
                    >
                      {i}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => beginLifeModeActivationFlow()}
                  disabled={activatingLifeMode}
                >
                  {activatingLifeMode ? "Deploying…" : "Deploy Command Centre"}
                </button>
                <button type="button" className="ghost-btn" onClick={() => setLifeModeWizardStep(2)}>
                  Back
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {lifeModeFreePreviewOpen ? (
        <div className="life-mode-modal" role="dialog" aria-modal="true" aria-label="Life Mode preview">
          <div className="life-mode-modal-card life-cc-preview-card">
            <p className="hero-kicker">Life Mode preview</p>
            <h2>One directive. Then silence until you upgrade.</h2>
            <article className="life-cc-order life-cc-order--single">
              <p className="life-cc-time">0900</p>
              <p className="life-cc-text">
                You will consume a nutritious breakfast. No exceptions. This is the tone you&apos;re missing on Free.
              </p>
            </article>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setLifeModeFreePreviewOpen(false);
                setUpgradePromptReason("lifemode");
                setShowUpgradePrompt(true);
              }}
            >
              Unlock full Life Mode (Pro)
            </button>
            <button type="button" className="ghost-btn" onClick={() => setLifeModeFreePreviewOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {chatHistoryDrawer}
      </div>
    </section>
  );
}

const MOMENTUM_WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MOMENTUM_WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function startOfWeekMonday(d = new Date()) {
  const date = new Date(d.getTime());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function sameLocalCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function momentumHourBucket(hour) {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 21) return "Evening";
  return "Night";
}

function MomentumScreen({ session }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [weekBars, setWeekBars] = useState([]);
  const [thisWeekCount, setThisWeekCount] = useState(0);
  const [lastWeekCount, setLastWeekCount] = useState(0);
  const [peakWeekday, setPeakWeekday] = useState("—");
  const [peakTimeBucket, setPeakTimeBucket] = useState("—");

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("current_streak, longest_streak, total_decisions")
          .eq("id", session.user.id)
          .single();
        if (cancelled) return;
        setProfile(prof ?? null);

        const now = new Date();
        const weekStart = startOfWeekMonday(now);
        const nextWeekStart = new Date(weekStart.getTime());
        nextWeekStart.setDate(nextWeekStart.getDate() + 7);
        const lastWeekStart = new Date(weekStart.getTime());
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);

        const { data: twoWeekRows } = await supabase
          .from("decision_history")
          .select("created_at")
          .eq("user_id", session.user.id)
          .gte("created_at", lastWeekStart.toISOString())
          .lt("created_at", nextWeekStart.toISOString());

        const rows = twoWeekRows ?? [];
        let tw = 0;
        let lw = 0;
        for (const r of rows) {
          const t = new Date(r.created_at);
          if (t >= weekStart && t < nextWeekStart) tw += 1;
          else if (t >= lastWeekStart && t < weekStart) lw += 1;
        }

        const bars = [];
        for (let i = 0; i < 7; i++) {
          const day = new Date(weekStart.getTime());
          day.setDate(weekStart.getDate() + i);
          let c = 0;
          for (const r of rows) {
            const t = new Date(r.created_at);
            if (t >= weekStart && t < nextWeekStart && sameLocalCalendarDay(t, day)) c += 1;
          }
          bars.push({
            shortLabel: MOMENTUM_WEEKDAY_SHORT[day.getDay()],
            count: c,
            key: `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
          });
        }

        const since = new Date();
        since.setDate(since.getDate() - 120);
        const { data: patternRows } = await supabase
          .from("decision_history")
          .select("created_at")
          .eq("user_id", session.user.id)
          .gte("created_at", since.toISOString());

        const wd = [0, 0, 0, 0, 0, 0, 0];
        const buckets = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
        for (const r of patternRows ?? []) {
          const t = new Date(r.created_at);
          wd[t.getDay()] += 1;
          buckets[momentumHourBucket(t.getHours())] += 1;
        }
        let maxWd = 0;
        let maxWi = 0;
        wd.forEach((n, i) => {
          if (n > maxWd) {
            maxWd = n;
            maxWi = i;
          }
        });
        let maxBk = "Afternoon";
        let maxBv = -1;
        for (const [k, v] of Object.entries(buckets)) {
          if (v > maxBv) {
            maxBv = v;
            maxBk = k;
          }
        }

        if (cancelled) return;
        setWeekBars(bars);
        setThisWeekCount(tw);
        setLastWeekCount(lw);
        setPeakWeekday(maxWd > 0 ? MOMENTUM_WEEKDAY_FULL[maxWi] : "—");
        setPeakTimeBucket(maxBv > 0 ? maxBk : "—");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const rank = useMemo(() => getDecisionRank(profile?.total_decisions ?? 0), [profile?.total_decisions]);
  const maxBar = useMemo(() => Math.max(1, ...weekBars.map((b) => b.count)), [weekBars]);
  const weekDelta = thisWeekCount - lastWeekCount;

  if (!session) return <Navigate to="/login" replace />;

  return (
    <section className="card premium momentum-page">
      <header className="momentum-head">
        <h1>Momentum</h1>
        <p className="muted momentum-lead">Streaks, rhythm, and how you&apos;re climbing the ranks.</p>
      </header>

      {loading ? (
        <p className="meta">Loading your activity…</p>
      ) : (
        <>
          <div className="momentum-streak-row">
            <article className="momentum-stat-card">
              <p className="momentum-stat-label">Current streak</p>
              <p className="momentum-stat-value">🔥 {profile?.current_streak ?? 0} days</p>
            </article>
            <article className="momentum-stat-card">
              <p className="momentum-stat-label">Longest streak</p>
              <p className="momentum-stat-value">{profile?.longest_streak ?? 0} days</p>
            </article>
          </div>

          <article className="momentum-panel">
            <p className="momentum-panel-title">This week · decisions per day</p>
            <div className="momentum-chart" role="img" aria-label="Decisions per day this week">
              {weekBars.map((b) => (
                <div key={b.key} className="momentum-chart-col">
                  <div className="momentum-chart-bar-wrap">
                    <div
                      className="momentum-chart-bar"
                      style={{ height: `${Math.max(8, (b.count / maxBar) * 100)}%` }}
                    />
                  </div>
                  <span className="momentum-chart-count">{b.count}</span>
                  <span className="momentum-chart-day">{b.shortLabel}</span>
                </div>
              ))}
            </div>
          </article>

          <div className="momentum-two-col">
            <article className="momentum-panel momentum-panel--compact">
              <p className="momentum-panel-title">Most active</p>
              <p className="momentum-detail">
                <span className="momentum-detail-label">Day</span>
                <span className="momentum-detail-value">{peakWeekday}</span>
              </p>
              <p className="momentum-detail">
                <span className="momentum-detail-label">Time</span>
                <span className="momentum-detail-value">{peakTimeBucket}</span>
              </p>
              <p className="meta momentum-pattern-note">Based on the last ~4 months of decisions.</p>
            </article>
            <article className="momentum-panel momentum-panel--compact">
              <p className="momentum-panel-title">Weekly volume</p>
              <p className="momentum-compare">
                <span className="momentum-compare-num">{thisWeekCount}</span>
                <span className="momentum-compare-label">this week</span>
              </p>
              <p className="momentum-compare">
                <span className="momentum-compare-num momentum-compare-num--muted">{lastWeekCount}</span>
                <span className="momentum-compare-label">last week</span>
              </p>
              <p className={`momentum-delta ${weekDelta >= 0 ? "momentum-delta--up" : "momentum-delta--down"}`}>
                {weekDelta >= 0 ? "+" : ""}
                {weekDelta} vs last week
              </p>
            </article>
          </div>

          <article className={`prestige-rank-card prestige-rank-card--${rank.tier} momentum-rank-card`}>
            <div className="prestige-rank-card-bg" aria-hidden="true" />
            <div className="prestige-rank-main">
              <div className={`prestige-rank-emblem prestige-rank-emblem--${rank.tier}`}>
                <span className="prestige-rank-emoji" aria-hidden="true">
                  {rank.emoji}
                </span>
              </div>
              <div className="prestige-rank-text">
                <p className="prestige-rank-kicker">Rank</p>
                <h2 className="prestige-rank-title">{rank.label}</h2>
                <p className="prestige-rank-meta">
                  <strong>{profile?.total_decisions ?? 0}</strong> lifetime decisions
                  <span className="prestige-rank-dot"> · </span>
                  {rank.rangeLabel}
                </p>
              </div>
            </div>
            <div
              className="prestige-progress-track momentum-rank-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(rank.progress * 100)}
              aria-label={`Progress toward ${rank.nextRankLabel}`}
            >
              <div className="prestige-progress-fill" style={{ width: `${Math.min(100, rank.progress * 100)}%` }} />
            </div>
            <p className="momentum-next-rank">
              {rank.toNext > 0 ? (
                <>
                  <span className="momentum-next-num">{rank.toNext}</span> more{" "}
                  {rank.toNext === 1 ? "decision" : "decisions"} to <strong>{rank.nextRankLabel}</strong>
                </>
              ) : (
                <span className="prestige-next-maxed">Top of bracket — keep going to advance.</span>
              )}
            </p>
          </article>
        </>
      )}
    </section>
  );
}

function DecisionProfileScreen({ session }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const shareCardRef = useRef(null);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("decision_history")
          .select("conversation, created_at")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(250);
        if (!cancelled) setRows(data ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const insights = useMemo(() => analyzeDecisionHistoryRows(rows), [rows]);
  const maxTopicCount = useMemo(
    () => Math.max(1, ...insights.topics.map((t) => t.count)),
    [insights.topics]
  );

  const shareCaption = useMemo(() => {
    const top = insights.topics[0]?.topic ?? "everything";
    return `My Decide For Me personality: ${insights.personality.title}\n${insights.personality.tagline}\nMost common lane: ${top}.`;
  }, [insights]);

  if (!session) return <Navigate to="/login" replace />;

  const { personality, topics, pace, decisiveness, sampleSize } = insights;
  const topTopic = topics[0];

  return (
    <section className="card premium decision-profile-page">
      <header className="dp-head">
        <h1>Decision Profile</h1>
        <p className="muted dp-lead">
          Your habits, favorite lanes, and a card worth posting — generated from how you actually decide.
        </p>
      </header>

      {loading ? (
        <p className="meta">Reading your decision DNA…</p>
      ) : (
        <>
          <article className={`dp-hero dp-hero--${personality.variant}`}>
            <span className="dp-hero-emoji" aria-hidden="true">
              {personality.emoji}
            </span>
            <div className="dp-hero-text">
              <p className="hero-kicker">
                <Sparkles size={14} strokeWidth={2} className="dp-kicker-icon" aria-hidden="true" /> Your style
              </p>
              <h2 className="dp-hero-title">{personality.title}</h2>
              <p className="dp-hero-tagline">{personality.tagline}</p>
              <p className="meta dp-sample-note">Based on {sampleSize} saved decision{sampleSize === 1 ? "" : "s"}.</p>
            </div>
          </article>

          <article className="dp-panel">
            <p className="dp-panel-title">Top categories</p>
            {topics.length === 0 ? (
              <p className="meta">No topics yet — your first prompts will fill this chart.</p>
            ) : (
              <div className="dp-topic-list" role="list">
                {topics.slice(0, 10).map((t) => (
                  <div key={t.topic} className="dp-topic-row" role="listitem">
                    <span className="dp-topic-label">
                      <span className="dp-topic-emoji" aria-hidden="true">
                        {topicEmojiForDecisionProfile(t.topic)}
                      </span>
                      {t.topic}
                    </span>
                    <div className="dp-topic-track" aria-hidden="true">
                      <div
                        className="dp-topic-fill"
                        style={{ width: `${Math.max(6, (t.count / maxTopicCount) * 100)}%` }}
                      />
                    </div>
                    <span className="dp-topic-pct">
                      {t.pct}% · {t.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>

          <div className="dp-two-col">
            <article className="dp-panel dp-panel--stat">
              <p className="dp-panel-title">Your pace</p>
              <p className="dp-stat-value">{pace.label}</p>
              <p className="meta dp-stat-detail">{pace.detail}</p>
            </article>
            <article className="dp-panel dp-panel--stat">
              <p className="dp-panel-title">Decisiveness</p>
              {decisiveness.score != null ? (
                <>
                  <p className="dp-stat-value">
                    {decisiveness.label}{" "}
                    <span className="dp-score-pill">
                      <strong>{decisiveness.score}</strong>/100
                    </span>
                  </p>
                  <div className="dp-score-track" role="progressbar" aria-valuenow={decisiveness.score} aria-valuemin={0} aria-valuemax={100}>
                    <div className="dp-score-fill" style={{ width: `${decisiveness.score}%` }} />
                  </div>
                  <p className="meta dp-stat-detail">{decisiveness.detail}</p>
                </>
              ) : (
                <p className="meta dp-stat-detail">{decisiveness.detail}</p>
              )}
            </article>
          </div>

          <article className="dp-share-section">
            <CollapsibleShareImageBlock
              className="share-widget"
              revealLabel="Share your decision profile"
              expandedIntro={<p className="meta dp-share-blurb">Preview, download, or share — optional caption copy.</p>}
              toolbarClassName="dp-share-toolbar"
              exportRef={shareCardRef}
              captionText={shareCaption}
              filename="decide-for-me-decision-profile.png"
              showCopyCaption
              onCopyCaption={() => copyText(shareCaption)}
              copyLabel="Copy caption"
            >
              <div className="dp-share-layout dp-share-widget-stack">
                <div className="dp-share-preview">
                  <div ref={shareCardRef} className={`dp-share-card dp-share-card--${personality.variant}`}>
                    <div className="dp-share-card-bg" aria-hidden="true" />
                    <div className="dp-share-card-inner">
                      <p className="dp-share-brand">Decide For Me</p>
                      <p className="dp-share-emoji">{personality.emoji}</p>
                      <h3 className="dp-share-card-title">{personality.title}</h3>
                      <p className="dp-share-card-line">{personality.tagline}</p>
                      <div className="dp-share-meta-row">
                        {topTopic ? (
                          <span className="dp-share-chip">
                            {topicEmojiForDecisionProfile(topTopic.topic)} {topTopic.topic} · {topTopic.pct}%
                          </span>
                        ) : (
                          <span className="dp-share-chip">Ready to decide</span>
                        )}
                        {decisiveness.score != null ? (
                          <span className="dp-share-chip">{decisiveness.label}</span>
                        ) : null}
                      </div>
                      <p className="dp-share-foot">{sampleSize} decision{sampleSize === 1 ? "" : "s"} in this profile</p>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleShareImageBlock>
          </article>
        </>
      )}
    </section>
  );
}

function HistoryScreen({ session }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("decision_history")
      .select("id, answer, created_at, conversation")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => setHistory(data ?? []));
  }, [session.user.id]);

  return (
    <section className="card premium history-page">
      <header className="history-page-head">
        <h1>History</h1>
        <p className="muted history-page-lead">Newest first — your question and a snippet of what you decided.</p>
      </header>
      <div className="history-card-list">
        {history.length === 0 ? (
          <p className="meta">No decisions yet — ask something on the home screen.</p>
        ) : null}
        {history.map((item) => {
          const rawQ = firstUserPromptFromConversation(item.conversation);
          const questionTitle =
            rawQ.trim() ||
            trimDecisionSnippet(String(item.answer || "").replace(/\*\*/g, ""), 72) ||
            "Decision";
          return (
            <article key={item.id} className="history-entry-card">
              <h2 className="history-entry-question">{questionTitle}</h2>
              <div className="history-entry-preview" aria-label="Answer preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(item.answer || "").trim()}</ReactMarkdown>
              </div>
              <time className="history-entry-date" dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleString()}
              </time>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StatsScreen({ session }) {
  const [stats, setStats] = useState(null);
  const [weeklyRecap, setWeeklyRecap] = useState(null);
  const statsWrappedShareRef = useRef(null);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    const load = async () => {
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      const { data: history } = await supabase
        .from("decision_history")
        .select("created_at, conversation")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });
      const list = history ?? [];
      const topicCounts = {};
      for (const item of list) {
        const promptText = firstUserPromptFromConversation(item.conversation);
        const topic = inferStatTopicFromUserText(promptText);
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      }
      const mostIndecisive =
        Object.entries(topicCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "General";
      const firstPrompt = firstUserPromptFromConversation(list[0]?.conversation);
      setStats({
        totalDecisions: profile?.total_decisions || list.length,
        mostIndecisive,
        longestStreak: profile?.longest_streak || 0,
        firstDecision: firstPrompt || "No decisions yet"
      });

      const monday = new Date().getDay() === 1;
      const insights = [
        `Your log leans heaviest on ${mostIndecisive} — that theme shows up most often.`,
        `Momentum: ${profile?.current_streak || 0} day streak and ${profile?.total_votes || 0} community votes.`
      ];
      if (monday) {
        setWeeklyRecap(insights);
      } else {
        setWeeklyRecap(null);
      }
    };
    load();
  }, [session?.user?.id]);

  const statsRank = useMemo(() => (stats ? getDecisionRank(stats.totalDecisions) : null), [stats]);

  const wrappedShareCaption = useMemo(() => {
    if (!stats) return "Decide For Me Wrapped · decideforme.org";
    const rankBit = statsRank ? `${statsRank.label}` : "Rank";
    let t = `My Decide For Me Wrapped · ${stats.totalDecisions} lifetime decisions · ${rankBit} · Top topic: ${stats.mostIndecisive} · Longest streak ${stats.longestStreak} days`;
    if (weeklyRecap?.length) t += `\n\n${weeklyRecap.join("\n")}`;
    return `${t}\n\ndecideforme.org`;
  }, [stats, statsRank, weeklyRecap]);

  if (!stats) return <section className="card">Loading your wrapped...</section>;

  return (
    <section className="card premium wrapped-card stats-wrapped-page">
      <h1>Your Decision Wrapped</h1>
      <p className="muted">Your habits, streaks and decision personality in one snapshot.</p>
      {statsRank ? (
        <article className={`prestige-rank-card prestige-rank-card--${statsRank.tier} stats-wrapped-rank`}>
          <div className="prestige-rank-card-bg" aria-hidden="true" />
          <div className="prestige-rank-main">
            <div className={`prestige-rank-emblem prestige-rank-emblem--${statsRank.tier}`}>
              <span className="prestige-rank-emoji" aria-hidden="true">
                {statsRank.emoji}
              </span>
            </div>
            <div className="prestige-rank-text">
              <p className="prestige-rank-kicker">Combat record</p>
              <h2 className="prestige-rank-title">{statsRank.label}</h2>
              <p className="prestige-rank-meta">
                <strong>{stats.totalDecisions}</strong> lifetime decisions
                <span className="prestige-rank-dot"> · </span>
                {statsRank.rangeLabel}
              </p>
            </div>
          </div>
        </article>
      ) : null}
      <div className="stats-grid stats-grid--three">
        <article className="history-item">
          <p className="meta">Total decisions</p>
          <p className="answer">{stats.totalDecisions}</p>
        </article>
        <article className="history-item">
          <p className="meta">Most indecisive about</p>
          <p className="answer">{stats.mostIndecisive}</p>
        </article>
        <article className="history-item">
          <p className="meta">Longest streak</p>
          <p className="answer">🔥 {stats.longestStreak} days</p>
        </article>
      </div>
      <article className="history-item stats-first-decision">
        <p className="meta">First ever decision</p>
        <p className="stats-first-prompt">{stats.firstDecision}</p>
      </article>
      {weeklyRecap ? (
        <article className="history-item weekly-recap">
          <p className="meta">Last week your AI learned this about you...</p>
          <ul>
            {weeklyRecap.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="stats-wrapped-share-section">
        <CollapsibleShareImageBlock
          className="share-widget"
          revealLabel="Share your Wrapped"
          expandedIntro={<p className="meta life-cc-share-intro">Includes weekly lines on recap Mondays.</p>}
          exportRef={statsWrappedShareRef}
          captionText={wrappedShareCaption}
          filename="decide-for-me-wrapped.png"
        >
          <div
            ref={statsWrappedShareRef}
            className={`life-mode-share-export-card life-mode-share-export-card--rank-${statsRank?.tier || "recruit"}`}
          >
            <div className="life-mode-share-export-bg" aria-hidden="true" />
            <div className="life-mode-share-export-body">
              <header className="life-mode-share-export-head">
                <p className="life-mode-share-export-brand">Decide For Me</p>
                <p className="life-mode-share-export-mode">Decision Wrapped</p>
              </header>
              {statsRank ? (
                <div className="life-mode-share-export-identity">
                  <p className="stats-wrapped-export-rank-title">{statsRank.label}</p>
                  <div className={`life-mode-share-export-rank life-mode-share-export-rank--${statsRank.tier}`}>
                    <span className="life-mode-share-export-rank-emoji" aria-hidden="true">
                      {statsRank.emoji}
                    </span>
                    <span className="life-mode-share-export-rank-label">{stats.totalDecisions} decisions</span>
                  </div>
                </div>
              ) : null}
              <section className="life-mode-share-export-block life-mode-share-export-block--command">
                <p className="life-mode-share-export-kicker">Signal summary</p>
                <p className="life-mode-share-export-command">
                  Most indecisive lane: <strong>{stats.mostIndecisive}</strong>
                </p>
                <p className="life-mode-share-export-excuse">
                  Longest streak 🔥 {stats.longestStreak} days · First decision: {clampShareCardLine(stats.firstDecision, 160)}
                </p>
              </section>
              {weeklyRecap?.length ? (
                <section className="life-mode-share-export-block">
                  <p className="life-mode-share-export-kicker">Weekly recap</p>
                  {weeklyRecap.map((line) => (
                    <p key={line} className="stats-wrapped-recap-line">
                      {clampShareCardLine(line, 200)}
                    </p>
                  ))}
                </section>
              ) : null}
              <footer className="life-mode-share-export-foot">
                <p className="life-mode-share-export-url">decideforme.org</p>
              </footer>
            </div>
          </div>
        </CollapsibleShareImageBlock>
      </article>
    </section>
  );
}

function ExploreScreen({ session }) {
  return (
    <section className="card premium explore-hub">
      <header className="explore-hub-head">
        <h1>Explore</h1>
        <p className="muted">Discover modes, cards, and deeper decision tools.</p>
      </header>
      <div className="explore-tiles">
        <Link to="/group" className="explore-tile">
          <span className="explore-tile-icon" aria-hidden="true">
            <Users size={22} strokeWidth={1.75} />
          </span>
          <span className="explore-tile-title">Group decisions</span>
          <span className="explore-tile-desc">Collect votes, one final call</span>
        </Link>
        <Link to="/leaderboard" className="explore-tile">
          <span className="explore-tile-icon" aria-hidden="true">
            <Trophy size={22} strokeWidth={1.75} />
          </span>
          <span className="explore-tile-title">Leaderboard</span>
          <span className="explore-tile-desc">See how you rank</span>
        </Link>
        {session?.user?.id ? (
          <>
            <Link to="/stats" className="explore-tile">
              <span className="explore-tile-icon" aria-hidden="true">
                <BarChart2 size={22} strokeWidth={1.75} />
              </span>
              <span className="explore-tile-title">Stats &amp; streaks</span>
              <span className="explore-tile-desc">Your momentum &amp; recap</span>
            </Link>
            <Link to="/history" className="explore-tile">
              <span className="explore-tile-icon" aria-hidden="true">
                <Clock size={22} strokeWidth={1.75} />
              </span>
              <span className="explore-tile-title">History</span>
              <span className="explore-tile-desc">Past decisions</span>
            </Link>
            <Link to="/momentum" className="explore-tile">
              <span className="explore-tile-icon" aria-hidden="true">
                <Flame size={22} strokeWidth={1.75} />
              </span>
              <span className="explore-tile-title">Momentum</span>
              <span className="explore-tile-desc">Streaks, weekly rhythm &amp; rank progress</span>
            </Link>
            <Link to="/decision-profile" className="explore-tile">
              <span className="explore-tile-icon" aria-hidden="true">
                <User size={22} strokeWidth={1.75} />
              </span>
              <span className="explore-tile-title">Decision Profile</span>
              <span className="explore-tile-desc">Personality, categories &amp; share card</span>
            </Link>
            <Link to="/?lifeMode=1" className="explore-tile">
              <span className="explore-tile-icon" aria-hidden="true">
                <Compass size={22} strokeWidth={1.75} />
              </span>
              <span className="explore-tile-title">Let AI Run My Life</span>
              <span className="explore-tile-desc">Open Life Mode setup on home</span>
            </Link>
          </>
        ) : (
          <p className="explore-guest-hint muted">
            <Link to="/login" className="answer">
              Sign in
            </Link>{" "}
            for personal stats and history.
          </p>
        )}
      </div>
    </section>
  );
}

function GroupCreateScreen({ session }) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");

  const createGroup = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const shareCode = crypto.randomUUID().split("-")[0];
    const { data, error: insertError } = await supabase
      .from("group_decisions")
      .insert({
        owner_id: session?.user?.id ?? null,
        prompt,
        personality: "Inferred tone",
        share_code: shareCode
      })
      .select("id, share_code")
      .single();
    if (insertError) return setError(insertError.message);
    navigate(`/group/${data.share_code}`);
  };

  return (
    <section className="card premium">
      <h1>Decide for my group</h1>
      <p className="muted">Create a decision room, share the link, collect preferences, get one final call.</p>
      <form className="form" onSubmit={createGroup}>
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should our group decide?"
          required
        />
        <button className="primary-btn">Create group room</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function GroupRoomScreen({ session }) {
  const { shareCode } = useParams();
  const [room, setRoom] = useState(null);
  const [preference, setPreference] = useState("");
  const [prefs, setPrefs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [finalBookingLinks, setFinalBookingLinks] = useState([]);
  const [linkCopied, setLinkCopied] = useState(false);

  const voterCount = useMemo(() => {
    const keys = new Set();
    for (const p of prefs) {
      if (p.user_id) keys.add(`u:${p.user_id}`);
      else keys.add(`n:${String(p.nickname || "").trim() || "guest"}`);
    }
    return keys.size;
  }, [prefs]);

  const loadRoom = async () => {
    if (!supabase) return;
    const { data: roomData } = await supabase
      .from("group_decisions")
      .select("*")
      .eq("share_code", shareCode)
      .single();
    setRoom(roomData);
    if (!roomData) return;
    const { data: prefData } = await supabase
      .from("group_preferences")
      .select("*")
      .eq("group_id", roomData.id)
      .order("created_at", { ascending: false });
    setPrefs(prefData ?? []);
  };

  useEffect(() => {
    setFinalBookingLinks([]);
    loadRoom();
  }, [shareCode]);

  useEffect(() => {
    if (!supabase || !room?.id) return;
    const channel = supabase
      .channel(`group-${room.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_preferences", filter: `group_id=eq.${room.id}` },
        () => loadRoom()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  const submitPreference = async (event) => {
    event.preventDefault();
    if (!supabase || !room || !preference.trim()) return;
    const { error: insertError } = await supabase.from("group_preferences").insert({
      group_id: room.id,
      user_id: session?.user?.id ?? null,
      nickname: session?.user?.email?.split("@")[0] || "Guest",
      preference
    });
    if (!insertError) setPreference("");
  };

  const generateFinal = async () => {
    if (!room) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/decide"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: room.prompt,
          personality: room.personality,
          groupSummary: prefs.map((p) => `${p.nickname}: ${p.preference}`).join("\n"),
          conversation: []
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed final group call.");
      setFinalBookingLinks(Array.isArray(data.bookingLinks) ? data.bookingLinks : []);
      await supabase.from("group_decisions").update({ final_answer: data.answer }).eq("id", room.id);
      loadRoom();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!room) return <section className="card">Loading room...</section>;
  const shareLink = `${window.location.origin}/group/${room.share_code}`;

  const copyShareLink = async () => {
    try {
      setError("");
      await copyText(shareLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      setError("Could not copy — try selecting the link manually.");
    }
  };

  const voterLabel =
    voterCount === 0
      ? "No preferences yet — share the link to get started."
      : voterCount === 1
        ? "1 person has added a preference"
        : `${voterCount} people have added preferences`;

  return (
    <section className="card premium group-room-page">
      <header className="group-room-header">
        <h1 className="group-room-title">Group room</h1>
        <p className="group-room-lead">
          Share the link below with your group. Once everyone adds their preference, make the final decision.
        </p>
      </header>

      <div className="group-room-share-card">
        <p className="group-room-share-kicker">Share with friends</p>
        <p className="group-room-share-label">Copy this link and send it in your group chat</p>
        <div className="group-room-share-row">
          <div className="group-room-url-wrap">
            <span className="group-room-url" title={shareLink}>
              {shareLink}
            </span>
          </div>
          <button type="button" className="primary-btn group-room-copy-btn" onClick={() => void copyShareLink()}>
            <Copy size={18} strokeWidth={2} aria-hidden />
            {linkCopied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>

      <div className="group-room-topic">
        <p className="group-room-topic-label">What you&apos;re deciding</p>
        <p className="group-room-prompt">{room.prompt}</p>
      </div>

      <p className="group-room-voter-count" role="status">
        <Users size={18} strokeWidth={2} className="group-room-voter-icon" aria-hidden />
        {voterLabel}
      </p>

      <form className="form group-room-form" onSubmit={submitPreference}>
        <label className="group-room-field-label" htmlFor="group-pref-input">
          Your preference
        </label>
        <div className="group-room-form-row">
          <input
            id="group-pref-input"
            value={preference}
            onChange={(event) => setPreference(event.target.value)}
            placeholder="e.g. Italian, somewhere quiet…"
          />
          <button className="ghost-btn group-room-add-btn" type="submit">
            Add preference
          </button>
        </div>
      </form>

      <div className="group-room-prefs-wrap">
        <p className="group-room-prefs-heading">Group preferences</p>
        {prefs.length === 0 ? (
          <p className="meta group-room-prefs-empty">Preferences will show up here as people join.</p>
        ) : (
          <ul className="group-room-prefs-list">
            {prefs.map((p) => (
              <li key={p.id} className="group-room-pref-card">
                <span className="group-room-pref-name">{p.nickname}</span>
                <p className="group-room-pref-text">{p.preference}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="group-room-final-wrap">
        <button
          type="button"
          className="primary-btn group-room-final-cta"
          onClick={generateFinal}
          disabled={loading || prefs.length === 0}
        >
          {loading ? "Deciding…" : "Make final group decision"}
        </button>
        {prefs.length === 0 ? <p className="meta group-room-final-hint">Add at least one preference first.</p> : null}
      </div>

      {room.final_answer ? (
        <div className="group-room-result">
          <p className="group-room-result-label">Final decision</p>
          <p className="answer group-room-final-answer">{room.final_answer}</p>
          {finalBookingLinks.length ? (
            <div className="booking-pills-row" role="navigation" aria-label="Compare and book">
              {finalBookingLinks.map((link) => (
                <a key={link.label} href={link.url} className="booking-pill" target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <LoadingOrb /> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function LeaderboardScreen({ session }) {
  const leaderboardShareCardRef = useRef(null);
  const placeholderUsers = useMemo(
    () => [
      { id: "p1", username: "Mystery Decider", score: 184, current_streak: 7 },
      { id: "p2", username: "Bold Chooser", score: 162, current_streak: 4 },
      { id: "p3", username: "The Indecisive One", score: 149, current_streak: 0 },
      { id: "p4", username: "Coin Flip Legend", score: 121, current_streak: 3 },
      { id: "p5", username: "Late Night Picker", score: 109, current_streak: 2 },
      { id: "p6", username: "Vibe Selector", score: 96, current_streak: 0 },
      { id: "p7", username: "Snap Decision", score: 87, current_streak: 5 },
      { id: "p8", username: "Gut Feeling Guru", score: 81, current_streak: 0 }
    ],
    []
  );

  const [mode, setMode] = useState("all");
  const [leaders, setLeaders] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadLeaderboard = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, total_decisions, current_streak")
      .order("total_decisions", { ascending: false });
    const profileList = profiles ?? [];

    let list = profileList.map((p) => ({
      ...p,
      score: p.total_decisions || 0
    }));

    if (mode === "week") {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: weekData } = await supabase
        .from("decision_history")
        .select("user_id")
        .gte("created_at", weekAgo);
      const weekCounts = {};
      for (const row of weekData ?? []) {
        weekCounts[row.user_id] = (weekCounts[row.user_id] || 0) + 1;
      }
      list = profileList
        .map((p) => ({
          ...p,
          score: weekCounts[p.id] || 0
        }))
        .sort((a, b) => b.score - a.score);
    } else {
      list.sort((a, b) => b.score - a.score);
    }

    const top = list.slice(0, 20);
    setLeaders(top.length ? top : placeholderUsers);
    if (session?.user?.id) {
      const idx = list.findIndex((u) => u.id === session.user.id);
      if (idx >= 0) setMyRank({ rank: idx + 1, ...list[idx] });
    }
    setLoading(false);
  };

  useEffect(() => {
    loadLeaderboard();
    if (!supabase) return;
    const channel = supabase
      .channel("leaderboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, loadLeaderboard)
      .on("postgres_changes", { event: "*", schema: "public", table: "decision_history" }, loadLeaderboard)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session?.user?.id, mode, placeholderUsers]);

  const activeLeaders = leaders.length ? leaders : placeholderUsers;
  const podium = activeLeaders.slice(0, 3);
  const rest = activeLeaders.slice(3, 20);

  const leaderboardPrestigeRank = useMemo(() => (myRank ? getDecisionRank(myRank.score || 0) : null), [myRank]);

  const leaderboardShareCaption = useMemo(() => {
    if (!myRank) return "Decide For Me Leaderboard · decideforme.org";
    const scope = mode === "week" ? "This week" : "All-time";
    const label = leaderboardPrestigeRank?.label || "Rank";
    return `#${myRank.rank} on Decide For Me (${scope}) · ${label} · ${myRank.score || 0} decisions\n\ndecideforme.org`;
  }, [myRank, mode, leaderboardPrestigeRank]);

  const podiumSlot = (user, index) => {
    const rank = index + 1;
    const initials = (user?.username || "U").slice(0, 2).toUpperCase();
    const medalClass = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";
    return (
      <article key={user?.id || `placeholder-${rank}`} className={`podium-slot ${medalClass} ${rank === 1 ? "champ" : ""}`}>
        <p className="meta">
          {rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"} #{rank}
        </p>
        <div className="podium-avatar">{initials}</div>
        <h4>{user?.username || "Mystery Decider"}</h4>
        <p className="answer">
          <AnimatedCounter value={user?.score || 0} /> decisions
        </p>
      </article>
    );
  };

  return (
    <section className="card premium leaderboard-card referrals-page-safe">
      <div className="leaderboard-head">
        <h1 className="leaderboard-title">🏆 Leaderboard</h1>
        <div className="tab-row">
          <button className={`chip ${mode === "all" ? "active" : ""}`} onClick={() => setMode("all")}>
            All Time
          </button>
          <button className={`chip ${mode === "week" ? "active" : ""}`} onClick={() => setMode("week")}>
            This Week
          </button>
        </div>
      </div>

      <div className="podium-grid">
        {loading
          ? [1, 2, 3].map((i) => (
              <article key={i} className="podium-slot skeleton">
                <div className="podium-avatar" />
              </article>
            ))
          : [podium[1], podium[0], podium[2]].map((u, i) => podiumSlot(u, i === 0 ? 1 : i === 1 ? 0 : 2))}
      </div>

      <div className="leader-list">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <article key={i} className="history-item rank-line skeleton">
                <p>Loading...</p>
              </article>
            ))
          : rest.map((user, i) => (
              <article key={user.id} className="history-item rank-line">
                <p className="rank-num">#{i + 4}</p>
                <div className="podium-avatar small">{(user.username || "U").slice(0, 2).toUpperCase()}</div>
                <p>{user.username || "Unnamed"}</p>
                <p className="meta">
                  <AnimatedCounter value={user.score || 0} /> decisions{" "}
                  {user.current_streak > 0 ? <span>🔥</span> : null}
                </p>
              </article>
            ))}
      </div>

      <article className="your-rank-card">
        <p className="meta">Your Rank</p>
        {myRank ? (
          <p className="answer">
            #{myRank.rank} · <AnimatedCounter value={myRank.score || 0} /> decisions
          </p>
        ) : (
          <p className="answer">Make your first decision to claim your spot on the leaderboard! 🚀</p>
        )}
      </article>

      {session?.user?.id && myRank ? (
        <article className="leaderboard-share-pack">
          <CollapsibleShareImageBlock
            className="share-widget"
            revealLabel="Share your rank"
            expandedIntro={<p className="meta life-cc-share-intro">Prestige tier on the card.</p>}
            exportRef={leaderboardShareCardRef}
            captionText={leaderboardShareCaption}
            filename="decide-for-me-leaderboard.png"
          >
            <div
              ref={leaderboardShareCardRef}
              className={`life-mode-share-export-card life-mode-share-export-card--rank-${leaderboardPrestigeRank?.tier || "recruit"}`}
            >
              <div className="life-mode-share-export-bg" aria-hidden="true" />
              <div className="life-mode-share-export-body">
                <header className="life-mode-share-export-head">
                  <p className="life-mode-share-export-brand">Decide For Me</p>
                  <p className="life-mode-share-export-mode">
                    Leaderboard · {mode === "week" ? "This week" : "All-time"}
                  </p>
                </header>
                <div className="life-mode-share-export-identity">
                  <p className="stats-wrapped-export-rank-title">#{myRank.rank}</p>
                  {leaderboardPrestigeRank ? (
                    <div className={`life-mode-share-export-rank life-mode-share-export-rank--${leaderboardPrestigeRank.tier}`}>
                      <span className="life-mode-share-export-rank-emoji" aria-hidden="true">
                        {leaderboardPrestigeRank.emoji}
                      </span>
                      <span className="life-mode-share-export-rank-label">{leaderboardPrestigeRank.label}</span>
                    </div>
                  ) : null}
                </div>
                <section className="life-mode-share-export-block life-mode-share-export-block--command">
                  <p className="life-mode-share-export-kicker">Score</p>
                  <p className="life-mission-export-hero-pct">{myRank.score ?? 0}</p>
                  <p className="life-mode-share-export-excuse">decisions in this view</p>
                </section>
                <footer className="life-mode-share-export-foot">
                  <p className="life-mode-share-export-url">decideforme.org</p>
                </footer>
              </div>
            </div>
          </CollapsibleShareImageBlock>
        </article>
      ) : null}
    </section>
  );
}

function RefLandingCapture() {
  const { username: code } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const referralCode = String(code || "")
      .trim()
      .toLowerCase();
    if (referralCode) {
      localStorage.setItem("pending_ref_slug", referralCode);
      localStorage.setItem("pending_referral_code", referralCode);
      localStorage.setItem("referral_code", referralCode);
      fetch(apiUrl("/api/ref/track-click"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: referralCode })
      }).catch(() => {});
    }
    navigate("/signup", { replace: true });
  }, [code, navigate]);

  return (
    <section className="card">
      <p className="answer">Taking you to sign up…</p>
    </section>
  );
}

function ReferralLeaderboardScreen({ session }) {
  const [rows, setRows] = useState([]);
  const [proGateLoading, setProGateLoading] = useState(true);
  const [canEarnCommissions, setCanEarnCommissions] = useState(false);

  useEffect(() => {
    const parseLeaderboardPayload = (raw) => {
      if (!raw || typeof raw !== "string") return [];
      const trimmed = raw.trim();
      if (!trimmed.startsWith("{")) return [];
      try {
        const d = JSON.parse(trimmed);
        return Array.isArray(d.rows) ? d.rows : [];
      } catch {
        return [];
      }
    };

    fetch(apiUrl("/api/referrals/leaderboard"))
      .then(async (res) => {
        const text = await res.text();
        setRows(parseLeaderboardPayload(text));
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkProStatus = async () => {
      if (!supabase || !session?.user?.id) {
        if (!cancelled) {
          setCanEarnCommissions(false);
          setProGateLoading(false);
        }
        return;
      }
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_pro")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!cancelled) {
          setCanEarnCommissions(Boolean(profile?.is_pro));
          setProGateLoading(false);
        }
      } catch {
        if (!cancelled) {
          setCanEarnCommissions(false);
          setProGateLoading(false);
        }
      }
    };
    checkProStatus();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  return (
    <section className="card premium leaderboard-card referrals-page-safe">
      <div className="leaderboard-head">
        <h1 className="leaderboard-title">🏅 Referral leaderboard</h1>
      </div>
      <p className="muted">Ranked by total affiliate earnings, then paying referrals.</p>
      {proGateLoading ? (
        <p className="meta">Checking Pro status…</p>
      ) : canEarnCommissions ? (
        <p className="answer">You are Pro — referral commissions are enabled.</p>
      ) : (
        <p className="error">Only Pro users can earn referral commissions. Upgrade to Pro to unlock affiliate earnings.</p>
      )}
      <div className="leader-list">
        {rows.length ? (
          rows.map((r, i) => (
            <article key={r.referrer_id} className="history-item rank-line">
              <p className="rank-num">#{i + 1}</p>
              <div className="podium-avatar small">{(r.username || "U").slice(0, 2).toUpperCase()}</div>
              <div className="referral-lb-main">
                <p>{r.username || "Creator"}</p>
                <p className="meta">
                  Paying subscribers: {r.paying_users} · Signups: {r.signups} · Earned: £
                  {((r.total_commission_pence || 0) / 100).toFixed(2)}
                </p>
              </div>
            </article>
          ))
        ) : (
          <p className="meta">No referral data yet — share your link and appear here.</p>
        )}
      </div>
      <Link to="/affiliates" className="ghost-btn">
        How the affiliate program works
      </Link>
    </section>
  );
}

function AffiliatesPage() {
  const { formatMonth, formatYear } = useCommerceCurrency();
  const navigate = useNavigate();
  const [linkLoading, setLinkLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [refLink, setRefLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [connectStatus, setConnectStatus] = useState({ connected: false, onboarded: false });
  /** `null` = loading; `"anon"` = not signed in */
  const [affiliateGate, setAffiliateGate] = useState(null);
  const shareText = refLink
    ? `I’m using Decide For Me and earning recurring affiliate income. Join with my link: ${refLink}`
    : "I’m using Decide For Me. Join me at decideforme.org";
  const shareLinks = shareUrls(shareText);

  const fetchConnectStatus = async (accessToken) => {
    console.log("[AffiliatesPage] /api/affiliate/connect/status token present:", Boolean(accessToken), "len:", accessToken?.length || 0);
    if (!accessToken) return;
    try {
      const statusRes = await fetch(apiUrl("/api/affiliate/connect/status"), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const statusJson = await statusRes.json();
      if (statusRes.ok) {
        setConnectStatus({ connected: Boolean(statusJson.connected), onboarded: Boolean(statusJson.onboarded) });
      } else {
        setConnectStatus({ connected: false, onboarded: false });
      }
    } catch {
      setConnectStatus({ connected: false, onboarded: false });
    }
  };

  const ensureReferralLink = async () => {
    if (!supabase) {
      setLinkError("Sign in is unavailable right now.");
      return;
    }
    setLinkLoading(true);
    setLinkError("");
    try {
      const {
        data: { session: authSession }
      } = await supabase.auth.getSession();
      const user = authSession?.user || null;
      const accessToken = authSession?.access_token || "";
      if (!user) {
        navigate("/login", { replace: false });
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, username, referral_code, public_ref_slug, is_pro")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.is_pro) {
        setLinkError("Upgrade to Pro to unlock referral earnings.");
        setLinkLoading(false);
        return;
      }

      const username =
        profile?.username ||
        user.email?.split("@")[0] ||
        (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.split(/\s+/)[0] : null) ||
        "user";

      let referralCode = String(profile?.referral_code || "").trim().toLowerCase();
      let publicRefSlug = String(profile?.public_ref_slug || "").trim().toLowerCase();
      const updates = {};

      if (!referralCode) {
        referralCode = await reserveRandomReferralCode(user.id);
        updates.referral_code = referralCode;
      }
      if (!publicRefSlug) {
        publicRefSlug = await generateUniquePublicRefSlug(supabase, username);
        updates.public_ref_slug = publicRefSlug;
      }
      if (Object.keys(updates).length) {
        await supabase.from("profiles").upsert({ id: user.id, ...updates }, { onConflict: "id" });
      }
      await supabase.from("referrals").update({ referral_code: referralCode }).eq("referrer_id", user.id);

      setRefLink(`https://decideforme.org/ref/${referralCode}`);
      await fetchConnectStatus(accessToken);
    } catch (err) {
      setLinkError(err?.message || "Could not generate your referral link.");
    } finally {
      setLinkLoading(false);
    }
  };

  const copyRefLink = async () => {
    if (!refLink) return;
    await copyText(refLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const startConnectOnboarding = async () => {
    if (!supabase) return;
    setConnectLoading(true);
    setLinkError("");
    try {
      const {
        data: { session: authSession }
      } = await supabase.auth.getSession();
      const accessToken = authSession?.access_token || "";
      if (!accessToken) {
        navigate("/login", { replace: false });
        return;
      }
      const res = await fetch(apiUrl("/api/affiliate/connect"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start Stripe Connect.");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setLinkError(err?.message || "Could not start Stripe Connect.");
    } finally {
      setConnectLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      const {
        data: { session: authSession }
      } = await supabase.auth.getSession();
      const user = authSession?.user || null;
      const accessToken = authSession?.access_token || "";
      if (!user) {
        if (!cancelled) setAffiliateGate("anon");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("referral_code, is_pro")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setAffiliateGate(profile?.is_pro ? "pro" : "free");
      if (!profile?.is_pro) {
        if (!cancelled) setRefLink("");
        if (!cancelled && accessToken) await fetchConnectStatus(accessToken);
        return;
      }
      const { data: refRows } = await supabase
        .from("referrals")
        .select("referral_code")
        .eq("referrer_id", user.id)
        .not("referral_code", "is", null)
        .limit(1);
      const tableCode = String(refRows?.[0]?.referral_code || "").trim().toLowerCase();
      const code = tableCode || String(profile?.referral_code || "").trim().toLowerCase();
      if (!cancelled && code) {
        setRefLink(`https://decideforme.org/ref/${code}`);
      }
      if (!cancelled) {
        await fetchConnectStatus(accessToken);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card premium seo-landing affiliates-program-content">
      <div className="affiliates-program-scroll">
        <p className="hero-kicker">Partners</p>
        <h1 className="seo-landing-title">50% recurring commission — earn while you sleep</h1>
        <p className="affiliates-lede">
          Share your link. Earn 50% of every Pro subscription — forever.
        </p>
        <div className="affiliates-feature-grid">
          <article className="affiliates-feature-card">
            <span className="affiliates-feature-icon" aria-hidden="true">
              <BadgePercent size={18} />
            </span>
            <h3>50% commission</h3>
            <p>Earn half of every Pro subscription payment from your referrals.</p>
          </article>
          <article className="affiliates-feature-card">
            <span className="affiliates-feature-icon" aria-hidden="true">
              <Clock size={18} />
            </span>
            <h3>Monthly payouts</h3>
            <p>Payouts are sent to your Stripe Connect account each month.</p>
          </article>
          <article className="affiliates-feature-card">
            <span className="affiliates-feature-icon" aria-hidden="true">
              <BarChart2 size={18} />
            </span>
            <h3>Real-time tracking</h3>
            <p>See clicks, signups, paying users, and earnings live in your dashboard.</p>
          </article>
        </div>
        {affiliateGate === null ? (
          <p className="meta">Checking your account…</p>
        ) : affiliateGate === "anon" ? (
          <div className="history-item">
            <p className="answer">
              <Link to="/login">Sign in</Link> to manage your referral link and payouts.
            </p>
          </div>
        ) : affiliateGate === "pro" ? (
          <>
            <div className="history-item affiliates-link-card">
              <p className="meta">Your referral link</p>
              <p className={`${refLink ? "answer" : "affiliates-link-placeholder"} referral-link-break`}>
                {refLink || "Generate your personal link to start earning commissions."}
              </p>
              <div className="affiliates-link-actions">
                <button type="button" className="primary-btn" onClick={copyRefLink} disabled={!refLink}>
                  {copied ? "Copied!" : "Copy link"}
                </button>
                <button type="button" className="ghost-btn" onClick={ensureReferralLink} disabled={linkLoading}>
                  {linkLoading ? "Refreshing…" : refLink ? "Refresh link" : "Generate link"}
                </button>
              </div>
            </div>
            <div className="seo-landing-cta-row">
              <button type="button" className="primary-btn seo-landing-cta" onClick={ensureReferralLink} disabled={linkLoading}>
                {linkLoading ? "Checking account…" : "Refresh referral link"}
              </button>
              <Link to="/referrals" className="ghost-btn seo-landing-secondary">
                View leaderboard
              </Link>
            </div>
            <div className="history-item affiliates-share-card">
              <p className="meta">Share your link</p>
              <div className="affiliates-share-actions" role="group" aria-label="Share referral link">
                <a className="ghost-btn affiliates-share-btn" href={shareLinks.whatsapp} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
                <a className="ghost-btn affiliates-share-btn" href={shareLinks.x} target="_blank" rel="noreferrer">
                  X
                </a>
                <button type="button" className="ghost-btn affiliates-share-btn" onClick={copyRefLink} disabled={!refLink}>
                  Copy link
                </button>
              </div>
            </div>
            <div className="history-item">
              {connectStatus.onboarded ? (
                <p className="answer">✅ Bank account connected</p>
              ) : (
                <button type="button" className="ghost-btn" onClick={startConnectOnboarding} disabled={connectLoading}>
                  {connectLoading ? "Opening Stripe…" : "Connect bank account to receive payouts"}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="history-item">
            <p className="answer">Upgrade to Pro to unlock referral earnings.</p>
            <p className="muted">
              <Link to="/plans">View Pro plans</Link>
            </p>
          </div>
        )}
        {linkError ? <p className="error">{linkError}</p> : null}
      </div>
    </section>
  );
}

function ProfileScreen({ session }) {
  const navigate = useNavigate();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [referralCodeFromReferrals, setReferralCodeFromReferrals] = useState("");
  const [referralDash, setReferralDash] = useState(EMPTY_REFERRAL_DASH);
  const [referralDashError, setReferralDashError] = useState("");
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectStatus, setConnectStatus] = useState({ connected: false, onboarded: false });

  const loadProfile = async () => {
    if (!supabase || !session?.user?.id) return;
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    let normalizedProfile = profileData;
    const existingCode = String(profileData?.referral_code || "").trim().toLowerCase();
    if (profileData?.is_pro && !existingCode) {
      const generatedCode = await reserveRandomReferralCode(session.user.id);
      const { data: updated } = await supabase
        .from("profiles")
        .update({ referral_code: generatedCode })
        .eq("id", session.user.id)
        .select("*")
        .single();
      if (updated) normalizedProfile = updated;
      await supabase.from("referrals").update({ referral_code: generatedCode }).eq("referrer_id", session.user.id);
    }
    setProfile(normalizedProfile);
    const { data: refData } = await supabase
      .from("referrals")
      .select("*")
      .eq("referrer_id", session.user.id);
    setReferrals(refData ?? []);
    const tableCode = String((refData || []).find((row) => row?.referral_code)?.referral_code || "").trim().toLowerCase();
    if (tableCode) setReferralCodeFromReferrals(tableCode);

    try {
      const {
        data: { session: authSession }
      } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      if (!token) {
        setReferralDash(EMPTY_REFERRAL_DASH);
        setReferralDashError("Missing auth token for referral dashboard.");
      } else {
        console.log("[ProfileScreen] /api/referrals/dashboard token present:", Boolean(token), "len:", token?.length || 0);
        const dashRes = await fetch(apiUrl("/api/referrals/dashboard"), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const dashJson = await dashRes.json();
        if (dashRes.ok) {
          setReferralDash({
            clicks: Number(dashJson.clicks || 0),
            signups: Number(dashJson.signups || 0),
            paying_users: Number(dashJson.paying_users || 0),
            total_earnings_pence: Number(dashJson.total_earnings_pence || 0)
          });
          setReferralDashError("");
        } else {
          setReferralDash(EMPTY_REFERRAL_DASH);
          const msg = String(dashJson.error || "").trim();
          if (msg && !/database not configured/i.test(msg)) {
            setReferralDashError("Could not load referral stats.");
          } else {
            setReferralDashError("");
          }
        }
      }
    } catch {
      setReferralDash(EMPTY_REFERRAL_DASH);
      setReferralDashError("Could not load referral stats.");
    }

    try {
      const {
        data: { session: statusSession }
      } = await supabase.auth.getSession();
      const statusToken = statusSession?.access_token;
      console.log(
        "[ProfileScreen] /api/affiliate/connect/status token present:",
        Boolean(statusToken),
        "len:",
        statusToken?.length || 0
      );
      const statusRes = await fetch(apiUrl("/api/affiliate/connect/status"), {
        headers: { Authorization: `Bearer ${statusToken || ""}` }
      });
      const statusJson = await statusRes.json();
      if (statusRes.ok) {
        setConnectStatus({ connected: Boolean(statusJson.connected), onboarded: Boolean(statusJson.onboarded) });
      } else {
        setConnectStatus({ connected: false, onboarded: false });
      }
    } catch {
      setConnectStatus({ connected: false, onboarded: false });
    }
  };

  useEffect(() => {
    loadProfile();
  }, [session?.user?.id, session?.access_token]);

  useEffect(() => {
    if (!whatsNewOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setWhatsNewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [whatsNewOpen]);

  const startConnectOnboarding = async () => {
    if (!session?.access_token) return;
    setConnectLoading(true);
    try {
      const res = await fetch(apiUrl("/api/affiliate/connect"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start Stripe Connect.");
      if (data.url) window.location.href = data.url;
    } catch (e) {
      console.error(e);
    } finally {
      setConnectLoading(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isProReferrer = Boolean(profile?.is_pro);
  const canonicalCode = isProReferrer
    ? referralCodeFromReferrals || String(profile?.referral_code || "").trim().toLowerCase()
    : "";
  const prettyRefLink = canonicalCode && origin ? `${origin}/ref/${canonicalCode}` : "";

  const handleLogout = async () => {
    if (!supabase) {
      navigate("/", { replace: true });
      return;
    }
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const profileRank = useMemo(() => getDecisionRank(profile?.total_decisions ?? 0), [profile?.total_decisions]);
  const lifetimeDecisions = profile?.total_decisions ?? 0;

  if (!session) return <Navigate to="/login" replace />;

  return (
    <section className="card profile-screen-card">
      <h1>Profile</h1>
      <div className="profile-support-links">
        <button type="button" className="ghost-btn profile-whats-new-btn" onClick={() => setWhatsNewOpen(true)}>
          What&apos;s new
        </button>
        <a className="profile-contact-support" href="mailto:support@decideforme.org">
          Contact support
        </a>
      </div>
      <nav className="profile-legal-links" aria-label="Legal">
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/cookies">Cookie Policy</Link>
      </nav>
      <article className={`prestige-rank-card prestige-rank-card--${profileRank.tier}`}>
        <div className="prestige-rank-card-bg" aria-hidden="true" />
        <div className="prestige-rank-main">
          <div className={`prestige-rank-emblem prestige-rank-emblem--${profileRank.tier}`}>
            <span className="prestige-rank-emoji" aria-hidden="true">
              {profileRank.emoji}
            </span>
          </div>
          <div className="prestige-rank-text">
            <p className="prestige-rank-kicker">Combat record</p>
            <h2 className="prestige-rank-title">{profileRank.label}</h2>
            <p className="prestige-rank-meta">
              <strong>{lifetimeDecisions}</strong> lifetime decisions
              <span className="prestige-rank-dot"> · </span>
              {profileRank.rangeLabel}
            </p>
          </div>
        </div>
        <div
          className="prestige-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(profileRank.progress * 100)}
          aria-label={`Progress toward ${profileRank.nextRankLabel}`}
        >
          <div className="prestige-progress-fill" style={{ width: `${Math.min(100, profileRank.progress * 100)}%` }} />
        </div>
        <p className="prestige-next-line">
          {profileRank.toNext > 0 ? (
            <>
              <span className="prestige-next-num">{profileRank.toNext}</span> more{" "}
              {profileRank.toNext === 1 ? "decision" : "decisions"} to reach <strong>{profileRank.nextRankLabel}</strong>
            </>
          ) : (
            <span className="prestige-next-maxed">At the top of this tier — one more decision can advance your rank.</span>
          )}
        </p>
      </article>
      <p className="meta">{session.user.email}</p>
      <button type="button" className="ghost-btn" onClick={handleLogout}>
        Log out
      </button>
      <p>Total decisions: {profile?.total_decisions || 0}</p>
      <p className="answer">🔥 Streak: {profile?.current_streak || 0} days</p>
      <p className="meta">Longest streak: {profile?.longest_streak || 0} days</p>

      <article className="history-item referral-dashboard-card">
        <p className="hero-kicker">Referrals &amp; affiliates</p>
        <p className="muted">
          Earn <strong>50%</strong> recurring on Pro subscriptions from your referrals.{" "}
          <Link to="/affiliates">Program details</Link> · <Link to="/referrals">Leaderboard</Link>
        </p>
        {isProReferrer ? (
          <>
            {prettyRefLink ? (
              <>
                <p className="muted">Your share link</p>
                <p className="answer referral-link-break">{prettyRefLink}</p>
                <SharePanel text={prettyRefLink} />
              </>
            ) : (
              <p className="meta">Generating your link… refresh if this persists.</p>
            )}
            <div className="referral-dash-grid">
              <div>
                <p className="meta">Link clicks</p>
                <p className="answer">{referralDash.clicks}</p>
              </div>
              <div>
                <p className="meta">Signups</p>
                <p className="answer">{referralDash.signups}</p>
              </div>
              <div>
                <p className="meta">Paying users</p>
                <p className="answer">{referralDash.paying_users}</p>
              </div>
              <div>
                <p className="meta">Total earnings</p>
                <p className="answer">
                  £{((referralDash.total_earnings_pence || 0) / 100).toFixed(2)}
                </p>
              </div>
            </div>
            {referralDashError ? <p className="meta">{referralDashError} Showing zeros.</p> : null}
            {connectStatus.onboarded ? (
              <p className="answer">✅ Bank account connected</p>
            ) : (
              <button type="button" className="ghost-btn" disabled={connectLoading} onClick={startConnectOnboarding}>
                {connectLoading ? "Opening Stripe…" : "Connect bank account to receive payouts"}
              </button>
            )}
            <p className="muted small-print">
              Connect once so we can pay your commission. Requires a Stripe Express account.
            </p>
          </>
        ) : (
          <p className="answer">
            Upgrade to Pro to unlock referral earnings.{" "}
            <Link to="/plans">View Pro plans</Link>
          </p>
        )}
      </article>

      <p className="muted">Referrals recorded: {referrals.length}</p>

      {whatsNewOpen ? (
        <div className="whats-new-overlay" role="presentation" onClick={() => setWhatsNewOpen(false)}>
          <div
            className="whats-new-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="whats-new-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="whats-new-modal-head">
              <h2 id="whats-new-title">What&apos;s new</h2>
              <button type="button" className="ghost-btn whats-new-close" aria-label="Close" onClick={() => setWhatsNewOpen(false)}>
                <X size={20} strokeWidth={2} />
              </button>
            </div>
            <ul className="whats-new-list">
              <li>
                <strong>Life Mode Command Centre</strong>
                <span>Directives, compliance roasts, and a shareable rank card while AI runs your day.</span>
              </li>
              <li>
                <strong>Prestige ranks</strong>
                <span>Progress through tiers from your lifetime decisions — shown on Profile and share cards.</span>
              </li>
              <li>
                <strong>Chat history</strong>
                <span>Revisit recent prompts and answers from the chat toolbar.</span>
              </li>
              <li>
                <strong>Decision Wrapped</strong>
                <span>Stats page snapshot of habits, streaks, and weekly recap lines when it&apos;s recap Monday.</span>
              </li>
              <li>
                <strong>Shareable cards</strong>
                <span>Export PNGs for Daily Dilemma, leaderboard, Wrapped, Life Mode, Decision Profile, and chat.</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function ensureProfileAndReferral(user) {
  if (!supabase || !user?.id) return;
  const username =
    user.email?.split("@")[0] ||
    (typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.split(/\s+/)[0]
      : null) ||
    (typeof user.user_metadata?.name === "string" ? user.user_metadata.name.split(/\s+/)[0] : null) ||
    "user";

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, public_ref_slug, referral_code, is_pro")
    .eq("id", user.id)
    .maybeSingle();
  if (!existing) {
    const publicRefSlug = await generateUniquePublicRefSlug(supabase, username);
    await supabase.from("profiles").insert({
      id: user.id,
      username,
      public_ref_slug: publicRefSlug
    });
  } else if (!existing.public_ref_slug) {
    const publicRefSlug = await generateUniquePublicRefSlug(supabase, username);
    await supabase.from("profiles").update({ public_ref_slug: publicRefSlug }).eq("id", user.id);
  }

  const pendingSlug = localStorage.getItem("pending_ref_slug");
  const pendingCodeRaw = localStorage.getItem("pending_referral_code");
  const pendingCode = pendingCodeRaw ? String(pendingCodeRaw).trim().toLowerCase() : "";

  let referrerId = null;
  let attributionLabel = "";
  if (pendingSlug) {
    const normalized = String(pendingSlug).trim().toLowerCase();
    attributionLabel = normalized;
    const { data: bySlug } = await supabase
      .from("profiles")
      .select("id")
      .eq("public_ref_slug", normalized)
      .maybeSingle();
    if (bySlug?.id && bySlug.id !== user.id) referrerId = bySlug.id;
    localStorage.removeItem("pending_ref_slug");
  }
  if (!referrerId && pendingCode) {
    attributionLabel = pendingCode;
    const { data: byCode } = await supabase.from("profiles").select("id").eq("referral_code", pendingCode).maybeSingle();
    if (byCode?.id && byCode.id !== user.id) referrerId = byCode.id;
    localStorage.removeItem("pending_referral_code");
  }

  if (!referrerId) return;

  const { data: me } = await supabase.from("profiles").select("referred_by").eq("id", user.id).maybeSingle();
  if (me?.referred_by) return;

  await supabase
    .from("profiles")
    .update({
      referred_by: referrerId,
      ...(attributionLabel ? { referred_via_code: attributionLabel.slice(0, 64) } : {})
    })
    .eq("id", user.id);

  await supabase.from("referrals").upsert(
    {
      referrer_id: referrerId,
      referred_id: user.id
    },
    { onConflict: "referred_id" }
  );

  await supabase.rpc("grant_referral_bonus", {
    p_referrer_id: referrerId,
    p_referred_id: user.id
  });
}

function GoogleMark() {
  return (
    <svg className="auth-google-icon" width={20} height={20} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function AuthScreen({ mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const ref = query.get("ref");
    if (ref) localStorage.setItem("pending_referral_code", ref);
  }, [location.search]);

  const signInWithGoogle = async () => {
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setOauthLoading(true);
    setError("");
    const redirectTo = `${window.location.origin}/`;
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" }
      }
    });
    if (oauthError) {
      setError(oauthError.message);
      setOauthLoading(false);
      return;
    }
    if (data?.url) {
      window.location.assign(data.url);
    } else {
      setError("Could not start Google sign-in.");
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    setLoading(true);
    setError("");
    const action =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { data, error: authError } = await action;
    if (authError) setError(authError.message);
    else {
      await ensureProfileAndReferral(data?.user);
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <section className="card auth-card">
      <h1>{mode === "login" ? "Login" : "Sign up"}</h1>
      {mode === "login" ? (
        <p className="meta">
          New here?{" "}
          <Link to="/signup" className="answer">
            Create an account
          </Link>
        </p>
      ) : (
        <p className="meta">
          Already have an account?{" "}
          <Link to="/login" className="answer">
            Login
          </Link>
        </p>
      )}
      {supabase ? (
        <>
          <button
            type="button"
            className="auth-google-btn"
            onClick={signInWithGoogle}
            disabled={oauthLoading || loading}
          >
            <GoogleMark />
            {oauthLoading ? "Redirecting…" : "Continue with Google"}
          </button>
          <p className="auth-divider">
            <span>or</span>
          </p>
        </>
      ) : null}
      <form className="form" onSubmit={handleSubmit}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          minLength={6}
          required
        />
        <button className="primary-btn" disabled={loading || oauthLoading}>
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function PlansScreen({ session }) {
  const { currency, formatMonth, formatYear } = useCommerceCurrency();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startCheckout = async (plan) => {
    const accessToken = await resolveAccessToken(session?.access_token);
    if (!accessToken) {
      setError("Sign in to subscribe.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const url = await fetchStripeCheckoutSessionUrl(accessToken, { plan, currency });
      goToStripeCheckout(url, {
        onStuck: () => {
          setLoading(false);
          setError(
            "Stripe Checkout did not open in this tab. Allow redirects to checkout.stripe.com, or try another browser."
          );
        }
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Stripe checkout failed.";
      setError(message);
      setLoading(false);
    }
  };

  return (
    <section className="card plans-pro-screen">
      <article className="plans-life-hero">
        <p className="hero-kicker">Headline feature</p>
        <h1>Life Mode Command Centre</h1>
        <p className="muted plans-life-lead">
          Drill-sergeant directives, timed orders that rotate through the day, weather-aware discipline, compliance scoring,
          streaks, optional speech, night wind-down protocol, and share-ready mission reports — included with Pro.
        </p>
      </article>
      <h2 className="plans-upgrade-heading">Upgrade to Pro</h2>
      <p className="muted">3-day free trial, then monthly or yearly billing. Cancel anytime.</p>
      <div className="plans-grid plans-grid--two">
        <article className="plan-card">
          <h3>Pro · Monthly</h3>
          <p className="plan-price">
            {formatMonth()}
            <span className="plan-period">/month</span>
          </p>
          <p className="muted">Unlimited decisions and full Life Mode access.</p>
          <button className="primary-btn" onClick={() => startCheckout("month")} disabled={loading}>
            {loading ? "Redirecting…" : `Subscribe · ${formatMonth()}/mo`}
          </button>
        </article>
        <article className="plan-card plan-card--highlight">
          <h3>Pro · Yearly</h3>
          <p className="plan-price">
            {formatYear()}
            <span className="plan-period">/year</span>
          </p>
          <p className="muted">Best value — save vs paying monthly.</p>
          <button className="primary-btn" onClick={() => startCheckout("year")} disabled={loading}>
            {loading ? "Redirecting…" : `Subscribe · ${formatYear()}/yr`}
          </button>
        </article>
      </div>
      {!session?.access_token ? (
        <p className="meta">
          <Link to="/login">Sign in</Link> to start checkout.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || !supabase) return;
    const token = session.access_token;
    let cancelled = false;
    (async () => {
      await ensureProfileAndReferral(session.user);
      if (cancelled || !token) return;
      try {
        await fetch(apiUrl("/api/emails/welcome"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session?.access_token]);

  useEffect(() => {
    if (!session?.access_token || !supabase) return undefined;
    let cancelled = false;
    let code = "";
    try {
      code = localStorage.getItem(DFM_INVITE_STORAGE_KEY) || "";
    } catch {
      return undefined;
    }
    const trimmed = code.trim().toLowerCase();
    if (!trimmed || !/^[a-z0-9]{6,16}$/.test(trimmed)) return undefined;

    (async () => {
      try {
        const res = await fetch(apiUrl("/api/invite/redeem"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ code: trimmed })
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !data?.ok) return;
        try {
          localStorage.removeItem(DFM_INVITE_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      } catch {
        /* network — retry on next mount */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <CommerceCurrencyProvider>
      <Layout session={session} onSignOut={signOut}>
        {!isSupabaseConfigured ? (
          <section className="card">
            <h1>Setup required</h1>
            <p className="error">Set Supabase env values in `.env` and refresh.</p>
          </section>
        ) : null}
        <Routes>
          {SEO_LANDING_ROUTES.map((cfg) => (
            <Route key={cfg.path} path={cfg.path} element={<SeoLandingPage config={cfg} />} />
          ))}
          <Route path="/" element={<ChatScreen session={session} />} />
          <Route path="/explore" element={<ExploreScreen session={session} />} />
          <Route
            path="/stats"
            element={
              <ProtectedRoute session={session}>
                <StatsScreen session={session} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute session={session}>
                <HistoryScreen session={session} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/momentum"
            element={
              <ProtectedRoute session={session}>
                <MomentumScreen session={session} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/decision-profile"
            element={
              <ProtectedRoute session={session}>
                <DecisionProfileScreen session={session} />
              </ProtectedRoute>
            }
          />
          <Route path="/group" element={<GroupCreateScreen session={session} />} />
          <Route path="/group/:shareCode" element={<GroupRoomScreen session={session} />} />
          <Route path="/leaderboard" element={<LeaderboardScreen session={session} />} />
          <Route path="/referrals" element={<ReferralLeaderboardScreen session={session} />} />
          <Route path="/affiliates" element={<AffiliatesPage />} />
          <Route path="/ref/:username" element={<RefLandingCapture />} />
          <Route path="/profile" element={<ProfileScreen session={session} />} />
          <Route path="/plans" element={<PlansScreen session={session} />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/cookies" element={<CookiePolicyPage />} />
          <Route path="/invite/:code" element={<InfluencerInviteLanding />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/login" element={<AuthScreen mode="login" />} />
          <Route path="/signup" element={<AuthScreen mode="signup" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </CommerceCurrencyProvider>
  );
}
