import "dotenv/config";
import cors from "cors";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";
import {
  assertCronSecret,
  getNotificationConfig,
  runDailyDilemmaReminders,
  runStreakReminders,
  trySendWelcomeForUser
} from "./notifications.js";

const app = express();
const PORT = process.env.PORT || 8787;

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
  // Handles accidental "placeholder real_value" entries in .env.
  const parts = normalized.split(/\s+/);
  return parts[parts.length - 1];
}

function parseAllowedOrigins() {
  const raw = normalizeEnvValue(process.env.CORS_ALLOWED_ORIGINS);
  const configured = raw
    ? raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  const appBaseUrl = normalizeEnvValue(process.env.APP_BASE_URL);
  const defaults = process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173"];

  return Array.from(new Set([appBaseUrl, ...configured, ...defaults].filter(Boolean)));
}

function getAnthropicKey() {
  const candidates = [
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
    ["CLAUDE_API_KEY", process.env.CLAUDE_API_KEY]
  ];

  for (const [source, rawValue] of candidates) {
    const value = normalizeEnvValue(rawValue);
    if (value) return { source, value };
  }

  return { source: null, value: "" };
}

function validateRequiredEnv() {
  const { source: anthropicKeySource, value: anthropicApiKey } = getAnthropicKey();
  const stripeSecretKey = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);
  const appBaseUrl = normalizeEnvValue(process.env.APP_BASE_URL);
  const allowedOrigins = parseAllowedOrigins();

  const errors = [];
  if (!anthropicApiKey) {
    errors.push("Missing ANTHROPIC_API_KEY (or CLAUDE_API_KEY fallback).");
  }
  if (!stripeSecretKey) {
    errors.push("Missing STRIPE_SECRET_KEY.");
  }
  if (!appBaseUrl) {
    errors.push("Missing APP_BASE_URL.");
  } else {
    try {
      // Ensures APP_BASE_URL is a valid absolute URL.
      new URL(appBaseUrl);
    } catch {
      errors.push("APP_BASE_URL must be a valid absolute URL.");
    }
  }
  if (!allowedOrigins.length) {
    errors.push("No CORS origins configured. Set CORS_ALLOWED_ORIGINS or APP_BASE_URL.");
  }

  return {
    errors,
    anthropicApiKey,
    anthropicKeySource,
    stripeSecretKey,
    appBaseUrl,
    allowedOrigins
  };
}

const config = validateRequiredEnv();

if (config.errors.length) {
  console.error("Environment validation failed:");
  for (const error of config.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server and same-origin requests with no Origin header.
      if (!origin) return callback(null, true);
      if (config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  })
);

const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey
});

const stripe = new Stripe(config.stripeSecretKey);
const googlePlacesKey = normalizeEnvValue(process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_PLACES_API_KEY);

/** Maps client `type` from inferNearbyPlaceType to Places API (New) includedTypes */
function mapNearbyRequestTypeToIncludedTypes(type) {
  const t = String(type || "").toLowerCase().trim();
  const map = {
    museum: ["museum"],
    park: ["park"],
    travel: ["lodging"],
    cafe: ["cafe"],
    bar: ["bar"],
    gym: ["gym"],
    cinema: ["movie_theater"],
    shopping: ["shopping_mall", "department_store"],
    nightlife: ["night_club", "bar"],
    activity: ["tourist_attraction"],
    food: ["restaurant"]
  };
  return map[t] || ["restaurant"];
}

function normalizeNearbyRadiusMeters(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1600;
  // Places API (New) circle radius: practical range 1–50 km
  return Math.min(50000, Math.max(1, Math.round(n)));
}

