import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { BarChart2, Clock, Flame, LogIn, MessageCircle, Trophy, User, Users } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiUrl = (path) => `${API_BASE_URL}${path}`;
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
    <div className={`share-row ${className}`.trim()}>
      <a className="share-btn wa" href={urls.whatsapp} target="_blank" rel="noreferrer">
        W
      </a>
      <a className="share-btn fb" href={urls.facebook} target="_blank" rel="noreferrer">
        f
      </a>
      <a className="share-btn x" href={urls.x} target="_blank" rel="noreferrer">
        X
      </a>
      <button
        className="share-btn copy"
        onClick={async () => {
          await copyText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "OK" : "C"}
      </button>
      <button className="share-btn native" onClick={nativeShare} disabled={!navigator.share}>
        S
      </button>
    </div>
  );
}

function Layout({ session, onSignOut, children }) {
  const desktopNavItems = [
    { to: "/", label: "Chat", icon: MessageCircle },
    { to: "/stats", label: "Stats", icon: BarChart2 },
    { to: "/group", label: "Group", icon: Users },
    { to: "/history", label: "History", icon: Clock },
    { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { to: "/profile", label: "Profile", icon: User }
  ];
  const mobileTabs = [
    { to: "/", label: "Chat", icon: MessageCircle },
    { to: "/group", label: "Group", icon: Users },
    { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
    { to: "/stats", label: "Stats", icon: BarChart2 },
    { to: "/profile", label: "Profile", icon: User }
  ];

  const loginItem = { to: "/login", label: "Login", icon: LogIn };
  const LoginIcon = loginItem.icon;

  return (
    <div className="app-shell page-enter">
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
      <nav className="mobile-tabbar" aria-label="Primary tabs">
        {mobileTabs.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}>
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
          prompt: `${dilemma.question}. Choose one option only: ${dilemma.option_a} or ${dilemma.option_b}.`
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
          <p className="answer">{majority}</p>
          <p className="meta">{loadingAi && !aiPick ? "AI verdict is loading..." : "AI verdict"}</p>
          {aiPick ? <p className="answer">{aiPick}</p> : null}
        </>
      ) : (
        <p className="meta">You can vote once today. Results unlock right after you vote.</p>
      )}
    </section>
  );
}

