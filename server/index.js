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
const googlePlacesKey = normalizeEnvValue(process.env.GOOGLE_PLACES_API_KEY);
const unsplashAccessKey = normalizeEnvValue(process.env.UNSPLASH_ACCESS_KEY);

function looksRecommendationWorthy(prompt, answer = "") {
  const text = `${String(prompt || "").toLowerCase()} ${String(answer || "").toLowerCase()}`;
  const keywords = [
    "restaurant",
    "food",
    "eat",
    "cafe",
    "bar",
    "activity",
    "things to do",
    "date night",
    "gym",
    "shopping",
    "buy",
    "store",
    "visit",
    "hotel",
    "museum",
    "park"
  ];
  return keywords.some((k) => text.includes(k));
}

function formatPriceLevel(priceLevel) {
  const numeric = Number(priceLevel);
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return "£".repeat(Math.max(1, Math.min(numeric + 1, 4)));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function getUnsplashImage(query) {
  if (!unsplashAccessKey) return "";
  const endpoint = new URL("https://api.unsplash.com/search/photos");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("per_page", "1");
  endpoint.searchParams.set("orientation", "landscape");

  const response = await fetch(endpoint.toString(), {
    headers: { Authorization: `Client-ID ${unsplashAccessKey}` }
  });
  if (!response.ok) return "";
  const data = await response.json();
  return data?.results?.[0]?.urls?.regular || "";
}

async function getPlaceRecommendations({ prompt, userLocation }) {
  if (!googlePlacesKey) return [];
  if (!userLocation?.lat || !userLocation?.lng) return [];
  const endpoint = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  endpoint.searchParams.set("query", prompt);
  endpoint.searchParams.set("location", `${Number(userLocation.lat)},${Number(userLocation.lng)}`);
  endpoint.searchParams.set("radius", "6000");
  endpoint.searchParams.set("key", googlePlacesKey);

  const response = await fetch(endpoint.toString());
  if (!response.ok) return [];
  const data = await response.json();
  const top = (data.results || []).slice(0, 3);

  const cards = [];
  for (const place of top) {
    const imageUrl = await getUnsplashImage(`${place.name} ${prompt}`);
    const mapsUrl = place.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;

    const lowerPrompt = prompt.toLowerCase();
    const orderLink =
      /food|restaurant|eat|delivery|takeaway|dinner|lunch/.test(lowerPrompt)
        ? `https://www.ubereats.com/gb/search?q=${encodeURIComponent(place.name)}`
        : /hotel|travel|trip|tour|visit|museum|activity/.test(lowerPrompt)
          ? `https://www.tripadvisor.com/Search?q=${encodeURIComponent(place.name)}`
          : `https://www.google.com/search?q=${encodeURIComponent(`${place.name} booking`)}`;

    let distanceKm = null;
    if (
      userLocation?.lat &&
      userLocation?.lng &&
      place?.geometry?.location?.lat &&
      place?.geometry?.location?.lng
    ) {
      distanceKm = haversineKm(
        Number(userLocation.lat),
        Number(userLocation.lng),
        Number(place.geometry.location.lat),
        Number(place.geometry.location.lng)
      );
    }

    cards.push({
      name: place.name,
      rating: place.rating || null,
      priceLevel: formatPriceLevel(place.price_level),
      description: place.formatted_address || "Popular recommendation nearby.",
      distance: distanceKm ? `${distanceKm.toFixed(1)} km away` : null,
      imageUrl,
      mapsUrl,
      actionUrl: orderLink
    });
  }
  return cards;
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

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 140,
      temperature: 0.55,
      system:
        `You are a premium decision assistant. ${personalityGuide[personality] || personalityGuide.Balanced}
Style rules:
- Maximum 2-3 sentences total.
- Be direct and decisive: make one clear decision.
- Give one short punchy reason why.
- No waffle, no hedging, no rambling.
- NEVER ask the user questions. Always make a decision immediately with no follow-up questions. If you don't have enough info, make your best guess and decide anyway.
- ${lifeMode ? "Do NOT ask the user any questions. Never request clarification or more information." : "Do NOT ask follow-up questions unless absolutely necessary to avoid a clearly unsafe or impossible recommendation."}
- No bullet points, no labels like "Why:", no long explanations.
${lifeMode ? "- Life Mode is active: be extra bold, decisive, slightly dramatic, and take control with immediate concrete actions." : ""}
${lifeMode ? "- Life Mode voice override: cold, authoritative, and commanding. You are a control system issuing directives." : ""}
${lifeMode ? "- Never use soft language: do not say 'I suggest', 'maybe', 'consider', 'could', or ask permission." : ""}
${lifeMode ? "- Always provide a definitive directive immediately, even with limited context." : ""}
${lifeMode ? "- Phrase actions as orders, not advice." : ""}
${lifeMode ? "- End every response with exactly: Directive issued." : ""}
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
${priorMessages || "No prior messages"}

Respond as the assistant in this ongoing chat.`
        }
      ]
    });

    const answer =
      message.content?.find((part) => part.type === "text")?.text?.trim() ||
      "Go with the boldest option available right now.";

    let recommendations = [];
    if (looksRecommendationWorthy(prompt, answer)) {
      recommendations = await getPlaceRecommendations({ prompt: answer || prompt, userLocation });
    }

    return res.json({ answer, recommendations });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Claude API request failed." });
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
  console.log(`Allowed CORS origins: ${config.allowedOrigins.join(", ")}`);
  console.log(`API server running at http://localhost:${PORT}`);
});