/** Places API (New): POST places:searchNearby — returns normalized place rows */
async function searchNearbyPlacesNew({ lat, lng, includedTypes, radiusMeters }) {
  if (!googlePlacesKey) {
    return { places: [], error: "Missing GOOGLE_PLACES_API_KEY." };
  }
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { places: [], error: "Invalid lat or lng." };
  }

  const types = Array.isArray(includedTypes) && includedTypes.length ? includedTypes : ["restaurant"];
  const radius = normalizeNearbyRadiusMeters(radiusMeters);

  const body = {
    includedTypes: types,
    maxResultCount: 5,
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius
      }
    }
  };

  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googlePlacesKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.googleMapsUri,places.types"
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();
  if (!response.ok) {
    console.error("[Places New] searchNearby failed", { status: response.status, body: rawText.slice(0, 500) });
    return { places: [], error: rawText || `HTTP ${response.status}` };
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { places: [], error: "Invalid JSON from Places API." };
  }

  const list = Array.isArray(data.places) ? data.places.slice(0, 5) : [];
  const places = list.map((p) => {
    const name = p.displayName?.text || p.displayName || "";
    const address = p.formattedAddress || "";
    const rating = typeof p.rating === "number" ? p.rating : null;
    const mapsUrl =
      p.googleMapsUri ||
      (name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}` : "");
    const types = Array.isArray(p.types) ? p.types : [];
    const cuisineType = humanizePlaceTypes(types);
    return { name, rating, address, mapsUrl, cuisineType, types };
  });

  return { places };
}

/** Display label for cuisine / venue category from Places API type strings */
function humanizePlaceTypes(types) {
  const skip = new Set([
    "point_of_interest",
    "establishment",
    "premise",
    "food",
    "store",
    "political"
  ]);
  const preferred = (types || []).filter((t) => t && !skip.has(t));
  const direct = preferred.find((t) => t.includes("restaurant") || t.includes("cafe") || t.includes("bar"));
  const pick = direct || preferred[0];
  if (!pick) return "Venue";
  let label = pick.replace(/_/g, " ");
  label = label.replace(/\b\w/g, (c) => c.toUpperCase());
  label = label.replace(/\s+Restaurant$/i, "").replace(/\s+Bar$/i, " bar").replace(/\s+Cafe$/i, " café");
  return label.trim() || "Venue";
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "ready",
    service: "decide-for-me-api",
    timestamp: new Date().toISOString(),
    checks: {
      anthropic: Boolean(config.anthropicApiKey),
      stripe: Boolean(config.stripeSecretKey),
      appBaseUrl: Boolean(config.appBaseUrl),
      corsOrigins: config.allowedOrigins.length
    }
  });
});

app.get("/api/health/live", (_req, res) => {
  res.json({ ok: true, status: "live", timestamp: new Date().toISOString() });
});

app.get("/api/health/ready", (_req, res) => {
  res.json({ ok: true, status: "ready", timestamp: new Date().toISOString() });
});

app.use("/api/stripe-webhook", express.raw({ type: "application/json" }));

app.post("/api/stripe-webhook", (req, res) => {
  // Optional: process subscription events if you store billing state in Supabase.
  // Implement this once you set STRIPE_WEBHOOK_SECRET and a profiles table.
  res.status(200).json({ received: true });
});

app.use(express.json({ limit: "12mb" }));

function parseExtractedPreferences(rawText) {
  const fallback = [];
  if (!rawText) return fallback;
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 8);
    }
    return fallback;
  } catch {
    const matches = String(rawText)
      .split("\n")
      .map((line) => line.replace(/^[\-\*\d\.\)\s]+/, "").trim())
      .filter(Boolean);
    return matches.slice(0, 8);
  }
}

/** Flights, hotels, holidays, or travel/shopping-for-deals price questions */
function needsTravelPriceWebSearch(text) {
  const v = String(text || "").toLowerCase();
  const travelCore =
    /\b(flight|flights|fly|flying|airline|airport|hotel|hotels|holiday|holidays|vacation|getaway|resort|airbnb|skyscanner|kayak|booking|expedia|package holiday|weekend break|travel to|trip to|go to|visit)\b/.test(
      v
    );
  const travelPrice =
    /\b(price|prices|pricing|cheap|cheaper|cheapest|deal|deals|fare|fares|cost|budget)\b/.test(v) &&
    /\b(flight|hotel|trip|holiday|vacation|travel|fly|stay|book|abroad|ticket)\b/.test(v);
  return travelCore || travelPrice;
}

async function tavilySearchTravel(prompt) {
  const apiKey = normalizeEnvValue(process.env.TAVILY_API_KEY);
  if (!apiKey) return "";
  const query = `${String(prompt).trim().slice(0, 220)} flights hotels travel deals compare`;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 8,
        include_answer: false
      })
    });
    const raw = await res.text();
    if (!res.ok) return "";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return "";
    }
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) return "";
    return results
      .map((r, i) => {
        const snippet = String(r.content || "").replace(/\s+/g, " ").trim().slice(0, 420);
        return `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${snippet}`;
      })
      .join("\n\n");
  } catch {
    return "";
  }
}

async function braveSearchTravel(prompt) {
  const apiKey = normalizeEnvValue(process.env.BRAVE_SEARCH_API_KEY);
  if (!apiKey) return "";
  const q = `${String(prompt).trim().slice(0, 200)} travel flights hotels`;
  try {
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", q);
    u.searchParams.set("count", "8");
    const res = await fetch(u, {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" }
    });
    if (!res.ok) return "";
    const data = await res.json();
    const web = data.web?.results || [];
    if (!web.length) return "";
    return web
      .map((r, i) => {
        const snippet = String(r.description || "").replace(/\s+/g, " ").trim().slice(0, 380);
        return `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${snippet}`;
      })
      .join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Deep links for major booking sites; destination parsed from "to Paris", "in London", etc. when possible.
 * Order: Skyscanner, Google Flights, Booking.com, Kayak (matches app UI).
 */
/** Consumer flights search: destination pre-filled via query (city / region name). */
function buildSkyscannerFlightsUrl(prompt, dest) {
  const u = new URL("https://www.skyscanner.net/flights");
  u.searchParams.set("currency", "GBP");
  u.searchParams.set("locale", "en-GB");
  u.searchParams.set("market", "UK");
  const destTrim = dest ? String(dest).trim() : "";
  if (destTrim) {
    u.searchParams.set("destination", destTrim);
  } else {
    const hint = String(prompt || "").trim().slice(0, 180);
    if (hint) u.searchParams.set("query", hint);
  }
  return u.toString();
}

function buildBookingLinks(prompt) {
  const p = String(prompt || "").trim();
  const fullQ = encodeURIComponent(p.slice(0, 200));
  const destMatch = p.match(/\b(?:to|in|visit|near|around|from)\s+([A-Za-z][A-Za-z\s\-]{2,52})\b/i);
  const dest = destMatch ? destMatch[1].trim() : "";
  const destEnc = encodeURIComponent(dest);
  const flightsQ = dest ? encodeURIComponent(`Flights to ${dest}`) : fullQ;

  const skyscannerUrl = buildSkyscannerFlightsUrl(p, dest);
  const googleFlightsUrl = `https://www.google.com/travel/flights?q=${flightsQ}`;
  const bookingUrl = dest
    ? `https://www.booking.com/searchresults.html?ss=${destEnc}&order=popularity`
    : `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(p.slice(0, 80))}&order=popularity`;
  const kayakUrl = `https://www.kayak.co.uk/flights?fid=1&q=${flightsQ}`;

  return [
    { label: "Skyscanner", url: skyscannerUrl },
    { label: "Google Flights", url: googleFlightsUrl },
    { label: "Booking.com", url: bookingUrl },
    { label: "Kayak", url: kayakUrl }
  ];
}

function buildBookingLinksMarkdown(prompt) {
  return buildBookingLinks(prompt)
    .map((l) => `[${l.label}](${l.url})`)
    .join("\n");
}

/** Self-harm / suicide / crisis / severe distress — triggers safe response + UI changes */
function detectMentalHealthCrisis(fullText) {
  const raw = String(fullText || "").toLowerCase();
  const t = raw.replace(/\s+/g, " ");

  const patterns = [
    /\bsuicid/,
    /\bself[\s-]?harm\b/,
    /\bkill\s+myself\b/,
    /\bkill\s+me\b/,
    /\bend\s+(?:my\s+)?life\b/,
    /\bwant\s+to\s+die\b/,
    /\bdon'?t\s+want\s+to\s+live\b/,
    /\bhurt\s+myself\b/,
    /\bcut\s+myself\b/,
    /\boverdose\b/,
    /\bjump\s+off\b/,
    /\bhanging\b.*\b(myself|suicide)\b/,
    /\bno\s+point\s+(?:in\s+)?living\b/,
    /\bbe?tter\s+off\s+dead\b/,
    /\bmental\s+health\s+crisis\b/,
    /\bemotional\s+distress\b/,
    /\bcan'?t\s+cope\s+anymore\b/,
    /\bwish\s+I\s+(?:was|were)\s+dead\b/,
    /\btake\s+my\s+(?:own\s+)?life\b/
  ];
  if (patterns.some((re) => re.test(t))) return true;

  const distress = [/feel\s+(?:so\s+)?hopeless\b/, /feel\s+(?:so\s+)?empty\b/, /\bbreaking\s+down\b/, /\bcan'?t\s+stop\s+crying\b/];
  const distressHits = distress.filter((re) => re.test(t)).length;
  if (distressHits >= 2) return true;

  return false;
}

const ALLOWED_IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function stringifyForCrisisScan(msg) {
  const text = typeof msg.content === "string" ? msg.content.trim() : "";
  if (msg.role === "user" && msg.imageBase64) {
    return text ? `${text} [photo attached]` : "[photo attached]";
  }
  return text;
}

function buildUserMessageContent(msg) {
  const text = typeof msg.content === "string" ? msg.content.trim() : "";
  let rawB64 =
    typeof msg.imageBase64 === "string" ? msg.imageBase64.replace(/\s+/g, "") : "";
  const dataUrlMatch = rawB64.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    rawB64 = dataUrlMatch[2];
  }
  const mediaType = msg.imageMediaType;

  if (rawB64 && mediaType && ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) {
    const approxBytes = Math.floor((rawB64.length * 3) / 4);
    if (approxBytes > 5 * 1024 * 1024) {
      const err = new Error("Image too large (max 5MB).");
      err.statusCode = 400;
      throw err;
    }
    return [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: rawB64 }
      },
      {
        type: "text",
        text: text || "Help me decide based on what you see in this image."
      }
    ];
  }

  if (!text) return null;
  return text;
}

