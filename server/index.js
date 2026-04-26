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
    ["CLAUDE_API_KEY", process.env.CLAUDE_API_KEY],
    ["VITE_ANTHROPIC_API_KEY", process.env.VITE_ANTHROPIC_API_KEY]
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

app.post("/api/decide", async (req, res) => {
  const { category, mood } = req.body ?? {};
  if (!category || !mood) {
    return res.status(400).json({ error: "category and mood are required." });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 180,
      temperature: 0.5,
      system:
        "You are a confidence-first decision assistant. Always return one decisive recommendation only.",
      messages: [
        {
          role: "user",
          content: `Category: ${category}\nMood: ${mood}\n\nGive one confident decision in 1-2 sentences.`
        }
      ]
    });

    const answer =
      message.content?.find((part) => part.type === "text")?.text?.trim() ||
      "Go with the boldest option available right now.";

    return res.json({ answer });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Claude API request failed." });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  const { stripePriceId } = req.body ?? {};
  if (!stripePriceId) return res.status(400).json({ error: "stripePriceId is required." });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: stripePriceId, quantity: 1 }],
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
