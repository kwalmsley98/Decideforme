/** Life Mode — relatable viral “brutally honest best friend” commands + social roast mechanics */

export const LIFE_CODENAMES = ["COMMANDER", "ORACLE", "THE DECIDER"];

export function pickCodename() {
  return LIFE_CODENAMES[Math.floor(Math.random() * LIFE_CODENAMES.length)];
}

/** @typedef {'morning'|'midday'|'afternoon'|'evening'|'night'} DayPhase */

export function getUserTimeZone(timeZone) {
  if (typeof timeZone === "string" && timeZone.trim()) return timeZone.trim();
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function getLocalHourInTimeZone(date = new Date(), timeZone) {
  const tz = getUserTimeZone(timeZone);
  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "numeric",
      hour12: false
    });
    const parts = dtf.formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    if (hourPart) return parseInt(hourPart.value, 10);
  } catch {
    /* fall through */
  }
  return date.getHours();
}

export function getLocalClockParts(date = new Date(), timeZone) {
  const tz = getUserTimeZone(timeZone);
  try {
    const dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    const parts = dtf.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return { hour, minute, timeZone: tz };
  } catch {
    return { hour: date.getHours(), minute: date.getMinutes(), timeZone: tz };
  }
}

export function formatLocalTimeShort(date = new Date(), timeZone) {
  const tz = getUserTimeZone(timeZone);
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
}

function wallClockHHMM(hour, minute = 0) {
  const h = Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)));
  const m = Math.max(0, Math.min(59, Math.floor(Number(minute) || 0)));
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

/**
 * Morning → midday → afternoon → evening → night (late / wind-down).
 */