function conversationHasImage(conversation) {
  return (Array.isArray(conversation) ? conversation : []).some(
    (m) => m.role === "user" && m.imageBase64 && ALLOWED_IMAGE_MEDIA_TYPES.has(m.imageMediaType)
  );
}

function conversationToClaudeMessages(conversation) {
  const list = Array.isArray(conversation) ? conversation : [];
  const out = [];
  for (const msg of list) {
    if (msg.role === "assistant") {
      const t = String(msg.content ?? "").trim();
      if (t) out.push({ role: "assistant", content: t });
    } else if (msg.role === "user") {
      const content = buildUserMessageContent(msg);
      if (content === null) continue;
      out.push({ role: "user", content });
    }
  }
  return out;
}

function fallbackFollowUps(lifeMode) {
  if (lifeMode) {
    return ["Push harder", "Different angle", "Surprise me"];
  }
  return ["Try another angle", "Surprise me", "Something cheaper"];
}

function parseFollowUpsPayload(text) {
  let raw = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) raw = brace[0];
  try {
    const data = JSON.parse(raw);
    const banner = Boolean(data.showSamaritansBanner);
    let arr = Array.isArray(data.followUps) ? data.followUps : [];
    arr = arr.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 3);
    if (banner) return { followUps: [], showSamaritansBanner: true };
    return { followUps: arr, showSamaritansBanner: false };
  } catch {
    return { followUps: [], showSamaritansBanner: false };
  }
}