function ChatScreen({ session }) {
  const DAILY_FREE_LIMIT = 10;
  const LIFE_MODE_STORAGE_KEY = "decide_for_me_life_mode_session";
  const quickCategories = [
    { label: "🍕 Food", value: "Help me decide what to eat tonight." },
    { label: "🎬 Watch", value: "Help me choose what to watch tonight." },
    { label: "✈️ Travel", value: "Help me decide where to go for my next trip." },
    { label: "💪 Fitness", value: "Help me pick the best workout for today." }
  ];
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [conversation, setConversation] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liveCount, setLiveCount] = useState(0);
  const [learnedPreferences, setLearnedPreferences] = useState([]);
  const [totalDecisions, setTotalDecisions] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [showFirstTimeNote, setShowFirstTimeNote] = useState(false);
  const [dailyUsage, setDailyUsage] = useState(0);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [promptRef, setPromptRef] = useState(null);
  const [replyRef, setReplyRef] = useState(null);
  const [lifeModePromptOpen, setLifeModePromptOpen] = useState(false);
  const [lifeModeSession, setLifeModeSession] = useState(null);
  const [lifeModeCountdownLabel, setLifeModeCountdownLabel] = useState("");
  const [lifeModeGlobalCount, setLifeModeGlobalCount] = useState(0);
  const [lifeModeRecap, setLifeModeRecap] = useState(null);
  const [activatingLifeMode, setActivatingLifeMode] = useState(false);
  const [copiedLifeCaption, setCopiedLifeCaption] = useState(false);

  const todayKey = new Date().toISOString().slice(0, 10);
  const lifeModeCaption = "I let AI run my life for 24 hours at decideforme.org 🤖 here’s what happened…";

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
      const { count } = await supabase.from("decision_history").select("id", { count: "exact", head: true });
      setLiveCount(count || 0);
    };

    loadGlobalDecisionCount();
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setLearnedPreferences([]);
      setTotalDecisions(0);
      setDailyUsage(0);
      setShowUpgradePrompt(false);
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
        .select("total_decisions, current_streak")
        .eq("id", session.user.id)
        .single();
      setCurrentStreak(profile?.current_streak || 0);

      const { count: decisionHistoryTotal } = await supabase
        .from("decision_history")
        .select("id", { count: "exact", head: true });
      setTotalDecisions(decisionHistoryTotal || 0);

      const { data: usage } = await supabase
        .from("daily_usage")
        .select("decision_count")
        .eq("user_id", session.user.id)
        .eq("usage_date", todayKey)
        .single();
      const count = usage?.decision_count || 0;
      setDailyUsage(count);
      setShowUpgradePrompt(count >= DAILY_FREE_LIMIT);
    };

    loadPersonalization();
  }, [session?.user?.id, todayKey]);

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
        { maximumAge: 300000, timeout: 8000 }
      );
    });
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
    setLifeModePromptOpen(true);
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
    if (session?.user?.id && dailyUsage >= DAILY_FREE_LIMIT) {
      setShowUpgradePrompt(true);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    const userMessage = { role: "user", content };
    const updatedConversation = isInitial ? [userMessage] : [...conversation, userMessage];
    if (isInitial) setConversation([userMessage]);
    else setConversation(updatedConversation);

    try {
      const needsNearby = shouldUseNearby(content);
      let locationForRequest = userLocation;
      if (needsNearby && !locationForRequest) {
        locationForRequest = await requestUserLocation();
        if (locationForRequest) setUserLocation(locationForRequest);
      }

      const response = await fetch(apiUrl("/api/decide"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          conversation: updatedConversation,
          userLocation: locationForRequest,
          userPreferences: learnedPreferences.map((item) => item.preference),
          lifeMode: Boolean(lifeModeSession)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI failed.");
      const ensuredLifeModeAnswer =
        lifeModeSession && !String(data.answer || "").endsWith("No arguments. I've decided.")
          ? `${String(data.answer || "").trim()} No arguments. I've decided.`
          : data.answer;
      const aiMessage = { role: "assistant", content: ensuredLifeModeAnswer };
      const finalConversation = [...updatedConversation, aiMessage];
      setConversation(finalConversation);
      setRecommendations(Array.isArray(data.recommendations) ? data.recommendations : []);
      const changedMind = /actually|instead|not feeling|change/i.test(content) ? 1 : 0;
      setReply("");

      if (session?.user?.id && supabase) {
        const isFirstDecision = totalDecisions === 0;
        await supabase.from("decision_history").insert({
          user_id: session.user.id,
          category: "Natural language",
          mood: "Inferred tone",
          answer: ensuredLifeModeAnswer,
          conversation: finalConversation
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
            prompt: content,
            answer: ensuredLifeModeAnswer
          });
        }

        fetch(apiUrl("/api/extract-preferences"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation: finalConversation,
            answer: ensuredLifeModeAnswer
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
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card premium home-card">
      <div className="hero-glow" />
      <div className="hero-stack">
        <p className="hero-kicker">⚡ Decision intelligence</p>
        <h1 className="hero-title">Stop Overthinking. Just Decide.</h1>
        <p className="hero-subtitle">What do you need help deciding?</p>
      </div>
      <p className="social-proof">{liveCount.toLocaleString()} decisions made today</p>
      <p className="meta life-global-count">{lifeModeGlobalCount} people currently living AI-controlled lives 🎲</p>
      {session?.user?.id ? (
        <p className="meta usage-meter">
          Free plan: {dailyUsage}/{DAILY_FREE_LIMIT} decisions today
        </p>
      ) : null}
      {showFirstTimeNote ? (
        <p className="personalization-note">The more you use Decide For Me, the better it knows you.</p>
      ) : null}
      <div className="chat-divider" />

      {conversation.length || loading ? (
        <div className="chat-frame">
          {lifeModeSession ? (
            <article className="life-chat-banner">
              <p className="hero-kicker">Life Mode in control</p>
              <p className="answer">{lifeModeCountdownLabel || lifeModeCountdown(lifeModeSession.ends_at)} left</p>
            </article>
          ) : null}
          {conversation.map((msg, idx) => (
            <div key={idx} className={`message-row ${msg.role}`} style={{ animationDelay: `${idx * 45}ms` }}>
              <div className={`avatar ${msg.role}`}>{msg.role === "assistant" ? "⚡" : "U"}</div>
              <div className={`bubble ${msg.role}`}>
                {msg.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {loading ? <LoadingOrb /> : null}
        </div>
      ) : null}

      {!conversation.length ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!prompt.trim()) return;
            sendToAI(prompt.trim(), true);
          }}
        >
          <div className="input-row">
              <textarea
              ref={setPromptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
                className="decision-input"
              placeholder={
                showUpgradePrompt
                  ? "You've reached today's free limit. Upgrade for unlimited decisions."
                  : "What should I decide?"
              }
              disabled={showUpgradePrompt}
              rows={1}
            />
            <button className="send-btn" disabled={loading || showUpgradePrompt} aria-label="Send">
              →
            </button>
          </div>
        </form>
      ) : (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reply.trim()) return;
            sendToAI(reply.trim(), false);
          }}
        >
          <div className="suggestion-row">
            {["Not feeling it 👎", "Something cheaper 💰", "Give me a wild option 🎲"].map((text) => (
              <button
                key={text}
                type="button"
                className="suggestion-chip"
                onClick={() => setReply(text)}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="input-row">
              <textarea
              ref={setReplyRef}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
                className="decision-input"
              placeholder="Reply…"
              disabled={showUpgradePrompt}
              rows={1}
            />
            <button className="send-btn" disabled={loading || showUpgradePrompt} aria-label="Send">
              →
            </button>
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
        <article className="upgrade-panel">
          <p className="hero-kicker">Daily limit reached</p>
          <h3>You've used all 10 free decisions for today.</h3>
          <p className="muted">Upgrade to Plus or Pro for unlimited decisions, faster picks, and smarter personalization.</p>
          <Link to="/plans" className="primary-btn upgrade-cta">
            View plans
          </Link>
        </article>
      ) : null}
      {lifeModeRecap ? (
        <article className="life-recap-card">
          <p className="hero-kicker">Life Mode Recap</p>
          <h3>{lifeModeRecap.totalDecisions || 0} decisions in 24 hours</h3>
          <p className="muted">{lifeModeRecap.verdict}</p>
          <div className="history-list">
            {(lifeModeRecap.highlights || []).slice(0, 3).map((item, idx) => (
              <article key={`${item.created_at || idx}-${idx}`} className="history-item">
                <p className="meta">{new Date(item.created_at || Date.now()).toLocaleTimeString()}</p>
                <p>{item.prompt}</p>
                <p className="answer">{item.answer}</p>
              </article>
            ))}
          </div>
          <div className="life-share-row">
            <a
              className="share-btn wa"
              href={`https://wa.me/?text=${encodeURIComponent(`${lifeModeCaption}\n${lifeModeRecap.verdict}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              W
            </a>
            <a
              className="share-btn x"
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${lifeModeCaption}\n${lifeModeRecap.verdict}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              X
            </a>
            <button className="share-btn copy" type="button" onClick={copyLifeModeCaption}>
              {copiedLifeCaption ? "OK" : "IG"}
            </button>
            <button className="share-btn native" type="button" onClick={copyLifeModeCaption}>
              {copiedLifeCaption ? "OK" : "TT"}
            </button>
          </div>
        </article>
      ) : null}
      {!conversation.length ? (
        <div className="quick-category-row">
          {quickCategories.map((item) => (
            <button key={item.label} type="button" className="quick-category-pill" onClick={() => setPrompt(item.value)}>
              {item.label}
            </button>
          ))}
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
        <SharePanel text={`Decide For Me: ${conversation[conversation.length - 1].content}`} />
      ) : null}
      {recommendations.length ? (
        <div className="recommendations-wrap">
          {recommendations.map((item) => (
            <article key={item.name} className="recommend-card">
              <div className="recommend-image-wrap">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="recommend-image" />
                ) : (
                  <div className="recommend-image placeholder">No image</div>
                )}
              </div>
              <div className="recommend-body">
                <h4>{item.name}</h4>
                <p className="meta">
                  {item.rating ? `⭐ ${item.rating}` : "⭐ New"} {item.distance ? `· ${item.distance}` : ""}
                </p>
                <p>{item.description}</p>
                <div className="recommend-actions">
                  <a className="ghost-btn" href={item.mapsUrl} target="_blank" rel="noreferrer">
                    View on Google Maps
                  </a>
                  <a className="primary-btn" href={item.actionUrl} target="_blank" rel="noreferrer">
                    Book / Order
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
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
      {room.final_answer ? <p className="answer">{room.final_answer}</p> : null}
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
    <section className="card premium leaderboard-card">
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

function ProfileScreen({ session }) {
  const [profile, setProfile] = useState(null);
  const [referrals, setReferrals] = useState([]);
  const [preferences, setPreferences] = useState([]);

  const loadProfile = async () => {
    if (!supabase || !session?.user?.id) return;
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    setProfile(profileData);
    const { data: refData } = await supabase
      .from("referrals")
      .select("*")
      .eq("referrer_id", session.user.id);
    setReferrals(refData ?? []);
    const { data: preferenceRows } = await supabase
      .from("user_preferences")
      .select("id, preference")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false });
    setPreferences(preferenceRows ?? []);
  };

  useEffect(() => {
    loadProfile();
  }, [session?.user?.id]);

  if (!session) return <Navigate to="/login" replace />;
  const referralLink = profile?.referral_code
    ? `${window.location.origin}/signup?ref=${profile.referral_code}`
    : "";
  const removePreference = async (id) => {
    if (!supabase || !id) return;
    await supabase.from("user_preferences").delete().eq("id", id).eq("user_id", session.user.id);
    setPreferences((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <section className="card">
      <h1>Profile</h1>
      <p className="meta">{session.user.email}</p>
      <p>Bonus decisions: {profile?.bonus_decisions || 0}</p>
      <p>Total decisions: {profile?.total_decisions || 0}</p>
      <p className="answer">🔥 Streak: {profile?.current_streak || 0} days</p>
      <p className="meta">Longest streak: {profile?.longest_streak || 0} days</p>
      {referralLink ? (
        <>
          <p className="muted">Referral link</p>
          <p className="answer">{referralLink}</p>
          <SharePanel text={referralLink} />
        </>
      ) : null}
      <p className="muted">Referrals earned: {referrals.length}</p>
      <article className="history-item ai-profile-card">
        <p className="hero-kicker">Your AI knows you</p>
        <p className="muted">Everything your assistant has learned from your decisions, so future advice is instantly personal.</p>
        {preferences.length ? (
          <div className="learned-preferences">
            {preferences.map((item) => (
              <div key={item.id} className="learned-preference-item">
                <p>{item.preference}</p>
                <button
                  type="button"
                  className="pref-remove-btn"
                  aria-label={`Remove preference ${item.preference}`}
                  onClick={() => removePreference(item.id)}
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

function AuthScreen({ mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const ref = query.get("ref");
    if (ref) localStorage.setItem("pending_referral_code", ref);
  }, [location.search]);

  const ensureProfileAndReferral = async (user) => {
    if (!supabase || !user?.id) return;
    const referralCode = crypto.randomUUID().slice(0, 8);
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        username: user.email?.split("@")[0],
        referral_code: referralCode
      },
      { onConflict: "id" }
    );

    const pending = localStorage.getItem("pending_referral_code");
    if (!pending) return;
    const { data: referrer } = await supabase
      .from("profiles")
      .select("id")
      .eq("referral_code", pending)
      .single();
    if (!referrer?.id || referrer.id === user.id) return;

    await supabase.from("referrals").upsert(
      {
        referrer_id: referrer.id,
        referred_id: user.id
      },
      { onConflict: "referred_id" }
    );

    await supabase.rpc("grant_referral_bonus", {
      p_referrer_id: referrer.id,
      p_referred_id: user.id
    });
    localStorage.removeItem("pending_referral_code");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
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
        <button className="primary-btn" disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function PlansScreen() {
  const plans = useMemo(
    () => [
      { title: "Plus", price: "£4.99", stripePriceId: import.meta.env.VITE_STRIPE_PRICE_PLUS_ID },
      { title: "Pro", price: "£9.99", stripePriceId: import.meta.env.VITE_STRIPE_PRICE_PRO_ID }
    ],
    []
  );

  return (
    <section className="card">
      <h1>Plans</h1>
      <div className="plans-grid">
        {plans.map((plan) => (
          <article key={plan.title} className="plan-card">
            <h3>{plan.title}</h3>
            <p className="plan-price">{plan.price}/month</p>
            <p className="muted">7-day trial</p>
            <button className="primary-btn">Start</button>
          </article>
        ))}
      </div>
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

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <Layout session={session} onSignOut={signOut}>
      {!isSupabaseConfigured ? (
        <section className="card">
          <h1>Setup required</h1>
          <p className="error">Set Supabase env values in `.env` and refresh.</p>
        </section>
      ) : null}
      <Routes>
        <Route path="/" element={<ChatScreen session={session} />} />
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
        <Route path="/profile" element={<ProfileScreen session={session} />} />
        <Route path="/plans" element={<PlansScreen />} />
        <Route path="/login" element={<AuthScreen mode="login" />} />
        <Route path="/signup" element={<AuthScreen mode="signup" />} />
      </Routes>
    </Layout>
  );
}
