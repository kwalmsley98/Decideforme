import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const apiUrl = (path) => `${API_BASE_URL}${path}`;

const CATEGORIES = [
  "Food",
  "Travel",
  "What to watch",
  "Weekend activity",
  "Fitness",
  "Shopping"
];

const MOODS = ["Chill", "Bold", "Focused", "Adventurous", "Low-energy", "Spontaneous"];

function Layout({ session, onSignOut, children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Decide For Me
        </Link>
        <nav className="nav-links">
          <Link to="/">Home</Link>
          <Link to="/history">History</Link>
          <Link to="/plans">Plans</Link>
          {session ? (
            <button className="ghost-btn" onClick={onSignOut}>
              Logout
            </button>
          ) : (
            <Link to="/login">Login</Link>
          )}
        </nav>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

function ProtectedRoute({ session, children }) {
  if (!isSupabaseConfigured) return <Navigate to="/" replace />;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function HomeScreen({ selectedCategory, setSelectedCategory }) {
  const navigate = useNavigate();
  return (
    <section className="card">
      <h1>Pick a category</h1>
      <p className="muted">Choose what you want help deciding.</p>
      <div className="chip-grid">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            className={`chip ${selectedCategory === category ? "active" : ""}`}
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <button
        className="primary-btn"
        onClick={() => navigate("/mood")}
        disabled={!selectedCategory}
      >
        Continue to mood
      </button>
    </section>
  );
}

function MoodScreen({ selectedCategory, selectedMood, setSelectedMood }) {
  const navigate = useNavigate();

  if (!selectedCategory) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="card">
      <h1>How are you feeling?</h1>
      <p className="muted">
        Category: <strong>{selectedCategory}</strong>
      </p>
      <div className="chip-grid">
        {MOODS.map((mood) => (
          <button
            key={mood}
            className={`chip ${selectedMood === mood ? "active" : ""}`}
            onClick={() => setSelectedMood(mood)}
          >
            {mood}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="ghost-btn" onClick={() => navigate("/")}>
          Back
        </button>
        <button className="primary-btn" onClick={() => navigate("/answer")} disabled={!selectedMood}>
          Get AI decision
        </button>
      </div>
    </section>
  );
}

function AnswerScreen({ session, selectedCategory, selectedMood, latestAnswer, setLatestAnswer }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canRequest = Boolean(selectedCategory && selectedMood);

  useEffect(() => {
    if (!canRequest || latestAnswer) return;

    const fetchDecision = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(apiUrl("/api/decide"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: selectedCategory,
            mood: selectedMood
          })
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Failed to get decision.");
        }

        const data = await response.json();
        setLatestAnswer(data.answer);

        if (session?.user?.id) {
          await supabase.from("decision_history").insert({
            user_id: session.user.id,
            category: selectedCategory,
            mood: selectedMood,
            answer: data.answer
          });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDecision();
  }, [canRequest, latestAnswer, selectedCategory, selectedMood, setLatestAnswer, session]);

  if (!canRequest) return <Navigate to="/" replace />;

  return (
    <section className="card">
      <h1>AI says:</h1>
      <p className="muted">
        {selectedCategory} + {selectedMood}
      </p>
      {loading ? <p className="muted">Thinking confidently...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {latestAnswer ? <p className="answer">{latestAnswer}</p> : null}
      <div className="row">
        <Link className="ghost-btn link-btn" to="/">
          Start over
        </Link>
        <Link className="primary-btn link-btn" to="/history">
          View history
        </Link>
      </div>
    </section>
  );
}

function HistoryScreen({ session }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError("Supabase is not configured.");
      return;
    }

    const loadHistory = async () => {
      setLoading(true);
      setError("");
      const { data, error: fetchError } = await supabase
        .from("decision_history")
        .select("id, category, mood, answer, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setHistory(data ?? []);
      }
      setLoading(false);
    };

    loadHistory();
  }, [session.user.id]);

  return (
    <section className="card">
      <h1>Your history</h1>
      {loading ? <p className="muted">Loading past decisions...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !history.length ? (
        <p className="muted">No decisions yet. Generate one from Home.</p>
      ) : null}
      <div className="history-list">
        {history.map((item) => (
          <article key={item.id} className="history-item">
            <p className="meta">
              {item.category} · {item.mood}
            </p>
            <p>{item.answer}</p>
            <p className="meta">{new Date(item.created_at).toLocaleString()}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function AuthScreen({ mode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const title = mode === "login" ? "Login" : "Sign up";

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isSupabaseConfigured || !supabase) {
      setError("Set valid Supabase env values first, then refresh.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");

    const action =
      mode === "login"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });

    const { error: authError } = await action;
    if (authError) {
      setError(authError.message);
    } else {
      setMessage(mode === "signup" ? "Account created. Check your email to verify." : "Logged in.");
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <section className="card auth-card">
      <h1>{title}</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>
        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? "Please wait..." : title}
        </button>
      </form>
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <p className="muted">
        {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
        <button
          className="inline-btn"
          onClick={() => navigate(mode === "login" ? "/signup" : "/login")}
        >
          {mode === "login" ? "Sign up" : "Login"}
        </button>
      </p>
    </section>
  );
}

function SubscriptionCard({ title, price, stripePriceId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const checkout = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/create-checkout-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripePriceId })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Checkout failed.");
      window.location.assign(data.url);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <article className="plan-card">
      <h3>{title}</h3>
      <p className="plan-price">{price}/month</p>
      <p className="muted">Includes 7-day free trial.</p>
      <button className="primary-btn" onClick={checkout} disabled={loading}>
        {loading ? "Redirecting..." : "Start free trial"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}

function PlansScreen() {
  const plans = useMemo(
    () => [
      {
        title: "Plus",
        price: "£4.99",
        stripePriceId: import.meta.env.VITE_STRIPE_PRICE_PLUS_ID
      },
      {
        title: "Pro",
        price: "£9.99",
        stripePriceId: import.meta.env.VITE_STRIPE_PRICE_PRO_ID
      }
    ],
    []
  );

  return (
    <section className="card">
      <h1>Choose your plan</h1>
      <div className="plans-grid">
        {plans.map((plan) => (
          <SubscriptionCard key={plan.title} {...plan} />
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMood, setSelectedMood] = useState("");
  const [latestAnswer, setLatestAnswer] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setLatestAnswer("");
  }, [selectedCategory, selectedMood]);

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <Layout session={session} onSignOut={signOut}>
      {!isSupabaseConfigured ? (
        <section className="card">
          <h1>Setup required</h1>
          <p className="error">
            Add valid values for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in `.env`, then refresh.
          </p>
        </section>
      ) : null}
      <Routes>
        <Route
          path="/"
          element={
            <HomeScreen selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} />
          }
        />
        <Route
          path="/mood"
          element={
            <MoodScreen
              selectedCategory={selectedCategory}
              selectedMood={selectedMood}
              setSelectedMood={setSelectedMood}
            />
          }
        />
        <Route
          path="/answer"
          element={
            <AnswerScreen
              session={session}
              selectedCategory={selectedCategory}
              selectedMood={selectedMood}
              latestAnswer={latestAnswer}
              setLatestAnswer={setLatestAnswer}
            />
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
        <Route path="/login" element={<AuthScreen mode="login" />} />
        <Route path="/signup" element={<AuthScreen mode="signup" />} />
        <Route path="/plans" element={<PlansScreen />} />
      </Routes>
    </Layout>
  );
}