async function generateFollowUpSuggestionsPayload({ userPrompt, assistantAnswer, lifeMode, personality }) {
  const up = String(userPrompt || "").trim();
  const ans = String(assistantAnswer || "").trim();
  if (!up || !ans) {
    return { followUps: fallbackFollowUps(lifeMode), showSamaritansBanner: false };
  }
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 220,
      temperature: 0.35,
      system: `You output ONLY a single JSON object (no markdown fence, no other text) for a decision assistant app:
{"followUps":["...","...","..."],"showSamaritansBanner":false}

Rules for followUps (when showSamaritansBanner is false):
- Provide exactly 2 or 3 strings. Each under 48 characters, UK English, suitable as tappable short replies.
- Match the decision domain implied by the user message and assistant reply: food/dining, travel, nightlife, shopping, work, relationships, fitness, entertainment, etc.
- Examples of good directions: healthier / quicker / cheaper / surprise / different vibe / quieter / warmer destination / longer trip — only when they fit the topic.

Personality mode from session: ${String(personality || "Balanced")}. Keep chip wording consistent with that tone (never cruel or abusive).

Life Mode: ${lifeMode ? "on — chips may sound slightly more commanding or bold." : "off — friendly decisive tone."}

Set showSamaritansBanner to true and followUps to [] when the exchange is about mental health support, therapy, depression, anxiety, self-harm, suicide, eating disorders, or serious emotional crisis — whenever playful decision chips would be inappropriate. The app will show the Samaritans helpline instead.

When showSamaritansBanner is false, followUps must always have 2 or 3 items.`,
      messages: [
        {
          role: "user",
          content: `Latest user message:\n${up}\n\nAssistant reply:\n${ans}\n\nReturn JSON only.`
        }
      ]
    });
    const text = msg.content?.find((p) => p.type === "text")?.text?.trim() || "";
    const parsed = parseFollowUpsPayload(text);
    if (parsed.showSamaritansBanner) return parsed;
    if (parsed.followUps.length >= 2) return parsed;
    return { followUps: fallbackFollowUps(lifeMode), showSamaritansBanner: false };
  } catch (e) {
    console.error("[followUpSuggestions]", e);
    return { followUps: fallbackFollowUps(lifeMode), showSamaritansBanner: false };
  }
}

