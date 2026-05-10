import { Link } from "react-router-dom";
import { DAILY_FREE_DECISION_LIMIT } from "./constants/freeTier.js";

export const SEO_LANDING_ROUTES = [
  {
    path: "/what-should-i-eat-tonight",
    metaTitle: "What Should I Eat Tonight? | Decide For Me — AI Food & Meal Ideas",
    metaDescription: `Stuck on dinner? Get one clear meal pick for tonight—takeout, cook-at-home, or quick bites—tailored to your mood. Tap to ask Decide For Me. Free tier: ${DAILY_FREE_DECISION_LIMIT} chat decisions per day.`,
    h1: "What should I eat tonight?",
    briefAnswer:
      "When every option sounds fine, you still need one winner. Decide For Me cuts through menu paralysis with a single, confident meal call—whether you want comfort food, something light, or the fastest route to full.",
    chatPrefill: "What should I eat tonight?"
  },
  {
    path: "/what-should-i-watch-tonight",
    metaTitle: "What Should I Watch Tonight? | Decide For Me — Shows & Movies",
    metaDescription: `End scroll fatigue. Get one decisive pick for film or TV tonight—genre to runtime—in seconds. Start with Decide For Me. Free tier: ${DAILY_FREE_DECISION_LIMIT} chat decisions per day.`,
    h1: "What should I watch tonight?",
    briefAnswer:
      "Streaming shouldn’t feel like homework. Tell your mood and time budget—Decide For Me names one film or series worth pressing play on, no endless browsing.",
    chatPrefill: "What should I watch tonight?"
  },
  {
    path: "/should-i-go-out-or-stay-in",
    metaTitle: "Should I Go Out or Stay In? | Decide For Me",
    metaDescription: `Energy low but FOMO high? Get a straight answer on going out vs staying in—and what to do either way. Ask Decide For Me. Free tier: ${DAILY_FREE_DECISION_LIMIT} chat decisions per day.`,
    h1: "Should I go out or stay in?",
    briefAnswer:
      "Both sides feel tempting until you’re exhausted deciding. Get a bold call based on how social you feel, what’s on tomorrow, and whether home actually sounds better tonight.",
    chatPrefill: "Should I go out or stay in?"
  },
  {
    path: "/what-workout-should-i-do-today",
    metaTitle: "What Workout Should I Do Today? | Decide For Me — Fitness Picks",
    metaDescription: `Pick a workout without opening five apps. One tailored session idea for today—time, intensity, and equipment optional. Try Decide For Me. Free tier: ${DAILY_FREE_DECISION_LIMIT} chat decisions per day.`,
    h1: "What workout should I do today?",
    briefAnswer:
      "Skip the generic plan lists. Whether you’ve got 15 minutes or a full gym slot, Decide For Me gives one concrete workout direction so you can move before motivation fades.",
    chatPrefill: "What workout should I do today?"
  }
];

export function SeoLandingPage({ config }) {
  const chatHref = `/?q=${encodeURIComponent(config.chatPrefill)}`;

  return (
    <section className="card premium seo-landing">
      <p className="hero-kicker">Decide For Me</p>
      <h1 className="seo-landing-title">{config.h1}</h1>
      <p className="answer seo-landing-lede">{config.briefAnswer}</p>
      <p className="meta seo-landing-free-cap">
        Guests and free accounts get {DAILY_FREE_DECISION_LIMIT} free chat decisions per day.
      </p>
      <div className="seo-landing-cta-row">
        <Link to={chatHref} className="primary-btn seo-landing-cta">
          Get my answer
        </Link>
        <Link to="/" className="ghost-btn seo-landing-secondary">
          Back to chat
        </Link>
      </div>
    </section>
  );
}
