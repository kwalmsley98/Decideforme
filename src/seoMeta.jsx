import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SEO_LANDING_ROUTES } from "./SeoLandingPage.jsx";

export const SITE_CANONICAL = "https://decideforme.org";

export const DEFAULT_DESCRIPTION =
  "Stop overthinking. AI-powered decisions, Life Mode Command Centre, Daily Dilemmas, prestige ranks, shareable cards, and your Decision Profile — decideforme.org";

function ensureMetaName(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureMetaProperty(property, content) {
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureCanonical(href) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

/** Sets title, description, Open Graph, Twitter, and canonical URL. */
export function applyPageMeta({ title, description, path }) {
  const canonicalPath = path === "" ? "/" : path;
  const url = `${SITE_CANONICAL}${canonicalPath === "/" ? "" : canonicalPath}`;
  document.title = title;
  ensureMetaName("description", description);
  ensureMetaProperty("og:title", title);
  ensureMetaProperty("og:description", description);
  ensureMetaProperty("og:url", url);
  ensureMetaProperty("og:type", "website");
  ensureMetaProperty("og:site_name", "Decide For Me");
  ensureMetaName("twitter:card", "summary_large_image");
  ensureMetaProperty("twitter:title", title);
  ensureMetaProperty("twitter:description", description);
  ensureCanonical(url);
}

const STATIC_ROUTES = {
  "/": {
    title: "Decide For Me",
    description:
      "Your AI decision partner — chat, Life Mode, Daily Dilemmas, and prestige ranks. Stop overthinking at decideforme.org."
  },
  "/explore": {
    title: "Explore | Decide For Me",
    description: "Discover modes, group decisions, leaderboard, stats, Decision Profile, and more — decideforme.org."
  },
  "/stats": {
    title: "Decision Wrapped | Decide For Me",
    description: "Your stats, streaks, and decision habits in one snapshot — decideforme.org."
  },
  "/history": {
    title: "Decision history | Decide For Me",
    description: "Browse your past decisions and answers — decideforme.org."
  },
  "/momentum": {
    title: "Momentum | Decide For Me",
    description: "Track your decision momentum and rank progress — decideforme.org."
  },
  "/decision-profile": {
    title: "Decision Profile | Decide For Me",
    description: "Your decision personality, top categories, and shareable profile card — decideforme.org."
  },
  "/group": {
    title: "Group decisions | Decide For Me",
    description: "Create a room, collect votes, and lock in one group decision — decideforme.org."
  },
  "/leaderboard": {
    title: "Leaderboard | Decide For Me",
    description: "See how you rank against other deciders — decideforme.org."
  },
  "/referrals": {
    title: "Referrals | Decide For Me",
    description: "Share Decide For Me and track referral activity — decideforme.org."
  },
  "/affiliates": {
    title: "Affiliate program | Decide For Me",
    description:
      "50% recurring commission on Decide For Me Pro. Referral leaderboard, Stripe payouts — decideforme.org."
  },
  "/profile": {
    title: "Profile | Decide For Me",
    description: "Your account, prestige rank, referrals, and settings — decideforme.org."
  },
  "/plans": {
    title: "Pro plans | Decide For Me",
    description: "Upgrade to Decide For Me Pro — decideforme.org."
  },
  "/login": {
    title: "Log in | Decide For Me",
    description: "Sign in to Decide For Me — decideforme.org."
  },
  "/signup": {
    title: "Sign up | Decide For Me",
    description: "Create your Decide For Me account — decideforme.org."
  }
};

export function metaForPath(pathname) {
  const landing = SEO_LANDING_ROUTES.find((c) => c.path === pathname);
  if (landing) {
    return {
      title: landing.metaTitle,
      description: landing.metaDescription,
      path: pathname
    };
  }

  if (STATIC_ROUTES[pathname]) {
    return { ...STATIC_ROUTES[pathname], path: pathname };
  }

  if (pathname.startsWith("/group/") && pathname.length > "/group/".length) {
    return {
      title: "Group room | Decide For Me",
      description: "Vote with friends and finalize one group decision — decideforme.org.",
      path: pathname
    };
  }

  if (pathname.startsWith("/ref/")) {
    return {
      title: "Join Decide For Me",
      description: "Sign up with a friend’s referral link — decideforme.org.",
      path: pathname
    };
  }

  return {
    title: "Decide For Me",
    description: DEFAULT_DESCRIPTION,
    path: pathname
  };
}

export function DocumentMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const m = metaForPath(pathname);
    applyPageMeta(m);
  }, [pathname]);
  return null;
}
