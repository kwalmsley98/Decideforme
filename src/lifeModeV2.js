/** Life Mode v2 — tactical orders generation (no chat; orders only). */

export const LIFE_CODENAMES = ["COMMANDER", "ORACLE", "THE DECIDER"];

export function pickCodename() {
  return LIFE_CODENAMES[Math.floor(Math.random() * LIFE_CODENAMES.length)];
}

/** @typedef {'morning'|'midday'|'evening'|'night'} DayPhase */

/**
 * Browser / user IANA timezone (e.g. Europe/London). Safe fallback if Intl unavailable.
 * @param {string} [timeZone] Pass explicit tz when known; otherwise uses the device default.
 */
export function getUserTimeZone(timeZone) {
  if (typeof timeZone === "string" && timeZone.trim()) return timeZone.trim();
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Wall-clock hour (0–23) for this instant in the given IANA timezone.
 * @param {Date} [date]
 * @param {string} [timeZone]
 */
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

/**
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {{ hour: number, minute: number, timeZone: string }}
 */
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

/**
 * Short time string for headers (respects locale 12/24h preference).
 * @param {Date} [date]
 * @param {string} [timeZone]
 */
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

/** HHMM for scheduled local wall-clock times (same digits users expect in their timezone). */
function wallClockHHMM(hour, minute = 0) {
  const h = Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)));
  const m = Math.max(0, Math.min(59, Math.floor(Number(minute) || 0)));
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

/**
 * @param {number} hour Local hour 0–23 (user's wall clock in their TZ)
 * @returns {DayPhase}
 */
