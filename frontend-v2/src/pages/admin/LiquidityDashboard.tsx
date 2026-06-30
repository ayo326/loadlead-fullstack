/**
 * LiquidityDashboard
 *
 * Drop-in admin panel for your beta management dashboard. Fetches
 * GET /api/admin/liquidity and renders the gate dials, per lane fill,
 * and the cumulative fill rate by lane chart.
 *
 * Requires recharts:  npm i recharts
 * Styling is self contained inline styles in the LoadLead palette, so it drops
 * into any React app without assuming Tailwind or a CSS framework.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

const NAVY = "#0E1A38";
const CARD = "#16223F";
const INK = "#E8EEFB";
const MUTE = "#9DAAC9";
const BLUE = "#5B8DEF";
const GREEN = "#34D399";
const AMBER = "#FBBF24";
const CORAL = "#F87171";
const VIOLET = "#A78BFA";
const LANE_COLORS = [BLUE, GREEN, AMBER, CORAL, VIOLET, "#22D3EE", "#F472B6"];

interface Dials {
  loadsPosted: number;
  loadsCovered: number;
  fillRate: number;
  avgTimeToCoverHours: number | null;
  noShows: number;
  trustIncidents: number;
  avgBroadcastSize: number | null;
}
interface LaneFill {
  lane: string;
  posted: number;
  covered: number;
  fillRate: number;
}
type CumulativePoint = { weekStart: string } & Record<string, number | string | null>;
interface LiquidityResult {
  range: { from: string; to: string; weeks: number };
  lanes: string[];
  dials: Dials;
  byLane: LaneFill[];
  cumulativeByLaneOverTime: CumulativePoint[];
  avgTimeToCoverByLaneOverTime: CumulativePoint[];
  gateTargets: { fillRate: number; maxTimeToCoverHours: number; trustIncidents: number };
  generatedAt: string;
}

const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Math.round(n * 100)}%`);

function LaneTrendChart(props: {
  title: string;
  data: CumulativePoint[];
  lanes: string[];
  yMax: number | "auto";
  yFormat: (v: number) => string;
  tooltipFormat: (v: any) => string;
  gateY: number;
  gateLabel: string;
}) {
  const { title, data, lanes, yMax, yFormat, tooltipFormat, gateY, gateLabel } = props;
  return (
    <div style={{ background: CARD, borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{title}</div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#243352" vertical={false} />
          <XAxis dataKey="weekStart" stroke={MUTE} tick={{ fontSize: 11, fill: MUTE }} />
          <YAxis
            domain={[0, yMax]}
            tickFormatter={yFormat}
            stroke={MUTE}
            tick={{ fontSize: 11, fill: MUTE }}
            width={44}
          />
          <Tooltip
            contentStyle={{ background: NAVY, border: `1px solid ${CARD}`, borderRadius: 8, color: INK }}
            formatter={tooltipFormat}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine
            y={gateY}
            stroke={GREEN}
            strokeDasharray="4 4"
            label={{ value: gateLabel, fill: GREEN, fontSize: 11, position: "right" }}
          />
          {lanes.map((lane, i) => (
            <Line
              key={lane}
              type="monotone"
              dataKey={lane}
              stroke={LANE_COLORS[i % LANE_COLORS.length]}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function LiquidityDashboard() {
  const [weeks, setWeeks] = useState(8);
  const [data, setData] = useState<LiquidityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Record-event form. Posts to the beta-admin trust store (no-show / trust
  // incident), which is separate from the Load model; it references ids only.
  const [evType, setEvType] = useState<"NO_SHOW" | "TRUST_INCIDENT">("NO_SHOW");
  const [evLoadId, setEvLoadId] = useState("");
  const [evCarrierId, setEvCarrierId] = useState("");
  const [evNote, setEvNote] = useState("");
  const [evBusy, setEvBusy] = useState(false);
  const [evMsg, setEvMsg] = useState<string | null>(null);

  async function recordEvent(e: FormEvent) {
    e.preventDefault();
    if (!evLoadId.trim() || !evCarrierId.trim()) {
      setEvMsg("Load id and carrier id are required.");
      return;
    }
    setEvBusy(true);
    setEvMsg(null);
    try {
      const r = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/admin/beta/trust-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eventType: evType,
          loadId: evLoadId.trim(),
          carrierId: evCarrierId.trim(),
          note: evNote.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      setEvLoadId("");
      setEvCarrierId("");
      setEvNote("");
      setEvMsg("Recorded. The dial reflects it within the 60 second cache window.");
      setReload((n) => n + 1);
    } catch (err: any) {
      setEvMsg(err?.message || "Failed to record");
    } finally {
      setEvBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/admin/liquidity?weeks=${weeks}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((d: LiquidityResult) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weeks, reload]);

  const gate = data?.gateTargets;
  const fillOk = data ? data.dials.fillRate >= (gate?.fillRate ?? 0.65) : false;
  const ttcOk = data
    ? data.dials.avgTimeToCoverHours != null &&
      data.dials.avgTimeToCoverHours <= (gate?.maxTimeToCoverHours ?? 4)
    : false;
  const trustOk = data ? data.dials.trustIncidents <= (gate?.trustIncidents ?? 0) : false;

  const dialCards = useMemo(() => {
    if (!data) return [];
    const d = data.dials;
    return [
      { label: "Loads posted", value: String(d.loadsPosted), tone: INK },
      { label: "Loads covered", value: String(d.loadsCovered), tone: GREEN },
      { label: "Fill rate", value: pct(d.fillRate), tone: fillOk ? GREEN : AMBER },
      {
        label: "Avg time to cover",
        value: d.avgTimeToCoverHours == null ? "n/a" : `${d.avgTimeToCoverHours} h`,
        tone: ttcOk ? GREEN : AMBER,
      },
      { label: "No-shows", value: String(d.noShows), tone: d.noShows ? AMBER : INK },
      { label: "Trust incidents", value: String(d.trustIncidents), tone: trustOk ? INK : CORAL },
    ];
  }, [data, fillOk, ttcOk, trustOk]);

  return (
    <div className="liq-panel" style={{ background: NAVY, color: INK, padding: 20, borderRadius: 12, fontFamily: "Calibri, Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#fff" }}>Lane Liquidity</h2>
        <label style={{ fontSize: 13, color: MUTE }}>
          Window&nbsp;
          <select
            value={weeks}
            onChange={(e) => setWeeks(parseInt(e.target.value, 10))}
            style={{ background: CARD, color: INK, border: `1px solid ${CARD}`, borderRadius: 6, padding: "4px 8px" }}
          >
            {[4, 8, 12, 16, 26].map((w) => (
              <option key={w} value={w}>
                {w} weeks
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: MUTE }}>
        Gate: cover 60 to 70 percent or better, average time to cover under 4 hours, zero trust incidents.
      </p>

      {loading && <div style={{ color: MUTE, padding: 24 }}>Loading...</div>}
      {error && <div style={{ color: CORAL, padding: 24 }}>Could not load liquidity: {error}</div>}

      {data && !loading && (
        <>
          {/* dials */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {dialCards.map((c) => (
              <div key={c.label} style={{ background: CARD, borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: MUTE, marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: c.tone }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* record a no-show or trust incident -> populates the two dials above */}
          <form
            onSubmit={recordEvent}
            style={{ background: CARD, borderRadius: 10, padding: "14px 16px", marginTop: 12 }}
          >
            <div style={{ fontSize: 13, color: INK, fontWeight: 600, marginBottom: 2 }}>
              Record a trust or no-show event
            </div>
            <div style={{ fontSize: 11, color: MUTE, marginBottom: 10 }}>
              Stored in the beta-admin trust events store, separate from the load record. References the load and carrier by id.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <select
                value={evType}
                onChange={(e) => setEvType(e.target.value as "NO_SHOW" | "TRUST_INCIDENT")}
                style={{ background: NAVY, color: INK, border: `1px solid ${NAVY}`, borderRadius: 6, padding: "6px 8px" }}
              >
                <option value="NO_SHOW">No-show</option>
                <option value="TRUST_INCIDENT">Trust incident</option>
              </select>
              <input
                value={evLoadId}
                onChange={(e) => setEvLoadId(e.target.value)}
                placeholder="Load id"
                style={{ background: NAVY, color: INK, border: `1px solid ${NAVY}`, borderRadius: 6, padding: "6px 8px", minWidth: 150 }}
              />
              <input
                value={evCarrierId}
                onChange={(e) => setEvCarrierId(e.target.value)}
                placeholder="Carrier id"
                style={{ background: NAVY, color: INK, border: `1px solid ${NAVY}`, borderRadius: 6, padding: "6px 8px", minWidth: 150 }}
              />
              <input
                value={evNote}
                onChange={(e) => setEvNote(e.target.value)}
                placeholder="Note (optional)"
                style={{ background: NAVY, color: INK, border: `1px solid ${NAVY}`, borderRadius: 6, padding: "6px 8px", flex: 1, minWidth: 160 }}
              />
              <button
                type="submit"
                disabled={evBusy}
                style={{
                  background: evBusy ? MUTE : BLUE,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "7px 14px",
                  fontWeight: 600,
                  cursor: evBusy ? "default" : "pointer",
                }}
              >
                {evBusy ? "Recording..." : "Record"}
              </button>
            </div>
            {evMsg && <div style={{ fontSize: 12, color: MUTE, marginTop: 8 }}>{evMsg}</div>}
          </form>

          {/* charts: fill rate and time to cover trend together */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: 16,
              marginTop: 16,
            }}
          >
            <LaneTrendChart
              title="Cumulative fill rate by lane (to date)"
              data={data.cumulativeByLaneOverTime}
              lanes={data.lanes}
              yMax={1}
              yFormat={(v) => `${Math.round(v * 100)}%`}
              tooltipFormat={(v: any) => (v == null ? "n/a" : `${Math.round(Number(v) * 100)}%`)}
              gateY={data.gateTargets.fillRate}
              gateLabel={`gate ${Math.round(data.gateTargets.fillRate * 100)}%`}
            />
            <LaneTrendChart
              title="Avg time to cover by lane (to date)"
              data={data.avgTimeToCoverByLaneOverTime}
              lanes={data.lanes}
              yMax="auto"
              yFormat={(v) => `${v}h`}
              tooltipFormat={(v: any) => (v == null ? "n/a" : `${Number(v)} h`)}
              gateY={data.gateTargets.maxTimeToCoverHours}
              gateLabel={`gate ${data.gateTargets.maxTimeToCoverHours}h`}
            />
          </div>

          {/* per lane table */}
          <div style={{ background: CARD, borderRadius: 10, padding: 16, marginTop: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 8 }}>Fill rate by lane</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: MUTE, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Lane</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Posted</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Covered</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Fill rate</th>
                </tr>
              </thead>
              <tbody>
                {data.byLane.map((l) => (
                  <tr key={l.lane} style={{ borderTop: "1px solid #243352" }}>
                    <td style={{ padding: "6px 8px" }}>{l.lane}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{l.posted}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{l.covered}</td>
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        fontWeight: 700,
                        color: l.fillRate >= data.gateTargets.fillRate ? GREEN : AMBER,
                      }}
                    >
                      {pct(l.fillRate)}
                    </td>
                  </tr>
                ))}
                {data.byLane.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "12px 8px", color: MUTE }}>
                      No loads logged in this window yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, color: MUTE, marginTop: 10 }}>
            Updated {new Date(data.generatedAt).toLocaleString()}.
          </div>
        </>
      )}
    </div>
  );
}
