/** Life Mode v2 — tactical orders generation (no chat; orders only). */

export const LIFE_CODENAMES = ["COMMANDER", "ORACLE", "THE DECIDER"];

export function pickCodename() {
  return LIFE_CODENAMES[Math.floor(Math.random() * LIFE_CODENAMES.length)];
}

/** @typedef {'morning'|'midday'|'evening'|'night'} DayPhase */

/**
 * @param {number} hour Local hour 0–23
 * @returns {DayPhase}
 */
export function getDayPhase(hour) {
  if (hour >= 21 || hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

/**
 * @param {number} lat
 * @param {number} lng
 */
export async function fetchOpenMeteoCurrent(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`;
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
export function buildLifeOrders({ setup, phase, weather, rankName, operatorName = "Operator" }) {
  const { wakeHour, dayType, energy, intensity, codename } = setup;
  const I = (s) => intensityPrefix(intensity, s);
  const rain = weather?.isRainy;
  const cold = typeof weather?.tempC === "number" && weather.tempC < 8;
  const hot = typeof weather?.tempC === "number" && weather.tempC > 28;

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

  const wakeLabel = String(wakeHour).padStart(2, "0") + "00";

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
      timeLabel: "0730",
      text: energyFood,
      phase
    });
    orders.push({
      id: "m2",
      timeLabel: "0900",
      text: I("You will consume a nutritious breakfast. No exceptions."),
      phase
    });
    orders.push({
      id: "m3",
      timeLabel: "0930",
      text: dayType === "work" ? workBlock : I("You will move before noon. Light counts."),
      phase
    });
    orders.push({
      id: "m4",
      timeLabel: "1000",
      text: weatherWalk,
      phase
    });
  } else if (phase === "midday") {
    orders.push({
      id: "d0",
      timeLabel: "1200",
      text: I("Midday refuel. Eat. No desk crumbs."),
      phase
    });
    orders.push({
      id: "d1",
      timeLabel: "1230",
      text: dayType === "work" ? I("You will close one priority task before distractions.") : I("You will do one high-leverage task anyway."),
      phase
    });
    orders.push({
      id: "d2",
      timeLabel: "1400",
      text: I(`${rankName}, hydrate. That bottle is not decoration.`),
      phase
    });
    orders.push({
      id: "d3",
      timeLabel: "1500",
      text: rain === true ? I("Rain continues. Your discipline continues.") : weatherWalk,
      phase
    });
  } else if (phase === "evening") {
    orders.push({
      id: "e0",
      timeLabel: "1730",
      text: I("Shutdown sequence begins. Inbox is not your life."),
      phase
    });
    orders.push({
      id: "e1",
      timeLabel: "1830",
      text: I("You will eat a controlled dinner. Portion discipline."),
      phase
    });
    orders.push({
      id: "e2",
      timeLabel: "1900",
      text: I(`Walk or mobility — ${operatorName}, you finish the day moving.`),
      phase
    });
    orders.push({
      id: "e3",
      timeLabel: "2000",
      text: I("Prepare tomorrow's battlefield tonight: clothes, bag, plan."),
      phase
    });
  } else {
    orders.push({
      id: "n0",
      timeLabel: "2100",
      text: I("Night protocol. Put the phone down. You have 30 minutes to decompress."),
      phase
    });
    orders.push({
      id: "n1",
      timeLabel: "2130",
      text: I("Screens off. The war continues tomorrow."),
      phase
    });
    orders.push({
      id: "n2",
      timeLabel: "2230",
      text: I("Sleep by 2230. Fatigue is how mistakes multiply."),
      phase
    });
  }

  return orders;
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
