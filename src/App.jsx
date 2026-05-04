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
import { SeoLandingPage, SEO_LANDING_ROUTES } from "./SeoLandingPage.jsx";
import {
  ArrowUp,
  BadgePercent,
  BarChart2,
  Clock,
  Compass,
  Flame,
  LogIn,
  MessageCircle,
  Paperclip,
  Zap,
  Trophy,
  User,
  Users,
  X
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { CommerceCurrencyProvider, useCommerceCurrency } from "./lib/commerceCurrency.jsx";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiUrl = (path) => `${API_BASE_URL}${path}`;

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

function ProtectedRoute({ session, children }) {
  if (!isSupabaseConfigured) return <Navigate to="/" replace />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function DailyDilemmaCard({ session }) {
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
        </>
      ) : (
        <p className="meta">You can vote once today. Results unlock right after you vote.</p>
      )}
    </section>
  );
}

function ChatScreen({ session }) {
  const { currency, formatMonth, formatYear } = useCommerceCurrency();
  const DAILY_FREE_LIMIT = 100;
  const GUEST_DAILY_FREE_LIMIT = 100;
  const LIFE_MODE_STORAGE_KEY = "decide_for_me_life_mode_session";
  const GUEST_ID_STORAGE_KEY = "decide_for_me_guest_id";
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
  const [promptRef, setPromptRef] = useState(null);
  const [replyRef, setReplyRef] = useState(null);
  const [lifeModePromptOpen, setLifeModePromptOpen] = useState(false);
  const [lifeModeSession, setLifeModeSession] = useState(null);
  const [lifeModeCountdownLabel, setLifeModeCountdownLabel] = useState("");
  const [lifeModeGlobalCount, setLifeModeGlobalCount] = useState(0);
  const [lifeModeRecap, setLifeModeRecap] = useState(null);
  const [activatingLifeMode, setActivatingLifeMode] = useState(false);
  const [copiedLifeCaption, setCopiedLifeCaption] = useState(false);
  const [lifeModeDecisionFeed, setLifeModeDecisionFeed] = useState([]);

  const [searchParams, setSearchParams] = useSearchParams();
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

  const todayKey = new Date().toISOString().slice(0, 10);
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

    const recap = {
      totalDecisions: list.length,
      highlights,
      verdict
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
      return;
    }

    const loadLifeMode = async () => {
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

  const activateLifeMode = async () => {
    if (activatingLifeMode) return;
    setActivatingLifeMode(true);
    console.log("[LifeMode] I'm In tapped");
    const endsAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const authSession = supabase ? (await supabase.auth.getSession()).data.session : null;
    const resolvedUserId = session?.user?.id || authSession?.user?.id || null;
    console.log("[LifeMode] activation context", {
      user_id: resolvedUserId,
      hasPropSession: Boolean(session?.user?.id),
      hasAuthSession: Boolean(authSession?.user?.id)
    });
    const optimisticSession = {
      id: `local-${Date.now()}`,
      user_id: resolvedUserId,
      started_at: new Date().toISOString(),
      ends_at: endsAt,
      is_active: true
    };
    // Optimistic transition so mobile users always enter Life Mode instantly.
    setLifeModeSession(optimisticSession);
    setLifeModeRecap(null);
    setLifeModePromptOpen(false);

    // If auth/Supabase isn't available, keep local Life Mode active so UX still works.
    if (!supabase || !resolvedUserId) {
      console.log("[LifeMode] running in local-only mode (no authenticated Supabase session)");
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
      console.log("[LifeMode] activation result", { hasData: Boolean(data), error: error?.message || null });
      if (error) {
        console.error("[LifeMode] insert error", {
          user_id: resolvedUserId,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        setError(`Life Mode activation failed to save: ${error.message}`);
      } else {
        setLifeModeSession(data || optimisticSession);
      }
      await refreshLifeModeGlobalCount();
    } finally {
      setActivatingLifeMode(false);
    }
  };

  const openLifeModePrompt = (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (event?.stopPropagation) event.stopPropagation();
    if (!session?.user?.id) {
      setUpgradePromptReason("feature");
      setShowUpgradePrompt(true);
      return;
    }
    setLifeModePromptOpen(true);
  };

  const startProCheckout = async (plan = "month") => {
    if (!session?.access_token) {
      setError("Sign in to upgrade to Pro.");
      return;
    }
    setCheckoutLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/create-checkout-session"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ plan: plan === "year" ? "year" : "month", currency })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to start checkout.");
      if (!data?.url) throw new Error("Stripe checkout URL missing.");
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Failed to start Stripe checkout.");
      setCheckoutLoading(false);
    }
  };

  const copyLifeModeCaption = async () => {
    const recapText = lifeModeRecap
      ? `${lifeModeCaption}\n\nDecisions: ${lifeModeRecap.totalDecisions}\nVerdict: ${lifeModeRecap.verdict}`
      : lifeModeCaption;
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

  if (lifeModeSession) {
    return (
      <section className="card premium life-mode-fullscreen">
        <div className="life-mode-veil" />
        <p className="hero-kicker">Life Mode Engaged</p>
        <h1 className="life-mode-command">AI IS IN CONTROL</h1>
        <div className="life-mode-sigil-wrap">
          <div className="life-mode-sigil" aria-hidden="true">
            ◉
          </div>
        </div>
        <p className="meta life-mode-warning">Your decisions are now being executed by the system.</p>
        <p className="life-mode-timer">{lifeModeCountdownLabel || lifeModeCountdown(lifeModeSession.ends_at)}</p>
        <p className="meta">Time remaining</p>

        <article className="life-mode-feed">
          <p className="hero-kicker">Today's AI Decision Feed</p>
          <div className="life-mode-feed-list">
            {lifeModeDecisionFeed.length ? (
              lifeModeDecisionFeed.map((item) => (
                <div key={item.id} className="life-mode-feed-entry">
                  <article className="life-mode-input-log">
                    <p className="meta">{new Date(item.created_at || Date.now()).toLocaleTimeString()}</p>
                    <p className="meta">SYSTEM INPUT LOG</p>
                    <p>{item.prompt}</p>
                  </article>
                  <article className="life-mode-feed-item">
                    <p className="meta">DIRECTIVE ISSUED</p>
                    <p className="answer">{item.answer}</p>
                  </article>
                </div>
              ))
            ) : (
              <p className="meta">No decisions logged yet. Ask your first Life Mode question to begin the feed.</p>
            )}
          </div>
        </article>

        <form
          className="form life-mode-input-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!prompt.trim() && !pendingImage) return;
            sendToAI(prompt.trim(), !conversation.length);
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
              disabled={loading}
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
              placeholder="Report your situation. AI will issue a final decision."
              disabled={loading}
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
        {conversation.length || loading ? (
          <div className="chat-and-nearby life-mode-chat-stack">
            <div className="chat-frame">
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
        {error ? <p className="error">{error}</p> : null}
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
                  onClick={() => setReply(text)}
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
      {showUpgradePrompt ? (
        <div
          className="upgrade-modal-overlay"
          role="presentation"
          onClick={() => setShowUpgradePrompt(false)}
        >
          <article className="upgrade-modal-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="upgrade-modal-close"
              onClick={() => setShowUpgradePrompt(false)}
              aria-label="Close"
            >
              <X size={20} strokeWidth={2.25} />
            </button>
            <p className="hero-kicker">{upgradePromptReason === "feature" ? "Premium feature" : "Daily limit reached"}</p>
            <h2>Upgrade to Pro</h2>
            <p className="plan-price">
              {formatMonth()}/mo · {formatYear()}/yr
            </p>
            <p className="muted">Unlimited decisions and full Life Mode access.</p>
            {!session?.user?.id ? <p className="meta">Sign in to subscribe. Free tier limits apply to guests and free accounts.</p> : null}
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
            {!session?.user?.id ? (
              <Link to="/signup" className="ghost-btn upgrade-cta">
                Create free account instead
              </Link>
            ) : null}
          </article>
        </div>
      ) : null}
      {!conversation.length ? (
        <div className="quick-category-scroll">
          <div className="quick-category-row">
            {quickCategories.map((item) => (
              <button key={item.label} type="button" className="quick-category-pill" onClick={() => setPrompt(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
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
        <DailyDilemmaCard session={session} />
      </div>
      {conversation.length ? (
        <SharePanel
          text={`Decide For Me: ${[...conversation].reverse().find((m) => m.role === "user" || m.role === "assistant")?.content || ""}`}
        />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {lifeModePromptOpen ? (
        <div className="life-mode-modal">
          <div className="life-mode-modal-card">
            <p className="hero-kicker">Life Mode Activation</p>
            <h2>Are you sure?</h2>
            <p>For the next 24 hours, AI makes every decision for you.</p>
            <button className="primary-btn" type="button" onClick={activateLifeMode} disabled={activatingLifeMode}>
              {activatingLifeMode ? "Activating..." : "I'm In"}
            </button>
            <button className="ghost-btn" type="button" onClick={() => setLifeModePromptOpen(false)}>
              Maybe later
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </section>
  );
}

function HistoryScreen({ session }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("decision_history")
      .select("id, answer, mood, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(25)
      .then(({ data }) => setHistory(data ?? []));
  }, [session.user.id]);

  return (
    <section className="card">
      <h1>History</h1>
      <div className="history-list">
        {history.map((item) => (
          <article key={item.id} className="history-item">
            <p className="meta">{item.mood}</p>
            <p>{item.answer}</p>
            <p className="meta">{new Date(item.created_at).toLocaleString()}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatsScreen({ session }) {
  const [stats, setStats] = useState(null);
  const [weeklyRecap, setWeeklyRecap] = useState(null);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    const load = async () => {
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      const { data: history } = await supabase
        .from("decision_history")
        .select("created_at, category, conversation, answer")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });
      const list = history ?? [];
      const categoryMap = {};
      let mindChanges = 0;
      for (const item of list) {
        categoryMap[item.category] = (categoryMap[item.category] || 0) + 1;
        if (Array.isArray(item.conversation)) {
          mindChanges += item.conversation.filter((x) => /actually|instead|change/i.test(x.content || "")).length;
        }
      }
      const mostIndecisive = Object.entries(categoryMap).sort((a, b) => b[1] - a[1])[0]?.[0] || "General";
      setStats({
        totalDecisions: profile?.total_decisions || list.length,
        mostIndecisive,
        longestStreak: profile?.longest_streak || 0,
        mindChanges,
        firstDecision: list[0]?.answer || "No decisions yet"
      });

      const monday = new Date().getDay() === 1;
      const insights = [
        `You move fastest when choices are practical (${mostIndecisive} dominates your log).`,
        `You reconsider details ${mindChanges} times, showing high intention not indecision.`,
        `Your momentum score is strong: ${profile?.current_streak || 0} day streak with ${profile?.total_votes || 0} social votes.`
      ];
      if (monday) {
        setWeeklyRecap(insights);
      } else {
        setWeeklyRecap(null);
      }
    };
    load();
  }, [session?.user?.id]);

  if (!stats) return <section className="card">Loading your wrapped...</section>;

  return (
    <section className="card premium wrapped-card">
      <h1>Your Decision Wrapped</h1>
      <p className="muted">Your habits, streaks and decision personality in one snapshot.</p>
      <div className="stats-grid">
        <article className="history-item">
          <p className="meta">Total decisions</p>
          <p className="answer">{stats.totalDecisions}</p>
        </article>
        <article className="history-item">
          <p className="meta">Most indecisive about</p>
          <p>{stats.mostIndecisive}</p>
        </article>
        <article className="history-item">
          <p className="meta">Longest streak</p>
          <p className="answer">🔥 {stats.longestStreak} days</p>
        </article>
        <article className="history-item">
          <p className="meta">Minds changed</p>
          <p>{stats.mindChanges}</p>
        </article>
      </div>
      <article className="history-item">
        <p className="meta">First ever decision</p>
        <p>{stats.firstDecision}</p>
      </article>
      {weeklyRecap ? (
        <article className="history-item weekly-recap">
          <p className="meta">Last week your AI learned this about you...</p>
          <ul>
            {weeklyRecap.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <SharePanel text={`My weekly Decide For Me recap:\n- ${weeklyRecap.join("\n- ")}`} />
        </article>
      ) : null}
    </section>
  );
}

function ExploreScreen({ session }) {
  return (
    <section className="card premium explore-hub">
      <header className="explore-hub-head">
        <h1>Explore</h1>
        <p className="muted">Groups, leaderboard, and your numbers.</p>
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

  return (
    <section className="card premium">
      <h1>Group room</h1>
      <p className="muted">{room.prompt}</p>
      <p className="meta">Mode: {room.personality}</p>
      <SharePanel text={shareLink} />
      <form className="form" onSubmit={submitPreference}>
        <input
          value={preference}
          onChange={(event) => setPreference(event.target.value)}
          placeholder="Add your preference..."
        />
        <button className="ghost-btn">Add preference</button>
      </form>
      <div className="history-list">
        {prefs.map((p) => (
          <article key={p.id} className="history-item">
            <p className="meta">{p.nickname}</p>
            <p>{p.preference}</p>
          </article>
        ))}
      </div>
      <button className="primary-btn" onClick={generateFinal} disabled={loading}>
        {loading ? "Deciding..." : "Make final group decision"}
      </button>
      {room.final_answer ? (
        <>
          <p className="answer">{room.final_answer}</p>
          {finalBookingLinks.length ? (
            <div className="booking-pills-row" role="navigation" aria-label="Compare and book">
              {finalBookingLinks.map((link) => (
                <a key={link.label} href={link.url} className="booking-pill" target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {loading ? <LoadingOrb /> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function LeaderboardScreen({ session }) {
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

function ReferralLeaderboardScreen() {
  const [rows, setRows] = useState([]);

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

  return (
    <section className="card premium leaderboard-card referrals-page-safe">
      <div className="leaderboard-head">
        <h1 className="leaderboard-title">🏅 Referral leaderboard</h1>
      </div>
      <p className="muted">Ranked by total affiliate earnings, then paying referrals.</p>
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
        .select("id, email, username, referral_code, public_ref_slug")
        .eq("id", user.id)
        .maybeSingle();

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
    document.title = "Affiliate Program | Decide For Me";
    let el = document.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
    }
    el.setAttribute(
      "content",
      "50% recurring commission on Decide For Me Pro. Referral leaderboard, Stripe payouts, earn while you sleep."
    );
    return () => {
      document.title = "Decide For Me";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      const {
        data: { session: authSession }
      } = await supabase.auth.getSession();
      const user = authSession?.user || null;
      const accessToken = authSession?.access_token || "";
      if (!user) return;
      const { data: refRows } = await supabase
        .from("referrals")
        .select("referral_code")
        .eq("referrer_id", user.id)
        .not("referral_code", "is", null)
        .limit(1);
      const tableCode = String(refRows?.[0]?.referral_code || "").trim().toLowerCase();
      const { data: profile } = await supabase.from("profiles").select("referral_code").eq("id", user.id).maybeSingle();
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
        <p className="answer seo-landing-lede">
          Share Decide For Me with your audience and earn <strong>half of every Pro subscription</strong> you refer (
          {formatMonth()}/month or {formatYear()}/year plans). Top performers hit the public leaderboard;
          payouts go straight to your bank via Stripe Connect.
        </p>
        <ul className="affiliates-benefits">
          <li>Clean link: <code className="affiliates-code">decideforme.org/ref/yourname</code></li>
          <li>Live dashboard: clicks, signups, paying users, total earnings</li>
          <li>We handle billing; you promote a product people actually use</li>
        </ul>
        <div className="seo-landing-cta-row">
          <button type="button" className="primary-btn seo-landing-cta" onClick={ensureReferralLink} disabled={linkLoading}>
            {linkLoading ? "Checking account…" : "Sign up & get your link"}
          </button>
          <Link to="/referrals" className="ghost-btn seo-landing-secondary">
            View leaderboard
          </Link>
        </div>
        {refLink ? (
          <div className="history-item">
            <p className="meta">Your referral link</p>
            <p className="answer referral-link-break">{refLink}</p>
            <button type="button" className="ghost-btn" onClick={copyRefLink}>
              {copied ? "Copied!" : "Copy link"}
            </button>
            <div style={{ marginTop: 10 }}>
              {connectStatus.onboarded ? (
                <p className="answer">✅ Bank account connected</p>
              ) : (
                <button type="button" className="ghost-btn" onClick={startConnectOnboarding} disabled={connectLoading}>
                  {connectLoading ? "Opening Stripe…" : "Connect bank account to receive payouts"}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {linkError ? <p className="error">{linkError}</p> : null}
      </div>
    </section>
  );
}

function ProfileScreen({ session }) {
  const [profile, setProfile] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [referralCodeFromReferrals, setReferralCodeFromReferrals] = useState("");
  const [preferences, setPreferences] = useState([]);
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
    if (!existingCode) {
      const generatedCode = await reserveRandomReferralCode(session.user.id);
      const { data: updated } = await supabase
        .from("profiles")
        .update({ referral_code: generatedCode })
        .eq("id", session.user.id)
        .select("*")
        .single();
      if (updated) normalizedProfile = updated;
    }
    setProfile(normalizedProfile);
    const { data: refData } = await supabase
      .from("referrals")
      .select("*")
      .eq("referrer_id", session.user.id);
    setReferrals(refData ?? []);
    const tableCode = String((refData || []).find((row) => row?.referral_code)?.referral_code || "").trim().toLowerCase();
    if (tableCode) setReferralCodeFromReferrals(tableCode);
    const { data: preferenceRows } = await supabase
      .from("user_preferences")
      .select("id, preference")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false });
    setPreferences(preferenceRows ?? []);

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

  if (!session) return <Navigate to="/login" replace />;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const canonicalCode = referralCodeFromReferrals || String(profile?.referral_code || "").toLowerCase();
  const prettyRefLink = canonicalCode && origin ? `${origin}/ref/${canonicalCode}` : "";

  const removePreference = async (id) => {
    if (!supabase || !id) return;
    await supabase.from("user_preferences").delete().eq("id", id).eq("user_id", session.user.id);
    setPreferences((prev) => prev.filter((item) => item.id !== id));
  };

  const renderedPreferences = useMemo(() => {
    const output = [];
    for (const item of preferences) {
      const text = String(item?.preference || "");
      const clean = text.replace(/```json|```/gi, "").trim();
      if (!clean) continue;
      try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) {
          parsed
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
            .forEach((entry, idx) => output.push({ key: `${item.id}-${idx}`, sourceId: item.id, label: entry }));
          continue;
        }
        if (Array.isArray(parsed?.preferences)) {
          parsed.preferences
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
            .forEach((entry, idx) => output.push({ key: `${item.id}-${idx}`, sourceId: item.id, label: entry }));
          continue;
        }
      } catch {
        // Fall through to raw cleaned text when JSON parsing fails.
      }
      output.push({ key: String(item.id), sourceId: item.id, label: clean });
    }
    return output;
  }, [preferences]);

  return (
    <section className="card">
      <h1>Profile</h1>
      <p className="meta">{session.user.email}</p>
      <p>Bonus decisions: {profile?.bonus_decisions || 0}</p>
      <p>Total decisions: {profile?.total_decisions || 0}</p>
      <p className="answer">🔥 Streak: {profile?.current_streak || 0} days</p>
      <p className="meta">Longest streak: {profile?.longest_streak || 0} days</p>

      <article className="history-item referral-dashboard-card">
        <p className="hero-kicker">Referrals &amp; affiliates</p>
        <p className="muted">
          Earn <strong>50%</strong> recurring on Pro subscriptions from your referrals.{" "}
          <Link to="/affiliates">Program details</Link> · <Link to="/referrals">Leaderboard</Link>
        </p>
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
      </article>

      <p className="muted">Referrals recorded: {referrals.length}</p>

      <article className="history-item ai-profile-card">
        <p className="hero-kicker">Your AI knows you</p>
        <p className="muted">Everything your assistant has learned from your decisions, so future advice is instantly personal.</p>
        {renderedPreferences.length ? (
          <div className="learned-preferences">
            {renderedPreferences.map((item) => (
              <div key={item.key} className="learned-preference-item">
                <p>{item.label}</p>
                <button
                  type="button"
                  className="pref-remove-btn"
                  aria-label={`Remove preference ${item.label}`}
                  onClick={() => removePreference(item.sourceId)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="meta">Your AI is still learning. Start with one decision and your profile will begin to fill in.</p>
        )}
      </article>
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
    .select("id, public_ref_slug, referral_code")
    .eq("id", user.id)
    .maybeSingle();
  if (!existing) {
    const referralCode = await reserveRandomReferralCode(user.id);
    const publicRefSlug = await generateUniquePublicRefSlug(supabase, username);
    await supabase.from("profiles").insert({
      id: user.id,
      username,
      referral_code: referralCode,
      public_ref_slug: publicRefSlug
    });
  } else if (!existing.public_ref_slug || !existing.referral_code) {
    const publicRefSlug = await generateUniquePublicRefSlug(supabase, username);
    const patch = { public_ref_slug: publicRefSlug };
    if (!existing.referral_code) patch.referral_code = await reserveRandomReferralCode(user.id);
    await supabase.from("profiles").update(patch).eq("id", user.id);
  }

  const pendingSlug = localStorage.getItem("pending_ref_slug");
  const pendingCode = localStorage.getItem("pending_referral_code");

  let referrerId = null;
  if (pendingSlug) {
    const normalized = String(pendingSlug).trim().toLowerCase();
    const { data: bySlug } = await supabase
      .from("profiles")
      .select("id")
      .eq("public_ref_slug", normalized)
      .maybeSingle();
    if (bySlug?.id && bySlug.id !== user.id) referrerId = bySlug.id;
    localStorage.removeItem("pending_ref_slug");
  }
  if (!referrerId && pendingCode) {
    const { data: byCode } = await supabase.from("profiles").select("id").eq("referral_code", pendingCode).maybeSingle();
    if (byCode?.id && byCode.id !== user.id) referrerId = byCode.id;
    localStorage.removeItem("pending_referral_code");
  }

  if (!referrerId) return;

  const { data: me } = await supabase.from("profiles").select("referred_by").eq("id", user.id).maybeSingle();
  if (me?.referred_by) return;

  await supabase.from("profiles").update({ referred_by: referrerId }).eq("id", user.id);

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
    if (!session?.access_token) {
      setError("Sign in to subscribe.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/create-checkout-session"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ plan, currency })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to start checkout.");
      if (!data?.url) throw new Error("Stripe checkout URL missing.");
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Stripe checkout failed.");
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <h1>Upgrade to Pro</h1>
      <p className="muted">7-day trial, then choose monthly or yearly billing.</p>
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
  const location = useLocation();

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
    if (!session?.access_token) return;
    const search = new URLSearchParams(location.search || "");
    if (search.get("checkout") !== "success") return;
    const referralCode = String(localStorage.getItem("referral_code") || "")
      .trim()
      .toLowerCase();
    if (!referralCode) return;
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/affiliate/conversion"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ referral_code: referralCode })
        });
        if (res.ok) {
          localStorage.removeItem("referral_code");
        }
      } catch {
        /* non-blocking */
      }
    })();
  }, [location.search, session?.access_token]);

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
          <Route path="/group" element={<GroupCreateScreen session={session} />} />
          <Route path="/group/:shareCode" element={<GroupRoomScreen session={session} />} />
          <Route path="/leaderboard" element={<LeaderboardScreen session={session} />} />
          <Route path="/referrals" element={<ReferralLeaderboardScreen />} />
          <Route path="/affiliates" element={<AffiliatesPage />} />
          <Route path="/ref/:username" element={<RefLandingCapture />} />
          <Route path="/profile" element={<ProfileScreen session={session} />} />
          <Route path="/plans" element={<PlansScreen session={session} />} />
          <Route path="/login" element={<AuthScreen mode="login" />} />
          <Route path="/signup" element={<AuthScreen mode="signup" />} />
        </Routes>
      </Layout>
    </CommerceCurrencyProvider>
  );
}