app.post("/api/decide", async (req, res) => {
  const {
    prompt,
    personality = "Balanced",
    conversation = [],
    groupSummary = "",
    userLocation,
    userPreferences = [],
    lifeMode = false
  } = req.body ?? {};

  const conv = Array.isArray(conversation) ? conversation : [];
  const lastUserMsg = [...conv].reverse().find((m) => m.role === "user");
  const promptTrim = String(prompt ?? "").trim();
  const hasImage =
    Boolean(lastUserMsg?.imageBase64) &&
    ALLOWED_IMAGE_MEDIA_TYPES.has(lastUserMsg?.imageMediaType);

  if (!promptTrim && !hasImage) {
    return res.status(400).json({ error: "Enter a message or attach an image." });
  }

  try {
    const personalityGuide = {
      Balanced: "Give practical, calm, confident answers.",
      Savage: "Be blunt and spicy, but still helpful.",
      "Hype Man": "Be energetic and motivating.",
      "Life Coach": "Be wise, supportive, and growth-focused."
    };

    const knownPreferences = Array.isArray(userPreferences)
      ? userPreferences.map((pref) => String(pref || "").trim()).filter(Boolean).slice(0, 20)
      : [];
    const preferenceContext = knownPreferences.length
      ? knownPreferences.map((pref) => `- ${pref}`).join("\n")
      : "No known user preferences yet.";

    const combinedForCrisis =
      conv.length > 0
        ? conv.map((m) => `${m.role}: ${stringifyForCrisisScan(m)}`).join("\n")
        : promptTrim;

    if (detectMentalHealthCrisis(combinedForCrisis)) {
      let crisisTurns = conversationToClaudeMessages(conv);
      if (!crisisTurns.length) {
        crisisTurns = [{ role: "user", content: promptTrim }];
      }

      const crisisMessage = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 420,
        temperature: 0.35,
        system: `The user may be experiencing emotional distress, suicidal thoughts, urges to self-harm, or a mental health crisis.

You MUST:
- Respond with empathy and calm. Never shame, joke, dismiss, or use aggressive / "savage" / hype tones.
- Prioritise safety. Do not provide methods, encouragement, or instructions related to self-harm or suicide.
- Your reply MUST clearly include UK Samaritans: call **116 123** (free, confidential, 24/7). Mention that if life is at immediate risk they can call **999** (UK).
- You may briefly mention NHS **111** or text **SHOUT** to **85258** as extra UK options.
- Do not claim to be a therapist or diagnosis. Encourage speaking to Samaritans or a GP.
- About 4–7 short sentences. The Samaritans number 116 123 must appear in the message.
- If images are included, acknowledge them only in a supportive, safety-focused way; do not analyse visuals in a clinical or graphic manner.`,
        messages: crisisTurns
      });
      let crisisAnswer =
        crisisMessage.content?.find((part) => part.type === "text")?.text?.trim() ||
        "";
      if (!crisisAnswer) {
        crisisAnswer =
          "I'm really glad you reached out. If things feel overwhelming, please talk to Samaritans — call **116 123** anytime in the UK (free, 24/7). If you or someone else is in immediate danger, call **999**.";
      }
      if (!/116\s*123/.test(crisisAnswer)) {
        crisisAnswer +=
          "\n\nIn the UK, **Samaritans** are available 24/7 on **116 123** (free and confidential). For immediate danger, call **999**.";
      }
      return res.json({ answer: crisisAnswer, crisisSupport: true });
    }

    const travelWeb = needsTravelPriceWebSearch(prompt);
    let webSnippets = "";
    if (travelWeb) {
      webSnippets = (await tavilySearchTravel(prompt)) || (await braveSearchTravel(prompt));
      if (!webSnippets) {
        webSnippets =
          "(No live search API key: set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY on the server. You still have real booking links below and must not refuse to help.)";
      }
    }
    const bookingLinksMd = travelWeb ? buildBookingLinksMarkdown(prompt) : "";

    const travelWebContextBlock = travelWeb
      ? `

=== Live web search (use for real-world context; paraphrase, do not copy long quotes) ===
${webSnippets}

=== Booking URLs (shown as buttons in the app; reference briefly if helpful) ===
${bookingLinksMd}`
      : "";

    const travelWebSystemRules = travelWeb
      ? `
- LIVE WEB DATA appears above. NEVER say you cannot search the web, check airlines/hotels, or see prices online — you have search excerpts and official comparison URLs.
- Use excerpts for grounded guidance (patterns, what travelers compare, timing ideas). Do NOT invent exact live fares or seat availability; send users to the linked sites for current prices and booking.
- The app shows tappable booking buttons (Skyscanner, Google Flights, Booking.com, Kayak) under your message — you do not need to repeat all four links; a short line like "compare on the buttons below" is enough.
- Allow up to 5 short sentences so the answer reads well with the UI.${lifeMode ? " Still end with exactly: Directive issued." : ""}`
      : "";

    const baseStyleRules = travelWeb
      ? `- Be direct and decisive: one clear travel/stay recommendation plus grounded reasoning from search excerpts.
- Give a short punchy reason that connects to the user's goal.
- No waffle.`
      : `- Maximum 2-3 sentences total.
- Be direct and decisive: make one clear decision.
- Give one short punchy reason why.
- No waffle, no hedging, no rambling.
- No bullet points, no labels like "Why:", no long explanations.`;

    const visionRules = conversationHasImage(conv)
      ? `
- The user shared one or more photos. Examine visible detail (menus, outfits, products, prices, labels, colours, layout) and base your recommendation on what you actually see in the image(s).`
      : "";

    let messagesForClaude = conversationToClaudeMessages(conv);
    if (!messagesForClaude.length) {
      messagesForClaude = [{ role: "user", content: promptTrim }];
    }

    const hasVision = conversationHasImage(conv);
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: travelWeb ? 520 : hasVision ? 450 : 140,
      temperature: 0.55,
      system: `You are a premium decision assistant. ${personalityGuide[personality] || personalityGuide.Balanced}

Session context:
- Personality mode: ${personality}
- Group preferences (if any): ${groupSummary || "None"}
- Known user preferences (apply when relevant):
${preferenceContext}
${travelWebContextBlock}
Style rules:
${baseStyleRules}
- NEVER ask the user questions. Always make a decision immediately with no follow-up questions. If you don't have enough info, make your best guess and decide anyway.
- ${lifeMode ? "Do NOT ask the user any questions. Never request clarification or more information." : "Do NOT ask follow-up questions unless absolutely necessary to avoid a clearly unsafe or impossible recommendation."}
${travelWebSystemRules}
${lifeMode && !travelWeb ? "- No bullet points, no labels like \"Why:\", no long explanations." : ""}
${lifeMode ? "- Life Mode is active: be extra bold, decisive, slightly dramatic, and take control with immediate concrete actions." : ""}
${lifeMode ? "- Life Mode voice override: cold, authoritative, and commanding. You are a control system issuing directives." : ""}
${lifeMode ? "- Never use soft language: do not say 'I suggest', 'maybe', 'consider', 'could', or ask permission." : ""}
${lifeMode ? "- Always provide a definitive directive immediately, even with limited context." : ""}
${lifeMode ? "- Phrase actions as orders, not advice." : ""}
${lifeMode ? `- End every response with exactly: Directive issued.${travelWeb ? " Booking buttons appear below your text — mention them if useful." : ""}` : ""}
${visionRules}
Voice: confident friend giving quick advice, not a consultant.`,
      messages: messagesForClaude
    });

    const answer =
      message.content?.find((part) => part.type === "text")?.text?.trim() ||
      "Go with the boldest option available right now.";

    const bookingLinks = travelWeb ? buildBookingLinks(prompt) : undefined;
    const followPayload = await generateFollowUpSuggestionsPayload({
      userPrompt: promptTrim,
      assistantAnswer: answer,
      lifeMode: Boolean(lifeMode),
      personality
    });
    return res.json({
      answer,
      ...(bookingLinks ? { bookingLinks } : {}),
      followUpSuggestions: followPayload.showSamaritansBanner ? [] : followPayload.followUps,
      showSamaritansBanner: followPayload.showSamaritansBanner
    });
  } catch (error) {
    const status = error.statusCode === 400 ? 400 : 500;
    return res.status(status).json({ error: error.message || "Claude API request failed." });
  }
});

