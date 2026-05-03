import { createContext, useContext, useEffect, useMemo, useState } from "react";

/** Minor units — keep in sync with `server/stripeAffiliate.js` STRIPE_UNIT_AMOUNTS */
export const COMMERCE_PRICES = {
  gbp: { month: 1499, year: 9900 },
  eur: { month: 1699, year: 9900 },
  usd: { month: 1799, year: 10900 }
};

const GBP_CODES = new Set(["GB", "GG", "IM", "JE"]);

/** EU, EEA, CH & closely aligned microstates — priced in EUR */
const EUR_CODES = new Set([
  "AD",
  "AT",
  "BE",
  "BG",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MC",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  "SM",
  "VA"
]);

function regionFromLocaleTag(tag) {
  try {
    const loc = new Intl.Locale(tag);
    return loc.region?.toUpperCase() || "";
  } catch {
    const parts = String(tag).split("-");
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
  }
}

/** Infer gbp | eur | null from browser locale(s); null = use geo or USD fallback */
export function inferCurrencyFromLocales() {
  const list =
    typeof navigator !== "undefined" && navigator.languages?.length
      ? navigator.languages
      : typeof navigator !== "undefined" && navigator.language
        ? [navigator.language]
        : [];
  for (const tag of list) {
    const region = regionFromLocaleTag(tag);
    if (!region) continue;
    if (GBP_CODES.has(region)) return "gbp";
    if (EUR_CODES.has(region)) return "eur";
  }
  return null;
}

function fetchIpGeo(timeoutMs = 4500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch("https://ipapi.co/json/", { signal: ctrl.signal })
    .finally(() => clearTimeout(id))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("geo fail"))))
    .then((data) => String(data?.country_code || "").toUpperCase() || null)
    .catch(() => null);
}

/**
 * UK → GBP, EU/EEA/CH (+ listed microstates) → EUR, else USD.
 * Uses locale first, then IP (no permission prompt).
 */
export async function detectCommerceCurrency() {
  const fromLocale = inferCurrencyFromLocales();
  if (fromLocale) return fromLocale;

  const cc = await fetchIpGeo();
  if (cc && GBP_CODES.has(cc)) return "gbp";
  if (cc && EUR_CODES.has(cc)) return "eur";
  return "usd";
}

export function formatPlanPrice(plan, currencyCode, locale) {
  const key = plan === "year" ? "year" : "month";
  const code = String(currencyCode || "usd").toLowerCase();
  const minor = COMMERCE_PRICES[code]?.[key];
  if (minor == null) return "";
  const loc = locale || (typeof navigator !== "undefined" ? navigator.language : "en-US");
  return new Intl.NumberFormat(loc, {
    style: "currency",
    currency: code.toUpperCase()
  }).format(minor / 100);
}

const CommerceCurrencyContext = createContext(null);

export function CommerceCurrencyProvider({ children }) {
  const [currency, setCurrency] = useState("usd");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    detectCommerceCurrency().then((c) => {
      if (!cancelled) {
        setCurrency(typeof c === "string" ? c.toLowerCase() : "usd");
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => {
    const code = currency in COMMERCE_PRICES ? currency : "usd";
    const loc = typeof navigator !== "undefined" ? navigator.language : "en-US";
    return {
      currency: code,
      ready,
      formatMonth: () => formatPlanPrice("month", code, loc),
      formatYear: () => formatPlanPrice("year", code, loc),
      minorMonth: COMMERCE_PRICES[code].month,
      minorYear: COMMERCE_PRICES[code].year
    };
  }, [currency, ready]);

  return <CommerceCurrencyContext.Provider value={value}>{children}</CommerceCurrencyContext.Provider>;
}

export function useCommerceCurrency() {
  const ctx = useContext(CommerceCurrencyContext);
  if (!ctx) {
    throw new Error("useCommerceCurrency must be used within CommerceCurrencyProvider");
  }
  return ctx;
}
