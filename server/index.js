import "dotenv/config";
import cors from "cors";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";

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

/** Places API (New): POST places:searchNearby — returns normalized place rows */
async function searchNearbyPlacesNew({ lat, lng, includedTypes }) {
  if (!googlePlacesKey) {
    return { places: [], error: "Missing GOOGLE_PLACES_API_KEY." };
  }
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { places: [], error: "Invalid lat or lng." };
  }

  const types = Array.isArray(includedTypes) && includedTypes.length ? includedTypes : ["restaurant"];

  const body = {
    includedTypes: types,
    maxResultCount: 5,
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius: 5000
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

app.use(express.json());

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
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required." });
  }

  try {
    const personalityGuide = {
      Balanced: "Give practical, calm, confident answers.",
      Savage: "Be blunt and spicy, but still helpful.",
      "Hype Man": "Be energetic and motivating.",
      "Life Coach": "Be wise, supportive, and growth-focused."
    };

    const priorMessages = Array.isArray(conversation)
      ? conversation.map((msg) => `${msg.role || "user"}: ${msg.content || ""}`).join("\n")
      : "";
    const knownPreferences = Array.isArray(userPreferences)
      ? userPreferences.map((pref) => String(pref || "").trim()).filter(Boolean).slice(0, 20)
      : [];
    const preferenceContext = knownPreferences.length
      ? knownPreferences.map((pref) => `- ${pref}`).join("\n")
      : "No known user preferences yet.";

    const combinedForCrisis = `${prompt}\n${priorMessages}`;
    if (detectMentalHealthCrisis(combinedForCrisis)) {
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
- About 4–7 short sentences. The Samaritans number 116 123 must appear in the message.`,
        messages: [
          {
            role: "user",
            content: `Latest message:\n${prompt}\n\nEarlier chat:\n${priorMessages || "None"}\n\nWrite one supportive reply. Include Samaritans 116 123.`
          }
        ]
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

    const travelWebUserBlock = travelWeb
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

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: travelWeb ? 520 : 140,
      temperature: 0.55,
      system:
        `You are a premium decision assistant. ${personalityGuide[personality] || personalityGuide.Balanced}
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
Voice: confident friend giving quick advice, not a consultant.`,
      messages: [
        {
          role: "user",
          content: `User decision request: ${prompt}
Personality mode: ${personality}
Group preferences (if any):
${groupSummary || "None"}

Known user preferences:
${preferenceContext}

Conversation so far:
${priorMessages || "No prior messages"}${travelWebUserBlock}

Respond as the assistant in this ongoing chat.`
        }
      ]
    });

    const answer =
      message.content?.find((part) => part.type === "text")?.text?.trim() ||
      "Go with the boldest option available right now.";

    const bookingLinks = travelWeb ? buildBookingLinks(prompt) : undefined;
    return res.json({ answer, ...(bookingLinks ? { bookingLinks } : {}) });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Claude API request failed." });
  }
});

app.post("/api/nearby-places", async (req, res) => {
  try {
    const { lat, lng, type } = req.body ?? {};
    const includedTypes = mapNearbyRequestTypeToIncludedTypes(type);
    const result = await searchNearbyPlacesNew({ lat, lng, includedTypes });
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
  console.log(`Allowed CORS origins: ${config.allowedOrigins.join(", ")}`);
  console.log(`API server running at http://localhost:${PORT}`);
});