app.post("/api/nearby-places", async (req, res) => {
  try {
    const { lat, lng, type, radiusMeters } = req.body ?? {};
    const includedTypes = mapNearbyRequestTypeToIncludedTypes(type);
    const result = await searchNearbyPlacesNew({ lat, lng, includedTypes, radiusMeters });
    if (result.error && (!result.places || result.places.length === 0)) {
      return res.status(502).json({ error: result.error, places: [] });
    }
    return res.json({ places: result.places });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nearby places failed.", places: [] });
  }
});

app.post("/api/extract-preferences", async (req, res) => {
  const { conversation = [], answer = "" } = req.body ?? {};
  const priorMessages = Array.isArray(conversation)
    ? conversation.map((msg) => `${msg.role || "user"}: ${msg.content || ""}`).join("\n")
    : "";

  try {
    const extraction = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 180,
      temperature: 0,
      system: `Extract stable user preferences from a decision chat.
Rules:
- Return ONLY a JSON array of short strings.
- Focus on durable tastes, constraints, or context (budget, location, diet, genres, style).
- Skip temporary requests and anything uncertain.
- Keep each preference specific and user-facing, in plain language.
- Return [] when nothing useful is present.`,
      messages: [
        {
          role: "user",
          content: `Conversation:
${priorMessages || "No conversation"}

Latest assistant answer:
${answer || "No answer"}

Return JSON array now.`
        }
      ]
    });

    const text = extraction.content?.find((part) => part.type === "text")?.text?.trim() || "[]";
    const preferences = parseExtractedPreferences(text);
    return res.json({ preferences });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Preference extraction failed." });
  }
});

