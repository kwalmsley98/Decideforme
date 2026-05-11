import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { CalendarClock, CircleDollarSign, CreditCard, MousePointerClick, Users } from "lucide-react";

function mondayKeyUtc(dateStr) {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function shortLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function buildChartRows(series, mode) {
  if (!Array.isArray(series) || !series.length) return [];
  if (mode !== "week") {
    return series.map((r) => ({
      period: r.date,
      label: shortLabel(r.date),
      clicks: r.clicks,
      signups: r.signups,
      earningsMajor: (Number(r.earnings_pence) || 0) / 100
    }));
  }
  const map = new Map();
  for (const r of series) {
    const mk = mondayKeyUtc(r.date);
    if (!map.has(mk)) {
      map.set(mk, { period: mk, label: shortLabel(mk), clicks: 0, signups: 0, earningsMajor: 0 });
    }
    const slot = map.get(mk);
    slot.clicks += r.clicks;
    slot.signups += r.signups;
    slot.earningsMajor += (Number(r.earnings_pence) || 0) / 100;
  }
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function DashTooltip({ active, payload, label, formatMoney }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="referral-dash-tooltip">
      <p className="referral-dash-tooltip-title">{label}</p>
      <p>Clicks: {row.clicks}</p>
      <p>Signups: {row.signups}</p>
      <p>Earnings: {formatMoney(row.earningsMajor)}</p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.loading
 * @param {string} props.error
 * @param {{
 *   clicks?: number,
 *   signups?: number,
 *   paying_users?: number,
 *   total_earnings_pence?: number,
 *   pending_payout_pence?: number,
 *   series?: Array<{ date: string, clicks: number, signups: number, earnings_pence: number }>,
 *   next_payout_date?: string | null
 * } | null} props.data
 * @param {string} props.currency — gbp | eur | usd
 */
export function ReferralEarningsDashboard({ loading, error, data, currency }) {
  const [chartMode, setChartMode] = useState("day");
  const loc = typeof navigator !== "undefined" ? navigator.language : "en-US";
  const code = String(currency || "usd").toUpperCase();

  const formatMoney = (major) =>
    new Intl.NumberFormat(loc, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(
      Number(major) || 0
    );

  const rows = useMemo(() => buildChartRows(data?.series || [], chartMode), [data?.series, chartMode]);

  const nextDateLabel = useMemo(() => {
    const raw = data?.next_payout_date;
    if (!raw || typeof raw !== "string") return "—";
    const [y, m, d] = raw.split("-").map(Number);
    if (!y || !m || !d) return raw;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(loc, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
  }, [data?.next_payout_date, loc]);

  if (loading) {
    return (
      <div className="referral-pro-dashboard referral-pro-dashboard--loading">
        <p className="meta">Loading your earnings dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="referral-pro-dashboard">
        <p className="error">{error}</p>
      </div>
    );
  }

  const clicks = Number(data?.clicks) || 0;
  const signups = Number(data?.signups) || 0;
  const paying = Number(data?.paying_users) || 0;
  const totalPence = Number(data?.total_earnings_pence) || 0;
  const pendingPence = Number(data?.pending_payout_pence) || 0;

  return (
    <div className="referral-pro-dashboard">
      <header className="referral-pro-dash-head">
        <div>
          <h2 className="referral-pro-dash-title">Your earnings</h2>
          <p className="muted referral-pro-dash-sub">
            Performance across your referral link — commissions accrue when referred users pay for Pro.
          </p>
        </div>
        <div className="referral-pro-dash-mode">
          <button
            type="button"
            className={`referral-dash-chip ${chartMode === "day" ? "referral-dash-chip--on" : ""}`}
            onClick={() => setChartMode("day")}
          >
            Daily
          </button>
          <button
            type="button"
            className={`referral-dash-chip ${chartMode === "week" ? "referral-dash-chip--on" : ""}`}
            onClick={() => setChartMode("week")}
          >
            Weekly
          </button>
        </div>
      </header>

      <div className="referral-stat-grid">
        <article className="referral-stat-card">
          <div className="referral-stat-card-icon" aria-hidden="true">
            <CircleDollarSign size={22} strokeWidth={2} />
          </div>
          <p className="referral-stat-label">Total earnings</p>
          <p className="referral-stat-value">{formatMoney(totalPence / 100)}</p>
          <p className="referral-stat-hint">Lifetime commissions</p>
        </article>
        <article className="referral-stat-card">
          <div className="referral-stat-card-icon" aria-hidden="true">
            <CreditCard size={22} strokeWidth={2} />
          </div>
          <p className="referral-stat-label">Paying users</p>
          <p className="referral-stat-value">{paying.toLocaleString(loc)}</p>
          <p className="referral-stat-hint">Unique referred subscribers</p>
        </article>
        <article className="referral-stat-card">
          <div className="referral-stat-card-icon" aria-hidden="true">
            <Users size={22} strokeWidth={2} />
          </div>
          <p className="referral-stat-label">Total signups</p>
          <p className="referral-stat-value">{signups.toLocaleString(loc)}</p>
          <p className="referral-stat-hint">Attributed accounts</p>
        </article>
        <article className="referral-stat-card">
          <div className="referral-stat-card-icon" aria-hidden="true">
            <MousePointerClick size={22} strokeWidth={2} />
          </div>
          <p className="referral-stat-label">Link clicks</p>
          <p className="referral-stat-value">{clicks.toLocaleString(loc)}</p>
          <p className="referral-stat-hint">All-time link visits</p>
        </article>
      </div>

      <article className="referral-dash-payout-card">
        <div className="referral-dash-payout-icon" aria-hidden="true">
          <CalendarClock size={24} strokeWidth={2} />
        </div>
        <div className="referral-dash-payout-body">
          <p className="referral-dash-payout-kicker">Next payout</p>
          <p className="referral-dash-payout-amount">{formatMoney(pendingPence / 100)}</p>
          <p className="referral-dash-payout-meta">
            Estimated balance from commissions not yet transferred to your bank. Payouts are processed around{" "}
            <strong>{nextDateLabel}</strong> (1st of the month, UTC), once your Stripe Connect account is onboarded.
          </p>
          <p className="muted referral-dash-payout-foot">
            Connect your bank from Profile if you haven&apos;t already. Totals depend on referred subscribers paying
            invoices.
          </p>
        </div>
      </article>

      <article className="referral-dash-chart-card">
        <div className="referral-dash-chart-head">
          <p className="referral-dash-chart-title">Activity</p>
          <p className="muted referral-dash-chart-sub">Clicks &amp; signups (bars) · Earnings (line)</p>
        </div>
        <div className="referral-dash-chart-wrap">
          {rows.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(200,210,235,0.55)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "rgba(200,210,235,0.55)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={40}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "rgba(200,210,235,0.55)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatMoney(v)}
                  width={56}
                />
                <Tooltip content={(props) => <DashTooltip {...props} formatMoney={formatMoney} />} />
                <Legend wrapperStyle={{ paddingTop: 12, color: "rgba(200, 210, 235, 0.78)" }} />
                <Bar yAxisId="left" dataKey="clicks" name="Clicks" fill="rgba(99, 102, 241, 0.85)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="left" dataKey="signups" name="Signups" fill="rgba(34, 197, 94, 0.85)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="earningsMajor"
                  name="Earnings"
                  stroke="#c4b5fd"
                  strokeWidth={2.5}
                  dot={{ r: 2, fill: "#c4b5fd" }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="meta referral-dash-chart-empty">No activity in this window yet — share your link to populate the chart.</p>
          )}
        </div>
      </article>
    </div>
  );
}