export function getDayPhase(hour) {
  if (hour >= 22 || hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function getDayPhaseForNow(now = new Date(), timeZone) {
  return getDayPhase(getLocalHourInTimeZone(now, timeZone));
}

export async function fetchOpenMeteoCurrent(lat, lng, timeZone) {
  try {
    const tz = getUserTimeZone(timeZone);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=${encodeURIComponent(
      tz
    )}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    if (typeof code !== "number") return null;
    const rainy =
      (code >= 51 && code <= 67) ||
      (code >= 80 && code <= 82) ||
      code === 95 ||
      code === 96 ||
      code === 99;
    return {
      tempC: typeof t === "number" ? t : null,
      weatherCode: code,
      isRainy: rainy
    };
  } catch {
    return null;
  }
}

/**
 * @param {'gentle'|'strict'|'brutal'} intensity
 */
export function tone(intensity, lines) {
  if (intensity === "gentle") return lines.gentle;
  if (intensity === "strict") return lines.strict;
  return lines.brutal;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Demo-style community split (deterministic, sums to 100). Illustrative — not live aggregate data. */
export function communitySplitForResponses(commandId, responseIds) {
  const ids = [...responseIds];
  if (!ids.length) return {};
  const weights = ids.map((rid, idx) => {
    const s = hashSeed(`${commandId}:${rid}`);
    return 18 + (s % 28) + idx * 2;
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  ids.forEach((rid, i) => {
    out[rid] = Math.round((100 * weights[i]) / sum);
  });
  let diff = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  const maxId = ids.reduce((best, rid) => (out[rid] >= out[best] ? rid : best), ids[0]);
  out[maxId] += diff;
  return out;
}

const CHECK_INS = [
  "Just checking you're not still on the sofa. You are, aren't you.",
  "Blink twice if you're pretending to work while scrolling.",
  "Hydrate. Or don't. I've seen your search history — you know what thirst looks like.",
  "Your posture right now? Criminal. Sit up. Yes, I'm watching.",
  "Put the phone down for sixty seconds. I'll wait. …You didn't, did you."
];

export function pickCheckIn(seed = 0) {
  return CHECK_INS[Math.abs(seed) % CHECK_INS.length];
}

export function globalFeedLines() {
  return [
    "Live vibe: 68% of people picked ‘just one episode’ today. The couch won.",
    "Community bulletin: ‘same lunch again’ is leading by a landslide.",
    "Breaking: 81% chose denial before noon. You’re not alone — you’re consistent.",
    "Global mood: fridge tourism is up 40%. Nothing new inside. Same as yesterday.",
    "Trending excuse: ‘I'll read after this.’ Nobody did. Love that for us."
  ];
}

export function buildLifeModeCommandRequestPayload(setup, now = new Date(), timeZone) {
  const tz = getUserTimeZone(timeZone);
  const hour = getLocalHourInTimeZone(now, tz);
  const { minute } = getLocalClockParts(now, tz);
  return {
    timeZone: tz,
    localHour: hour,
    localMinute: minute,
    phase: getDayPhase(hour),
    setup,
    isoTimestamp: now.toISOString()
  };
}

export function computeCompliancePercent(completedMap, orders) {
  if (!orders?.length) return 100;
  let done = 0;
  for (const o of orders) {
    if (completedMap[o.id]) done += 1;
  }
  return Math.round((done / orders.length) * 100);
}

/** Engagement = ticked OR picked a response (memory hooks excluded). */
export function computeEngagementPercent(completedMap, responseMap, orders) {
  const actionable = (orders || []).filter((o) => !o.isMemoryHook && Array.isArray(o.responses) && o.responses.length > 0);
  if (!actionable.length) return 100;
  let done = 0;
  for (const o of actionable) {
    if (responseMap?.[o.id]?.responseId || completedMap[o.id]) done += 1;
  }
  return Math.round((done / actionable.length) * 100);
}

function weatherSnip(weather, intensity) {
  const rain = weather?.isRainy;
  const cold = typeof weather?.tempC === "number" && weather.tempC < 8;
  if (rain) {
    return tone(intensity, {
      gentle: "It's gross out — you're still walking. Umbrella optional, excuses aren't.",
      strict: "Rain isn't a personality trait. Move anyway.",
      brutal: "Sky's crying. You're about to cry about cardio. Both are happening."
    });
  }
  if (cold) {
    return tone(intensity, {
      gentle: "Cold air counts as therapy if you actually step outside.",
      strict: "Layers on. Drama off.",
      brutal: "It's freezing. You'll survive — you've survived worse choices."
    });
  }
  return tone(intensity, {
    gentle: "Weather's fine. Your screen time isn't.",
    strict: "Sun's out. Pretend you're a functional adult.",
    brutal: "Nice day out there. Shame you're mostly seeing it through a window."
  });
}

/**
 * @param {{ wakeHour: number, dayType: 'work'|'rest', energy: 'low'|'medium'|'high', intensity: 'gentle'|'strict'|'brutal', codename: string }} setup
 * @param {DayPhase} phase
 * @param {{ memoryLines?: string[] }} ctx
 */
export function buildLifeOrders({ setup, phase, weather, rankName: _rankName, operatorName = "Operator", memoryLines = [] }) {
  const { wakeHour, dayType, energy, intensity, codename } = setup;
  const In = intensity;
  const slot = (h, min = 0) => wallClockHHMM(h, min);
  const mem = Array.isArray(memoryLines) ? memoryLines.filter(Boolean) : [];

  const orders = [];

  const pushMemoryHooks = () => {
    for (let i = 0; i < Math.min(2, mem.length); i++) {
      orders.push({
        id: `mem-${phase}-${i}`,
        timeLabel: slot(Math.min(23, wakeHour + i), 0),
        text: mem[i],
        phase,
        isMemoryHook: true,
        responses: []
      });
    }
  };

  if (phase === "morning") {
    pushMemoryHooks();
    orders.push({
      id: "mo_alarm",
      timeLabel: slot(wakeHour, 0),
      text: tone(In, {
        gentle: `Your alarm went off four times. The fifth won't feel different — but getting up will.`,
        strict: `Your alarm went off four times. The fifth one won't magically feel better. Get up.`,
        brutal: `07:00 — Your alarm went off 4 times. The fifth won't be different. Get up.`
      }),
      phase,
      responses: [
        {
          id: "snooze",
          emoji: "😴",
          label: "Just one more snooze",
          instantRoast: tone(In, {
            gentle: "That's what you said last time. I'm keeping score gently.",
            strict: "Snooze is just denial with a ringtone.",
            brutal: "Snooze is just procrastination that pays rent to your anxiety."
          }),
          laterRoast: tone(In, {
            gentle: "Still horizontal? Thought we'd talked about this.",
            strict: "It's been an hour. You're awake enough to doomscroll — try vertical.",
            brutal: "You've been 'almost up' since dawn. Pick a lane."
          }),
          fireLaterInPhase: "midday",
          excuseTag: "snooze_chain"
        },
        {
          id: "up",
          emoji: "✅",
          label: "Fine I'm up",
          instantRoast: tone(In, {
            gentle: "Love that energy. Don't waste it on your inbox.",
            strict: "Words are cheap. Coffee's expensive. Move.",
            brutal: "Prove it — shoes on before you open TikTok."
          }),
          excuseTag: "compliant_morning"
        },
        {
          id: "five",
          emoji: "⏱️",
          label: "Five minutes — I mean it",
          instantRoast: tone(In, {
            gentle: "Sure. I've heard that fairy tale before.",
            strict: "Five minutes is how lies stay cozy.",
            brutal: "Five minutes is how every bad day starts."
          }),
          fireLaterInPhase: "midday",
          laterRoast: tone(In, {
            gentle: "Those five minutes became thirty. I'm not mad — I'm tired on your behalf.",
            strict: "Your five minutes graduated to an hour. Proud parent moment.",
            brutal: "It's been an era since ‘five minutes.’ Clock called — it's embarrassed."
          }),
          excuseTag: "five_minute_lie"
        }
      ]
    });

    orders.push({
      id: "mo_fuel",
      timeLabel: slot(9, 0),
      text: tone(In, {
        gentle:
          energy === "low"
            ? "Breakfast isn't negotiable today — your brain already negotiated enough yesterday."
            : "Eat something that isn't regret-shaped.",
        strict: "You're about to skip breakfast and pretend cold brew counts as food.",
        brutal: "09:00 — You've opened the delivery app twice with nothing in the cart. Eat something real."
      }),
      phase,
      responses: [
        {
          id: "same_bagel",
          emoji: "🥯",
          label: "Same thing as always",
          instantRoast: tone(In, {
            gentle: "Consistency is cute until it's culinary beige.",
            strict: "At least own the ritual.",
            brutal: "Same order, same story — you're in a food sequel nobody asked for."
          }),
          excuseTag: "same_order"
        },
        {
          id: "healthy_lie",
          emoji: "🥗",
          label: "I'll grab something healthy later",
          instantRoast: tone(In, {
            gentle: "'Later' is where salads go to die.",
            strict: "Later is fantasy brunch.",
            brutal: "Later is where discipline goes to nap forever."
          }),
          excuseTag: "later_never"
        },
        {
          id: "skip",
          emoji: "☕",
          label: "Coffee is breakfast",
          instantRoast: tone(In, {
            gentle: "Bold strategy for someone who gets cranky before noon.",
            strict: "Coffee isn't a meal — it's anxiety hot sauce.",
            brutal: "That's not breakfast — that's cope with foam."
          }),
          excuseTag: "coffee_meal"
        }
      ]
    });

    orders.push({
      id: "mo_work",
      timeLabel: slot(10, 30),
      text:
        dayType === "work"
          ? tone(In, {
              gentle: "You're about to ‘quickly check’ messages and lose the morning. Close the tab before it closes on you.",
              strict: "First hour decides your whole day — stop negotiating with your inbox.",
              brutal: "You're one tab away from pretending Slack is priority one."
            })
          : tone(In, {
              gentle: "Rest day doesn't mean couch-shaped recovery only.",
              strict: "‘Chill day’ isn't code for zero sunlight.",
              brutal: "Rest isn't hibernation — leave the cave eventually."
            }),
      phase,
      responses: [
        {
          id: "peek",
          emoji: "📧",
          label: "I'll just peek at email",
          instantRoast: tone(In, {
            gentle: "Peek becomes plunge in three taps.",
            strict: "That's not a peek — that's a hostage situation.",
            brutal: "‘Peek’ is how professionals become amateur responders."
          }),
          excuseTag: "email_peek"
        },
        {
          id: "deep",
          emoji: "🎯",
          label: "Deep work mode — for real",
          instantRoast: tone(In, {
            gentle: "I'll believe it when Do Not Disturb survives ten minutes.",
            strict: "Prove it — notifications off, ego on.",
            brutal: "Deep work until your first notification — so, forty seconds?"
          }),
          excuseTag: "deep_work"
        },
        {
          id: "later_work",
          emoji: "🕐",
          label: "I'll start after lunch",
          instantRoast: tone(In, {
            gentle: "Lunch isn't going to invent motivation for you.",
            strict: "Afternoon-you doesn't trust morning-you — why should I?",
            brutal: "Later-you is tired-you — we've met them. They're chaotic."
          }),
          fireLaterInPhase: "midday",
          laterRoast: tone(In, {
            gentle: "It's past lunch. Still waiting on that heroic start?",
            strict: "You said after lunch. Lunch happened. Where's the hero arc?",
            brutal: "It's been three hours since ‘after lunch.’ That's not a plan — that's avoidance cosplay."
          }),
          excuseTag: "after_lunch"
        }
      ]
    });

    if (weather) {
      orders.push({
        id: "mo_weather",
        timeLabel: slot(11, 0),
        text: weatherSnip(weather, In),
        phase,
        responses: [
          {
            id: "walk_ok",
            emoji: "🚶",
            label: "I'll walk — relax",
            instantRoast: tone(In, {
              gentle: "Okay walker — actually loop the block once.",
              strict: "Walk counts when you're not narrating it.",
              brutal: "Walk — don't rehearse the podcast you're gonna quote."
            }),
            excuseTag: "walk_promise"
          },
          {
            id: "inside",
            emoji: "🏠",
            label: "I'll skip today — weather",
            instantRoast: tone(In, {
              gentle: "Weather's moody — your discipline doesn't get to be.",
              strict: "Sky drama isn't your excuse drawer.",
              brutal: "Blame the clouds — bold move from someone avoiding stairs."
            }),
            excuseTag: "weather_skip"
          },
          {
            id: "gym_lie",
            emoji: "🏋️",
            label: "Gym later instead",
            instantRoast: tone(In, {
              gentle: "Later-gym is imaginary gym.",
              strict: "Later is where memberships go to meditate.",
              brutal: "‘Gym later’ — spoken like someone who's never met evening-you."
            }),
            excuseTag: "gym_later"
          }
        ]
      });
    }
  } else if (phase === "midday") {
    pushMemoryHooks();
    orders.push({
      id: "md_lunch",
      timeLabel: slot(12, 0),
      text: tone(In, {
        gentle: "You're about to order the same thing you always order. At least own it.",
        strict: "12:00 — Same lunch roulette — pick intentionally or stop pretending it's accidental.",
        brutal: "12:00 — You're about to order the same thing you always order. At least own it."
      }),
      phase,
      responses: [
        {
          id: "same_ok",
          emoji: "🍜",
          label: "It's my comfort order",
          instantRoast: tone(In, {
            gentle: "Comfort's fine — boredom dressed as loyalty isn't.",
            strict: "Comfort became routine — admit it.",
            brutal: "Comfort food — cute until it's just autopilot carbs."
          }),
          excuseTag: "comfort_order"
        },
        {
          id: "try_new",
          emoji: "✨",
          label: "Fine — I'll try something new",
          instantRoast: tone(In, {
            gentle: "I'll hold you to two bites before panic-scroll.",
            strict: "New means ordered — not bookmarked.",
            brutal: "Try new — then send pics or it didn't happen."
          }),
          excuseTag: "try_new_food"
        },
        {
          id: "skip_lunch",
          emoji: "⏭️",
          label: "I'll eat later",
          instantRoast: tone(In, {
            gentle: "'Later' is how humans become hangry gremlins.",
            strict: "Later-you hates present-you — feed yourself.",
            brutal: "Skipping lunch isn't discipline — it's chaos loading."
          }),
          excuseTag: "skip_lunch"
        }
      ]
    });

    orders.push({
      id: "md_scroll",
      timeLabel: slot(13, 30),
      text: tone(In, {
        gentle: "That ‘five-minute break’ has lasted longer than some relationships.",
        strict: "Midday scroll isn't self-care — it's procrastination with better branding.",
        brutal: "You're refreshing feeds like answers live between posts."
      }),
      phase,
      responses: [
        {
          id: "research",
          emoji: "📱",
          label: "It's research",
          instantRoast: tone(In, {
            gentle: "Cool dissertation on strangers' lunches.",
            strict: "Research requires citations — not reels.",
            brutal: "Research — bold word for gossip tourism."
          }),
          excuseTag: "research_lie"
        },
        {
          id: "stop",
          emoji: "🛑",
          label: "Okay phone goes away",
          instantRoast: tone(In, {
            gentle: "Drop it like it's accountability.",
            strict: "Face-down means face-down.",
            brutal: "Put it down — your thumb needs joint custody."
          }),
          excuseTag: "phone_down"
        },
        {
          id: "one_more",
          emoji: "👀",
          label: "One more scroll",
          instantRoast: tone(In, {
            gentle: "One more always borrows time from future-you.",
            strict: "‘One more’ is three episodes long.",
            brutal: "One more — famous last words before noon vanished."
          }),
          fireLaterInPhase: "afternoon",
          laterRoast: tone(In, {
            gentle: "Still scrolling? Your future called — it wants its afternoon back.",
            strict: "It's been an hour. ‘One more’ aged poorly.",
            brutal: "It's been three loops. I'm not angry — I'm disappointed."
          }),
          excuseTag: "one_more_scroll"
        }
      ]
    });
  } else if (phase === "afternoon") {
    pushMemoryHooks();
    orders.push({
      id: "af_fridge",
      timeLabel: slot(15, 30),
      text: tone(In, {
        gentle: "You've opened the fridge three times in an hour. Nothing new appeared — except denial.",
        strict: "Fridge tourism isn't a hobby — eat or close the door.",
        brutal: "You've opened the fridge three times — still nothing new in there. The cucumber didn't spawn."
      }),
      phase,
      responses: [
        {
          id: "bored",
          emoji: "🫠",
          label: "I'm bored not hungry",
          instantRoast: tone(In, {
            gentle: "Boredom snacks are still invoices.",
            strict: "Bored isn't hungry — it's avoidance munching.",
            brutal: "You're not hungry — you're understimulated and loud about it."
          }),
          excuseTag: "bored_snack"
        },
        {
          id: "hydrate",
          emoji: "💧",
          label: "Hydrating actually",
          instantRoast: tone(In, {
            gentle: "Water doesn't live on the cheese shelf — nice try.",
            strict: "Hydration doesn't require dramatic fridge lighting.",
            brutal: "That's not hydration — that's staged browsing."
          }),
          excuseTag: "hydrate_lie"
        },
        {
          id: "fine",
          emoji: "🙃",
          label: "Okay that hurt",
          instantRoast: tone(In, {
            gentle: "Truth stings less than regret carbs.",
            strict: "Pain means we're learning — shut the fridge.",
            brutal: "Good — carry that shame to a salad."
          }),
          excuseTag: "called_out"
        }
      ]
    });

    orders.push({
      id: "af_meeting",
      timeLabel: slot(16, 0),
      text: tone(In, {
        gentle: `That meeting could've been shorter — ${operatorName}, we both knew it.`,
        strict: "Afternoon calendar guilt — address it before it schedules tomorrow.",
        brutal: "Another meeting that could've been a paragraph — iconic."
      }),
      phase,
      responses: [
        {
          id: "had_to",
          emoji: "📅",
          label: "I had to be there",
          instantRoast: tone(In, {
            gentle: "Mandatory drama — noted.",
            strict: "Presence isn't productivity.",
            brutal: "You had to be there — your soul didn't get the memo."
          }),
          excuseTag: "mandatory_meeting"
        },
        {
          id: "mute",
          emoji: "🔇",
          label: "I was on mute recovering",
          instantRoast: tone(In, {
            gentle: "Mute therapy — expensive use of company time.",
            strict: "Mute isn't healing — it's hiding.",
            brutal: "Mute mode isn't wellness — it's avoidance with Wi‑Fi."
          }),
          excuseTag: "mute_recovery"
        },
        {
          id: "zoom_fatigue",
          emoji: "😵",
          label: "Brain fried — exempt",
          instantRoast: tone(In, {
            gentle: "Fried brain still makes choices — pick gentler ones.",
            strict: "Fatigue isn't a hall pass for chaos snacks.",
            brutal: "Brain fried — bold coming from someone still scrolling."
          }),
          excuseTag: "brain_fried"
        }
      ]
    });
  } else if (phase === "evening") {
    pushMemoryHooks();
    orders.push({
      id: "ev_netflix",
      timeLabel: slot(19, 0),
      text: tone(In, {
        gentle: "You're about to promise ‘just one episode.’ Name one time that stayed honest.",
        strict: "Evening-you loves bargaining — prove daytime-you wrong tonight.",
        brutal: "Netflix knows your password — I know your patterns."
      }),
      phase,
      responses: [
        {
          id: "one_ep",
          emoji: "😔",
          label: "I just need one episode",
          instantRoast: tone(In, {
            gentle: "One episode — adorable fiction.",
            strict: "One episode is how seasons happen.",
            brutal: "One episode — famous opening lie of every binge."
          }),
          fireLaterInPhase: "night",
          laterRoast: tone(In, {
            gentle: "It's been three episodes. I'm not angry — I'm just disappointed.",
            strict: "Episode three — still ‘just one’? Cute.",
            brutal: "It's been three episodes. I'm not angry — I'm keeping receipts."
          }),
          excuseTag: "one_episode"
        },
        {
          id: "reading",
          emoji: "🤥",
          label: "I'm definitely reading after this",
          instantRoast: tone(In, {
            gentle: "Your bookshelf heard that — it laughed gently.",
            strict: "Reading after TV is fairy tale scheduling.",
            brutal: "Reading after this — the book filed for emotional damage."
          }),
          fireLaterInPhase: "night",
          laterRoast: tone(In, {
            gentle: "You said you'd read tonight. We're checking in — how many pages?",
            strict: "Reading night update: zero pages. Bold.",
            brutal: "You said you'd read. The spine is still mint condition."
          }),
          excuseTag: "read_later"
        },
        {
          id: "book_boring",
          emoji: "💀",
          label: "The book was boring anyway",
          instantRoast: tone(In, {
            gentle: "Plot twist — discipline isn't supposed to entertain you.",
            strict: "Boring book > zero pages.",
            brutal: "Blame the book — convenient villain energy."
          }),
          excuseTag: "book_boring"
        }
      ]
    });

    orders.push({
      id: "ev_night_lie",
      timeLabel: slot(20, 30),
      text: tone(In, {
        gentle: "You said you'd have an early night. It's now 20:30 — we both know you're negotiating.",
        strict: "Early night promises don't survive notifications.",
        brutal: "You said early night — your phone didn't sign that contract."
      }),
      phase,
      responses: [
        {
          id: "early_try",
          emoji: "🌙",
          label: "I'll actually sleep early tonight",
          instantRoast: tone(In, {
            gentle: "I'll believe it when blue light dies.",
            strict: "Sleep early requires phone exile.",
            brutal: "Early sleep — prove it or stop auditioning."
          }),
          excuseTag: "early_sleep_promise"
        },
        {
          id: "realistic",
          emoji: "🫠",
          label: "Let's be realistic — midnight",
          instantRoast: tone(In, {
            gentle: "Honesty counts — still negotiating against morning-you.",
            strict: "Midnight isn't early — it's optimism with a clock.",
            brutal: "Midnight early — in what timezone, chaos?"
          }),
          excuseTag: "midnight_realism"
        },
        {
          id: "deny",
          emoji: "🙈",
          label: "Don't clock me",
          instantRoast: tone(In, {
            gentle: "Too late — I've already adopted you mentally.",
            strict: "I'm clocking — that's literally my job today.",
            brutal: "I'm clocking you — I'm basically HR now."
          }),
          excuseTag: "dont_clock"
        }
      ]
    });

    orders.push({
      id: "ni_phone",
      timeLabel: slot(21, 0),
      text: tone(In, {
        gentle: "You're on your phone when you said you'd sleep early. I see you.",
        strict: "21:00 — Phone down or admit you're addicted to tiny rectangles.",
        brutal: "21:00 — You said early night. Screen glow says otherwise."
      }),
      phase,
      responses: [
        {
          id: "doom",
          emoji: "📱",
          label: "Just winding down",
          instantRoast: tone(In, {
            gentle: "Winding down isn't infinite reels.",
            strict: "Winding down became winding sideways.",
            brutal: "Winding down — cute brand for brain rot."
          }),
          excuseTag: "wind_down"
        },
        {
          id: "alarm_tmr",
          emoji: "⏰",
          label: "I'll set a hard alarm",
          instantRoast: tone(In, {
            gentle: "Alarm won't fix discipline — but it's a start.",
            strict: "Hard alarm — we'll see if you respect it.",
            brutal: "Hard alarm — you've ignored softer ones five times today."
          }),
          excuseTag: "hard_alarm"
        },
        {
          id: "two_min",
          emoji: "⌛",
          label: "Two more minutes",
          instantRoast: tone(In, {
            gentle: "Two minutes is how midnight happens.",
            strict: "Two minutes is a gateway drug to 2am.",
            brutal: "Two minutes — opening credits of regret."
          }),
          excuseTag: "two_minutes"
        }
      ]
    });
  } else {
    /** night — wind-down / sleep */
    pushMemoryHooks();
    orders.push({
      id: "ni_sleep",
      timeLabel: slot(22, 30),
      text: tone(In, {
        gentle: "Sleep isn't optional — it's how tomorrow-you survives your jokes tonight.",
        strict: "Bed. Phone across the room — negotiate with morning-you tomorrow.",
        brutal: "22:30 — Phone meets charger or we riot. Sleep isn't a suggestion."
      }),
      phase,
      responses: [
        {
          id: "charger_far",
          emoji: "🔌",
          label: "Charging across the room — fine",
          instantRoast: tone(In, {
            gentle: "Growth looks good on you.",
            strict: "Finally — adult behavior unlocked.",
            brutal: "Adult mode — rare sighting. Document this."
          }),
          excuseTag: "charger_far"
        },
        {
          id: "podcast",
          emoji: "🎧",
          label: "Podcast until sleep",
          instantRoast: tone(In, {
            gentle: "If it's voice-not-screen, I'll allow — barely.",
            strict: "Podcast sleep is still stimulation roulette.",
            brutal: "Podcast sleep — you're still not resting — you're entertained unconscious."
          }),
          excuseTag: "podcast_sleep"
        },
        {
          id: "rebel",
          emoji: "😈",
          label: "I'll risk it",
          instantRoast: tone(In, {
            gentle: "Risk acknowledged — morning-you sends regrets in advance.",
            strict: "Risk it — enjoy explaining bags under eyes tomorrow.",
            brutal: "Risk it — bold last words before regret gremlin hours."
          }),
          excuseTag: "risk_sleep"
        }
      ]
    });
  }

  return orders.map((o) => {
    if (!o.responses?.length) return o;
    const split = communitySplitForResponses(
      o.id,
      o.responses.map((r) => r.id)
    );
    return {
      ...o,
      responses: o.responses.map((r) => ({
        ...r,
        communityPct: split[r.id]
      }))
    };
  });
}

/** Callback lines from earlier picks (same session day). */
export function buildMemoryLinesFromPicks(picks, phase, codename = "Your AI") {
  const lines = [];
  if (!picks || typeof picks !== "object") return lines;
  const vals = Object.values(picks);
  const hadRead = vals.some((d) => d?.excuseTag === "read_later");
  const hadEpisode = vals.some((d) => d?.excuseTag === "one_episode");
  const hadSnooze = vals.some((d) => d?.excuseTag === "snooze_chain" || d?.excuseTag === "five_minute_lie");
  if (hadRead && (phase === "evening" || phase === "night")) {
    lines.push(`${codename} remembers you promised reading — we're checking in.`);
  }
  if (hadEpisode && (phase === "evening" || phase === "night")) {
    lines.push(`Earlier you promised ‘just one episode.’ Be honest — how many was it?`);
  }
  if (hadSnooze && phase === "midday") {
    lines.push(`Morning-you made promises snooze-you ignored. Just checking in.`);
  }
  return lines.slice(0, 2);
}

export function summarizeLifeDayVirality({ picks, compliancePct, intensity, codename }) {
  const entries = Object.entries(picks || {});
  let worst = {
    tag: "main-character syndrome",
    label: "I'll start tomorrow",
    roast: "Tomorrow called — it sent you to voicemail."
  };
  const roastTier = {
    gentle: [
      "You had potential. You chose Netflix. We move.",
      "Soft chaos today — tomorrow can be honest.",
      "You're trying — your excuses are trying harder."
    ],
    strict: [
      "You had potential. You chose convenience. We notice.",
      "Discipline called — you sent it to voicemail.",
      "Growth isn't comfortable — your couch disagrees."
    ],
    brutal: [
      "You had potential. You chose Netflix. We move.",
      "Main character energy — wrong storyline.",
      "Resume says ambitious — browser history disagrees."
    ]
  };
  const tier = roastTier[intensity] || roastTier.strict;
  const verdict = tier[hashSeed(JSON.stringify(entries)) % tier.length];

  const tagPriority = [
    "one_episode",
    "read_later",
    "snooze_chain",
    "five_minute_lie",
    "one_more_scroll",
    "coffee_meal",
    "skip_lunch",
    "weather_skip"
  ];
  for (const tag of tagPriority) {
    const hit = entries.find(([, v]) => v?.excuseTag === tag);
    if (!hit) continue;
    const v = hit[1];
    if (tag === "one_episode") {
      worst = {
        tag: "streaming denial",
        label: v.label || "just one episode",
        roast: "‘Just one episode’ — three episodes later you're offended I'm counting."
      };
      break;
    }
    if (tag === "read_later") {
      worst = {
        tag: "reading fantasy",
        label: v.label || "I'll read after",
        roast: "The book is still pristine. Your integrity isn't."
      };
      break;
    }
    if (tag === "snooze_chain" || tag === "five_minute_lie") {
      worst = {
        tag: "snooze saga",
        label: v.label || "five more minutes",
        roast: "Snooze button sees more action than your gym membership."
      };
      break;
    }
    if (tag === "one_more_scroll") {
      worst = {
        tag: "scroll hole",
        label: v.label || "one more scroll",
        roast: "Your thumb has tenure at this point."
      };
      break;
    }
    worst = {
      tag: "excuse sampler",
      label: v.label || "creative avoidance",
      roast: "Creative excuses — zero Olympic medals."
    };
    break;
  }

  const roastLine = roastFromCompliance(compliancePct, codename);
  return {
    worstExcuse: worst,
    verdict,
    roastLine,
    shareCaption: `Day under AI supervision 😮‍💨 Compliance: ${compliancePct}% · Worst excuse: “${worst.label}” · ${verdict} #LifeMode #DecideForMe`
  };
}

export function roastFromCompliance(pct, codename) {
  if (pct >= 90) return `${codename} is weirdly proud — don't make tomorrow weird.`;
  if (pct >= 70) return `${codename} sees effort — could've been worse. Barely.`;
  if (pct >= 50) return `${codename} is giving you side-eye and snack crumbs.`;
  return `${codename} has drafted a PowerPoint about your choices.`;
}