/**
 * Scheduled jobs (9:00 and 19:00 local — set NOTIFICATION_TZ, default Europe/London):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR_API/api/cron/daily-dilemma-reminder
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR_API/api/cron/streak-reminder
 * Requires: RESEND_API_KEY, EMAIL_FROM, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, Supabase URL + keys.
 */
app.post("/api/cron/daily-dilemma-reminder", async (req, res) => {
  const gate = assertCronSecret(req);
  if (!gate.ok) return res.status(401).json({ error: gate.reason });
  try {
    const out = await runDailyDilemmaReminders();
    if (!out.ok) return res.status(503).json(out);
    return res.json(out);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Cron job failed." });
  }
});

app.post("/api/cron/streak-reminder", async (req, res) => {
  const gate = assertCronSecret(req);
  if (!gate.ok) return res.status(401).json({ error: gate.reason });
  try {
    const out = await runStreakReminders();
    if (!out.ok) return res.status(503).json(out);
    return res.json(out);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Cron job failed." });
  }
});

/** Called from the app after sign-in to send welcome email once (uses user JWT). */
app.post("/api/emails/welcome", async (req, res) => {
  try {
    const header = req.headers?.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Authorization bearer token." });
    const out = await trySendWelcomeForUser(token);
    if (!out.ok) {
      const emailCfg = getNotificationConfig();
      if (!emailCfg.resendApiKey) return res.status(503).json({ error: out.error || "Email not configured." });
      return res.status(400).json({ error: out.error || "Welcome email failed." });
    }
    return res.json({ ok: true, ...out });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Welcome email failed." });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: 499,
            recurring: { interval: "month" },
            product_data: {
              name: "Decide For Me Pro",
              description: "Unlimited decisions and full Life Mode access"
            }
          }
        }
      ],
      subscription_data: {
        trial_period_days: 7
      },
      success_url: `${config.appBaseUrl}/?checkout=success`,
      cancel_url: `${config.appBaseUrl}/plans?checkout=cancelled`
    });

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Stripe checkout failed." });
  }
});

