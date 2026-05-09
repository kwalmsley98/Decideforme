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
  "Quick check — you're still on the sofa, aren't you. It's fine. I'm just watching.",
  "Be honest: are you working or scrolling with a spreadsheet open?",
  "Drink some water. Or don't. Either way you're dramatic about it.",
  "Sit up. I'm not your mum but your back is begging.",
  "Put the phone face-down for one minute. …Yeah. Didn't think so."
];

export function pickCheckIn(seed = 0) {
  return CHECK_INS[Math.abs(seed) % CHECK_INS.length];
}

export function globalFeedLines() {
  return [
    "Most people today picked ‘just one episode.’ The couch is winning globally.",
    "Hot take: ‘same lunch again’ is crushing it out there.",
    "Half of everyone hit snooze before noon. You're in crowded company.",
    "Fridge opens are up. The food situation is not. Same as always.",
    "Top excuse today: ‘I'll read after this.’ Spoiler: they didn't."
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
      gentle: "It's raining. You can still go for a walk — I'll pretend I didn't see the umbrella drama.",
      strict: "It's wet out. That's not an excuse to stay glued to the sofa.",
      brutal: "It's raining. You're still going to complain either way — at least move while you do it."
    });
  }
  if (cold) {
    return tone(intensity, {
      gentle: "It's cold. Put a coat on and go outside for a bit — you'll survive.",
      strict: "It's freezing. Wear layers and stop acting like the weather is a personal attack.",
      brutal: "It's cold out. You're still going to scroll inside where it's warm — own it."
    });
  }
  return tone(intensity, {
    gentle: "Weather's fine. Maybe step away from the screen for ten minutes.",
    strict: "Nice day. You're about to miss it because you're inside on your phone.",
    brutal: "Beautiful out there. You're going to see it through a window again, aren't you."
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
        gentle: `Your alarm's already gone off a bunch of times. Getting up still feels awful — do it anyway.`,
        strict: `Your alarm keeps screaming. None of the next ones will feel nicer. Just get up.`,
        brutal: `Your alarm went off four times. The fifth one won't feel different. Get up.`
      }),
      phase,
      responses: [
        {
          id: "snooze",
          emoji: "😴",
          label: "Just one more snooze",
          instantRoast: tone(In, {
            gentle: "You say that every time. I'm keeping track.",
            strict: "Snooze isn't rest — it's you negotiating with the clock.",
            brutal: "That's not sleep — that's you avoiding your own life in nine-minute chunks."
          }),
          laterRoast: tone(In, {
            gentle: "Still in bed? We talked about this.",
            strict: "You've been awake enough to scroll. Try standing up.",
            brutal: "You've been ‘almost up’ for ages. Pick a side."
          }),
          fireLaterInPhase: "midday",
          excuseTag: "snooze_chain"
        },
        {
          id: "up",
          emoji: "✅",
          label: "Fine I'm up",
          instantRoast: tone(In, {
            gentle: "Good. Don't waste it opening socials first.",
            strict: "Words are easy. Move before you touch your phone.",
            brutal: "Prove it — feet on the floor before TikTok."
          }),
          excuseTag: "compliant_morning"
        },
        {
          id: "five",
          emoji: "⏱️",
          label: "Five minutes — I mean it",
          instantRoast: tone(In, {
            gentle: "Sure. I've heard that before.",
            strict: "Five minutes always turns into twenty. Always.",
            brutal: "‘Five minutes’ is how every slow morning starts."
          }),
          fireLaterInPhase: "midday",
          laterRoast: tone(In, {
            gentle: "Those five minutes turned into half an hour. I'm not mad — I'm tired for you.",
            strict: "It's been way longer than five minutes. Don't act surprised.",
            brutal: "It's been forever since ‘five minutes.’ Even the clock is embarrassed."
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
            ? "You need to eat something real — not just coffee and hope."
            : "Eat breakfast. Something with actual calories, not just vibes.",
        strict: "You're about to skip breakfast and pretend coffee counts as food.",
        brutal: "You've stared at food delivery twice and ordered nothing. Eat something."
      }),
      phase,
      responses: [
        {
          id: "same_bagel",
          emoji: "🥯",
          label: "Same thing as always",
          instantRoast: tone(In, {
            gentle: "At least you know what you like.",
            strict: "Fine — own it. Same order every day is a choice.",
            brutal: "Same meal again — boring, but honest."
          }),
          excuseTag: "same_order"
        },
        {
          id: "healthy_lie",
          emoji: "🥗",
          label: "I'll grab something healthy later",
          instantRoast: tone(In, {
            gentle: "'Later' usually means never.",
            strict: "Later isn't a meal plan — it's denial.",
            brutal: "'Later' is where every salad goes to die."
          }),
          excuseTag: "later_never"
        },
        {
          id: "skip",
          emoji: "☕",
          label: "Coffee is breakfast",
          instantRoast: tone(In, {
            gentle: "Bold move when you're already hangry by eleven.",
            strict: "Coffee isn't breakfast — it's panic in a cup.",
            brutal: "That's not breakfast — that's caffeine wearing a costume."
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
              gentle: "You're about to open email and lose the whole morning. Close it until you've started real work.",
              strict: "Don't let your inbox eat the first hour — you'll hate yourself by lunch.",
              brutal: "You're one click away from pretending email is the same as work."
            })
          : tone(In, {
              gentle: "Day off doesn't mean you can't leave the house once.",
              strict: "‘Relaxing’ isn't code for not seeing sunlight.",
              brutal: "You're not resting — you're hibernating with Wi‑Fi."
            }),
      phase,
      responses: [
        {
          id: "peek",
          emoji: "📧",
          label: "I'll just peek at email",
          instantRoast: tone(In, {
            gentle: "‘Peek’ always turns into an hour.",
            strict: "That's not a peek — you're already replying.",
            brutal: "‘Just checking’ is how mornings disappear."
          }),
          excuseTag: "email_peek"
        },
        {
          id: "deep",
          emoji: "🎯",
          label: "Deep work mode — for real",
          instantRoast: tone(In, {
            gentle: "I'll believe it when your notifications stay off.",
            strict: "Prove it — phone away, one real task done.",
            brutal: "Deep work until the first ping — so, about a minute?"
          }),
          excuseTag: "deep_work"
        },
        {
          id: "later_work",
          emoji: "🕐",
          label: "I'll start after lunch",
          instantRoast: tone(In, {
            gentle: "Lunch won't magically fix your motivation.",
            strict: "You'll feel worse after lunch if you waste the morning.",
            brutal: "‘After lunch’ is code for ‘probably never.’"
          }),
          fireLaterInPhase: "midday",
          laterRoast: tone(In, {
            gentle: "Lunch was ages ago. Still waiting on that big start?",
            strict: "You said after lunch. Lunch finished. What's the excuse now?",
            brutal: "It's been hours since ‘after lunch.’ That's not a plan — that's avoidance."
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
              gentle: "Okay — actually go around the block once.",
              strict: "Walk means moving — not posting about it.",
              brutal: "Walk — don't stand outside scrolling."
            }),
            excuseTag: "walk_promise"
          },
          {
            id: "inside",
            emoji: "🏠",
            label: "I'll skip today — weather",
            instantRoast: tone(In, {
              gentle: "The weather's not great — fine. Don't act like that's never happened before.",
              strict: "Rain isn't an excuse to rot on the sofa all day.",
              brutal: "Blaming the sky — brave from someone who skips stairs too."
            }),
            excuseTag: "weather_skip"
          },
          {
            id: "gym_lie",
            emoji: "🏋️",
            label: "Gym later instead",
            instantRoast: tone(In, {
              gentle: "‘Gym later’ rarely shows up.",
              strict: "Later usually means never — we've seen this movie.",
              brutal: "‘I'll go later’ — famous last words before you watch TV."
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
        gentle: "You're about to order the same lunch you always order. At least admit it.",
        strict: "Same meal again — either say you're doing it on purpose or stop pretending it's random.",
        brutal: "You're about to order the same thing you always order. At least own it."
      }),
      phase,
      responses: [
        {
          id: "same_ok",
          emoji: "🍜",
          label: "It's my comfort order",
          instantRoast: tone(In, {
            gentle: "Fair — comfort food is allowed.",
            strict: "Fine — but call it what it is: the same thing every time.",
            brutal: "Comfort meal — cute until it's the only thing you ever eat."
          }),
          excuseTag: "comfort_order"
        },
        {
          id: "try_new",
          emoji: "✨",
          label: "Fine — I'll try something new",
          instantRoast: tone(In, {
            gentle: "Good — actually order it, don't just talk about it.",
            strict: "New means you tap ‘pay’ — not save it for later.",
            brutal: "Try something new — or stop saying you will."
          }),
          excuseTag: "try_new_food"
        },
        {
          id: "skip_lunch",
          emoji: "⏭️",
          label: "I'll eat later",
          instantRoast: tone(In, {
            gentle: "Skipping lunch is how you turn mean by three o'clock.",
            strict: "You'll be starving later and take it out on everyone.",
            brutal: "Skipping lunch isn't discipline — it's you setting yourself up to crash."
          }),
          excuseTag: "skip_lunch"
        }
      ]
    });

    orders.push({
      id: "md_scroll",
      timeLabel: slot(13, 30),
      text: tone(In, {
        gentle: "That ‘five-minute break’ turned into half an hour. Shocking.",
        strict: "You've been scrolling way longer than you said. We both know it.",
        brutal: "You've been on your phone forever and you're still acting like it's a ‘quick break.’"
      }),
      phase,
      responses: [
        {
          id: "research",
          emoji: "📱",
          label: "It's research",
          instantRoast: tone(In, {
            gentle: "Sure — very serious research on strangers' lunches.",
            strict: "It's not research — it's you procrastinating with extra steps.",
            brutal: "Research? You're watching clips. Let's be real."
          }),
          excuseTag: "research_lie"
        },
        {
          id: "stop",
          emoji: "🛑",
          label: "Okay phone goes away",
          instantRoast: tone(In, {
            gentle: "Good — put it face down and mean it.",
            strict: "Put it down. Now. Not ‘in a sec.’",
            brutal: "Put the phone down — your thumb has done enough today."
          }),
          excuseTag: "phone_down"
        },
        {
          id: "one_more",
          emoji: "👀",
          label: "One more scroll",
          instantRoast: tone(In, {
            gentle: "‘One more’ never stops at one.",
            strict: "One more always turns into twenty.",
            brutal: "One more — that's how the whole afternoon disappears."
          }),
          fireLaterInPhase: "afternoon",
          laterRoast: tone(In, {
            gentle: "Still scrolling? I'm not mad — I'm just watching you waste time.",
            strict: "It's been ages. ‘One more’ was a lie.",
            brutal: "It's been forever. I'm not angry — I'm disappointed."
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
        gentle: "You've opened the fridge three times in the last hour. There's nothing new in there.",
        strict: "Stop opening the fridge like something magical appeared since two minutes ago.",
        brutal: "You've opened the fridge three times. Nothing new showed up. Same stuff. Same you."
      }),
      phase,
      responses: [
        {
          id: "bored",
          emoji: "🫠",
          label: "I'm bored not hungry",
          instantRoast: tone(In, {
            gentle: "Bored snacking still counts as snacking.",
            strict: "You're not hungry — you're bored and eating anyway.",
            brutal: "You're not hungry — you're bored and the fridge is your hobby."
          }),
          excuseTag: "bored_snack"
        },
        {
          id: "hydrate",
          emoji: "💧",
          label: "Hydrating actually",
          instantRoast: tone(In, {
            gentle: "The water isn't hiding behind the cheese — nice try.",
            strict: "If you're thirsty, drink water — don't stare at leftovers.",
            brutal: "That's not hydration — you're just looking for something to do."
          }),
          excuseTag: "hydrate_lie"
        },
        {
          id: "fine",
          emoji: "🙃",
          label: "Okay that hurt",
          instantRoast: tone(In, {
            gentle: "Sorry — but close the door and walk away.",
            strict: "Good — now shut the fridge and mean it.",
            brutal: "Feel seen? Good. Step away from the snacks."
          }),
          excuseTag: "called_out"
        }
      ]
    });

    orders.push({
      id: "af_meeting",
      timeLabel: slot(16, 0),
      text: tone(In, {
        gentle: `That meeting could've been an email — you know it, I know it, ${operatorName}.`,
        strict: "Another long meeting that ate your afternoon. Cool cool.",
        brutal: "That meeting could've been five minutes. We all pretended it couldn't."
      }),
      phase,
      responses: [
        {
          id: "had_to",
          emoji: "📅",
          label: "I had to be there",
          instantRoast: tone(In, {
            gentle: "Fine — but it still ate your whole afternoon.",
            strict: "You had to go — doesn't mean it wasn't a waste of time.",
            brutal: "Had to be there — still didn't need to be that long."
          }),
          excuseTag: "mandatory_meeting"
        },
        {
          id: "mute",
          emoji: "🔇",
          label: "I was on mute recovering",
          instantRoast: tone(In, {
            gentle: "Fair — meetings fry everyone's brain.",
            strict: "Mute doesn't fix the fact you lost an hour.",
            brutal: "You were on mute — still trapped in the meeting. Same prison, quieter."
          }),
          excuseTag: "mute_recovery"
        },
        {
          id: "zoom_fatigue",
          emoji: "😵",
          label: "Brain fried — exempt",
          instantRoast: tone(In, {
            gentle: "Tired brain still picks what you do next — choose wisely.",
            strict: "Tired isn't a free pass to spiral and snack.",
            brutal: "Brain fried — then why are you still on your phone?"
          }),
          excuseTag: "brain_fried"
        }
      ]
    });
  } else if (phase === "evening") {
    pushMemoryHooks();
    orders.push({
      id: "ev_phone",
      timeLabel: slot(19, 0),
      text: tone(In, {
        gentle: "You've been on your phone for ages. You said you'd be productive tonight — interesting.",
        strict: "You've been staring at this screen forever. ‘Productive night’ was the plan, remember?",
        brutal: "You've been on your phone for two hours. You said you'd be productive tonight. Interesting."
      }),
      phase,
      responses: [
        {
          id: "productive_soon",
          emoji: "📋",
          label: "I'm about to start — for real",
          instantRoast: tone(In, {
            gentle: "I've heard that before — show me one task done.",
            strict: "‘About to’ isn't doing — start or stop pretending.",
            brutal: "‘About to start’ — you've been saying that since dinner."
          }),
          excuseTag: "productive_soon"
        },
        {
          id: "needed_break",
          emoji: "🫠",
          label: "I needed a break first",
          instantRoast: tone(In, {
            gentle: "Break's been hours — that's not a break, that's the whole evening.",
            strict: "That ‘break’ ate your whole night.",
            brutal: "Break first — bold when the break became the whole plan."
          }),
          excuseTag: "needed_break"
        },
        {
          id: "fine_phone",
          emoji: "📱",
          label: "Okay you caught me",
          instantRoast: tone(In, {
            gentle: "Thanks for being honest — now put it down for twenty minutes.",
            strict: "Good — honesty counts. Now actually stop scrolling.",
            brutal: "At least you admit it — now do something about it."
          }),
          excuseTag: "caught_scrolling"
        }
      ]
    });

    orders.push({
      id: "ev_netflix",
      timeLabel: slot(20, 30),
      text: tone(In, {
        gentle: "You're about to put Netflix on, aren't you. I already know.",
        strict: "You're reaching for the remote. Don't act surprised I'm calling it.",
        brutal: "You're about to put Netflix on aren't you. I already know."
      }),
      phase,
      responses: [
        {
          id: "one_ep",
          emoji: "😔",
          label: "I just need one episode",
          instantRoast: tone(In, {
            gentle: "One episode — we'll see how that goes.",
            strict: "‘One episode’ is never one episode — come on.",
            brutal: "‘Just one’ — famous last words before four episodes."
          }),
          fireLaterInPhase: "night",
          laterRoast: tone(In, {
            gentle: "It's been three episodes. I'm not angry — I'm just disappointed.",
            strict: "Three episodes in — still calling it ‘one’?",
            brutal: "It's been three episodes. I'm not angry — I'm keeping score."
          }),
          excuseTag: "one_episode"
        },
        {
          id: "reading",
          emoji: "🤥",
          label: "I'm definitely reading after this",
          instantRoast: tone(In, {
            gentle: "Your book heard that. I'll ask again later.",
            strict: "You'll say ‘after this’ until it's 2am.",
            brutal: "Reading after — sure. The bookmark hasn't moved in a month."
          }),
          fireLaterInPhase: "night",
          laterRoast: tone(In, {
            gentle: "You said you'd read tonight. We're checking in — how many pages?",
            strict: "Reading check — still zero pages, isn't it.",
            brutal: "You said you'd read. The book's still untouched."
          }),
          excuseTag: "read_later"
        },
        {
          id: "book_boring",
          emoji: "💀",
          label: "The book was boring anyway",
          instantRoast: tone(In, {
            gentle: "Maybe — but you still didn't read it.",
            strict: "Boring or not — you didn't open it.",
            brutal: "Blaming the book — easy when you didn't try."
          }),
          excuseTag: "book_boring"
        }
      ]
    });

    orders.push({
      id: "ev_night_lie",
      timeLabel: slot(21, 0),
      text: tone(In, {
        gentle: "You said you'd have an early night. It's 9pm. We both know how this ends.",
        strict: "You promised an early night. Your phone doesn't believe you either.",
        brutal: "You said you'd have an early night. It is now 9pm. We both know you won't. Disappoint me."
      }),
      phase,
      responses: [
        {
          id: "early_try",
          emoji: "🌙",
          label: "I'll actually sleep early tonight",
          instantRoast: tone(In, {
            gentle: "I'll believe it when the screen goes off.",
            strict: "Put the phone away — then we'll talk.",
            brutal: "Prove it — charger across the room or stop saying it."
          }),
          excuseTag: "early_sleep_promise"
        },
        {
          id: "realistic",
          emoji: "🫠",
          label: "Real talk — I'll be up till midnight",
          instantRoast: tone(In, {
            gentle: "At least you're honest — midnight still isn't ‘early.’",
            strict: "Midnight isn't early — that's just reality with extra steps.",
            brutal: "Midnight — you're not even pretending anymore."
          }),
          excuseTag: "midnight_realism"
        },
        {
          id: "deny",
          emoji: "🙈",
          label: "Don't clock me",
          instantRoast: tone(In, {
            gentle: "Too late — I'm already watching.",
            strict: "I'm literally here to clock you — that's the whole bit.",
            brutal: "I'm clocking you — that's why we're here."
          }),
          excuseTag: "dont_clock"
        }
      ]
    });
  } else {
    /** night — wind-down / sleep */
    pushMemoryHooks();
    orders.push({
      id: "ni_bedtime",
      timeLabel: slot(22, 0),
      text: tone(In, {
        gentle: "You said 10pm bedtime. It's 10pm. We both know what's happening.",
        strict: "You promised sleep by ten. You're still on your phone — don't lie to both of us.",
        brutal: "You said 10pm bedtime. It is 10pm. We both know what's happening."
      }),
      phase,
      responses: [
        {
          id: "doom",
          emoji: "📱",
          label: "Just winding down",
          instantRoast: tone(In, {
            gentle: "Winding down can't last two hours — put it away.",
            strict: "‘Winding down’ is how you end up at 2am again.",
            brutal: "Winding down — sure — that's what everyone says before another hour of scrolling."
          }),
          excuseTag: "wind_down"
        },
        {
          id: "two_min",
          emoji: "⌛",
          label: "Two more minutes",
          instantRoast: tone(In, {
            gentle: "Two minutes always becomes an hour — we've done this.",
            strict: "Two minutes is how midnight happens every time.",
            brutal: "Two minutes — that's how you lose the whole night."
          }),
          excuseTag: "two_minutes"
        },
        {
          id: "charger_far",
          emoji: "🔌",
          label: "Phone charging across the room — done",
          instantRoast: tone(In, {
            gentle: "Finally — something sensible.",
            strict: "Good — now leave it there.",
            brutal: "Look at you — acting like a grown-up. Rare."
          }),
          excuseTag: "charger_far"
        }
      ]
    });

    orders.push({
      id: "ni_awake",
      timeLabel: slot(23, 0),
      text: tone(In, {
        gentle: "Still awake? Yeah — didn't think you'd actually go to bed.",
        strict: "It's late. You're still up. Colour me shocked.",
        brutal: "Still awake. Shocking. Truly shocking."
      }),
      phase,
      responses: [
        {
          id: "sleep_now",
          emoji: "😴",
          label: "Going to sleep right now",
          instantRoast: tone(In, {
            gentle: "Good — close the app and mean it.",
            strict: "Then go — stop talking to me and sleep.",
            brutal: "Prove it — lights off. Now."
          }),
          excuseTag: "sleep_now"
        },
        {
          id: "cant_sleep",
          emoji: "😵",
          label: "Can't sleep — not my fault",
          instantRoast: tone(In, {
            gentle: "Fair — but staring at your phone doesn't help.",
            strict: "Can't sleep with TikTok in your face — put it down.",
            brutal: "You can't sleep — you're still blasting blue light into your brain."
          }),
          excuseTag: "cant_sleep"
        },
        {
          id: "rebel",
          emoji: "😈",
          label: "I'll sleep when I'm tired",
          instantRoast: tone(In, {
            gentle: "You'll be exhausted tomorrow — don't pretend that's a win.",
            strict: "You're tired — you're just ignoring it for one more scroll.",
            brutal: "You'll sleep when you're wrecked — bold strategy."
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
    lines.push(`${codename} remembers you said you'd read — we're checking in.`);
  }
  if (hadEpisode && (phase === "evening" || phase === "night")) {
    lines.push(`You said ‘just one episode.’ Be honest — how many was it really?`);
  }
  if (hadSnooze && phase === "midday") {
    lines.push(`You hit snooze a bunch this morning. Just checking you're alive.`);
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
      "You had a good day in you. You picked the couch instead. We move on.",
      "Chaos today — tomorrow can be cleaner if you want.",
      "You're trying — your excuses are trying harder than you are."
    ],
    strict: [
      "You could've done the thing. You did the easy thing instead.",
      "Discipline texted. You left it on read.",
      "Growing up feels weird — your sofa doesn't care."
    ],
    brutal: [
      "You had potential. You chose Netflix. We move.",
      "Big main-character energy — wrong scene though.",
      "Your CV says ‘motivated.’ Your evening says ‘one more episode.’"
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
        roast: "‘Just one episode’ — then three passed and you acted shocked I noticed."
      };
      break;
    }
    if (tag === "read_later") {
      worst = {
        tag: "reading fantasy",
        label: v.label || "I'll read after",
        roast: "Book's still sitting there. You knew it would be."
      };
      break;
    }
    if (tag === "snooze_chain" || tag === "five_minute_lie") {
      worst = {
        tag: "snooze saga",
        label: v.label || "five more minutes",
        roast: "You and the snooze button — closer relationship than most friendships."
      };
      break;
    }
    if (tag === "one_more_scroll") {
      worst = {
        tag: "scroll hole",
        label: v.label || "one more scroll",
        roast: "Your thumb lives on that screen now."
      };
      break;
    }
    worst = {
      tag: "excuse sampler",
      label: v.label || "creative avoidance",
      roast: "Lots of excuses today — not a lot of follow-through."
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
  if (pct >= 90) return `${codename} is almost proud — don't ruin it tomorrow.`;
  if (pct >= 70) return `${codename} sees you tried — could've been worse. Barely.`;
  if (pct >= 50) return `${codename} is watching you sideways while you snack.`;
  return `${codename} could write a whole essay about today's choices.`;
}