export function getDayPhase(hour) {
  if (hour >= 21 || hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

/**
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function getDayPhaseForNow(now = new Date(), timeZone) {
  return getDayPhase(getLocalHourInTimeZone(now, timeZone));
}

/**
 * @param {number} lat
 * @param {number} lng
 */
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
    // WMO: rain/drizzle/showery ranges commonly 51–67, 80–82, 95–99
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

const POWER_TRIPS = [
  "You asked me to control your life. I'm enjoying this.",
  "Chain of command is clear. You follow. I decide.",
  "This is not a negotiation. Execute.",
  "Weak excuses are noted and discarded."
];

export function pickPowerTrip(seed = 0) {
  const i = Math.abs(Math.floor(seed)) % POWER_TRIPS.length;
  return POWER_TRIPS[i];
}

/**
 * @param {'gentle'|'strict'|'brutal'} intensity
 * @param {string} line
 */
export function intensityPrefix(intensity, line) {
  if (intensity === "gentle") return line;
  if (intensity === "strict") return line.replace(/\.$/, "").trim() + " No delays.";
  return line.replace(/\.$/, "").trim().toUpperCase() + ". NO EXCUSES.";
}

/**
 * @param {object} opts
 * @param {{ wakeHour: number, dayType: 'work'|'rest', energy: 'low'|'medium'|'high', intensity: 'gentle'|'strict'|'brutal', codename: string }} opts.setup
 * @param {DayPhase} opts.phase
 * @param {{ isRainy?: boolean, tempC?: number|null } | null} opts.weather
 * @param {string} opts.rankName
 * @param {string} [opts.operatorName]
 */
export function buildLifeOrders({
  setup,
  phase,
  weather,
  rankName,
  operatorName = "Operator"
}) {
  const { wakeHour, dayType, energy, intensity, codename } = setup;
  const I = (s) => intensityPrefix(intensity, s);
  const rain = weather?.isRainy;
  const cold = typeof weather?.tempC === "number" && weather.tempC < 8;
  const hot = typeof weather?.tempC === "number" && weather.tempC > 28;

  const slot = (h, min = 0) => wallClockHHMM(h, min);

  const weatherWalk =
    rain === true
      ? I("It's raining. You will not use this as an excuse to skip your walk.")
      : cold
        ? I("Cold air is not optional. You will move your body outside briefly.")
        : hot
          ? I("Heat is not a pass. Hydrate and complete your movement block.")
          : I("You will complete your scheduled movement. No substitutions.");

  const energyFood =
    energy === "low"
      ? I("You will eat on schedule. Fuel is not optional.")
      : energy === "high"
        ? I("You will channel this energy into execution, not chaos.")
        : I("You will eat clean and on time.");

  const workBlock =
    dayType === "work"
      ? I("Deep work block is locked. Notifications die now.")
      : I("This is recovery duty. No guilt — structured rest only.");

  const wakeLabel = slot(wakeHour, 0);

  /** @type {{ id: string, timeLabel: string, text: string, phase: DayPhase }[]} */
  const orders = [];

  if (phase === "morning") {
    orders.push({
      id: "m0",
      timeLabel: wakeLabel,
      text: I(`You will rise on schedule. ${codename} does not accept snooze.`),
      phase
    });
    orders.push({
      id: "m1",
      timeLabel: slot(7, 30),
      text: energyFood,
      phase
    });
    orders.push({
      id: "m2",
      timeLabel: slot(9, 0),
      text: I("You will consume a nutritious breakfast. No exceptions."),
      phase
    });
    orders.push({
      id: "m3",
      timeLabel: slot(9, 30),
      text: dayType === "work" ? workBlock : I("You will move before noon. Light counts."),
      phase
    });
    orders.push({
      id: "m4",
      timeLabel: slot(10, 0),
      text: weatherWalk,
      phase
    });
  } else if (phase === "midday") {
    orders.push({
      id: "d0",
      timeLabel: slot(12, 0),
      text: I("Midday refuel. Eat. No desk crumbs."),
      phase
    });
    orders.push({
      id: "d1",
      timeLabel: slot(12, 30),
      text: dayType === "work" ? I("You will close one priority task before distractions.") : I("You will do one high-leverage task anyway."),
      phase
    });
    orders.push({
      id: "d2",
      timeLabel: slot(14, 0),
      text: I(`${rankName}, hydrate. That bottle is not decoration.`),
      phase
    });
    orders.push({
      id: "d3",
      timeLabel: slot(15, 0),
      text: rain === true ? I("Rain continues. Your discipline continues.") : weatherWalk,
      phase
    });
  } else if (phase === "evening") {
    orders.push({
      id: "e0",
      timeLabel: slot(17, 30),
      text: I("Shutdown sequence begins. Inbox is not your life."),
      phase
    });
    orders.push({
      id: "e1",
      timeLabel: slot(18, 30),
      text: I("You will eat a controlled dinner. Portion discipline."),
      phase
    });
    orders.push({
      id: "e2",
      timeLabel: slot(19, 0),
      text: I(`Walk or mobility — ${operatorName}, you finish the day moving.`),
      phase
    });
    orders.push({
      id: "e3",
      timeLabel: slot(20, 0),
      text: I("Prepare tomorrow's battlefield tonight: clothes, bag, plan."),
      phase
    });
  } else {
    orders.push({
      id: "n0",
      timeLabel: slot(21, 0),
      text: I("Night protocol. Put the phone down. You have 30 minutes to decompress."),
      phase
    });
    orders.push({
      id: "n1",
      timeLabel: slot(21, 30),
      text: I("Screens off. The war continues tomorrow."),
      phase
    });
    orders.push({
      id: "n2",
      timeLabel: slot(22, 30),
      text: I("Sleep by 2230 local. Fatigue is how mistakes multiply."),
      phase
    });
  }

  return orders;
}

/**
 * Payload for server-side order generation (future API). Call from the client with local context.
 * @param {object} setup Same shape as buildLifeOrders setup
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
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

export function roastFromCompliance(pct, codename) {
  if (pct >= 90) return `${codename} notes acceptable discipline. Do not get comfortable.`;
  if (pct >= 70) return `${codename} sees gaps. Tighten formation tomorrow.`;
  if (pct >= 50) return `${codename} is unimpressed. Half measures produce half lives.`;
  return `${codename} has filed you under 'liability'. Recover or stay weak.`;
}

export function globalFeedLines() {
  return [
    "ORACLE: Squad moving — hydration enforced worldwide.",
    "THE DECIDER: No-snooze protocol active in 12 regions.",
    "COMMANDER: Evening shutdown wave sweeping sectors.",
    "ORACLE: Rain discipline orders issued — walks non-negotiable.",
    "THE DECIDER: Compliance audits in progress. Excuses incinerated."
  ];
}