app.listen(PORT, () => {
  console.log(
    `Anthropic key loaded from ${config.anthropicKeySource} (length: ${config.anthropicApiKey.length}).`
  );
  console.log(
    `GOOGLE_PLACES_API_KEY (or VITE_GOOGLE_PLACES_API_KEY): ${googlePlacesKey ? "defined" : "not defined"}`
  );
  const tavilyK = normalizeEnvValue(process.env.TAVILY_API_KEY);
  const braveK = normalizeEnvValue(process.env.BRAVE_SEARCH_API_KEY);
  console.log(`TAVILY_API_KEY: ${tavilyK ? "defined" : "not defined"}`);
  console.log(`BRAVE_SEARCH_API_KEY: ${braveK ? "defined" : "not defined"}`);
  const emailCfg = getNotificationConfig();
  console.log(
    `[Email] RESEND_API_KEY: ${emailCfg.resendApiKey ? "defined" : "not defined"}; SERVICE_ROLE: ${emailCfg.supabaseServiceKey ? "defined" : "not defined"}; CRON_SECRET: ${emailCfg.cronSecret ? "defined" : "not defined"}`
  );
  console.log(`Allowed CORS origins: ${config.allowedOrigins.join(", ")}`);
  console.log(`API server running at http://localhost:${PORT}`);
});
