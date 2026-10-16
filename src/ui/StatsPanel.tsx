import { useRef, useState } from "react";
import { HAND_RANKS } from "../engine/handRanks";
import { type PlayerStats, rate, type SessionStats } from "../stats/tracker";
import { useGameStore } from "../store/gameStore";
import { chips, pct, signed } from "./format";

interface TileProps {
  label: string;
  value: string;
  sub?: string;
  help?: string;
  tone?: "good" | "bad" | "warn";
}

function Tile({ label, value, sub, help, tone }: TileProps) {
  return (
    <div className="stat-tile" title={help}>
      <div className="label">{label}{help && <span aria-hidden>ⓘ</span>}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Coaching note on a VPIP/PFR value against a typical solid range. */
function rangeNote(value: number | null, lo: number, hi: number): { sub: string; tone?: TileProps["tone"] } {
  if (value === null) return { sub: `Solid players: ${lo}–${hi}%` };
  const v = value * 100;
  if (v < lo) return { sub: `Tight. Solid range is ${lo}–${hi}%`, tone: "warn" };
  if (v > hi) return { sub: `Loose. Solid range is ${lo}–${hi}%`, tone: "warn" };
  return { sub: `In the solid ${lo}–${hi}% range`, tone: "good" };
}

function StatBlock({ stats }: { stats: PlayerStats }) {
  const vpip = rate(stats.vpipHands, stats.handsPlayed);
  const pfr = rate(stats.pfrHands, stats.handsPlayed);
  const vpipNote = stats.handsPlayed >= 10 ? rangeNote(vpip, 18, 28) : { sub: "Needs 10+ hands" };
  const pfrNote = stats.handsPlayed >= 10 ? rangeNote(pfr, 12, 22) : { sub: "Needs 10+ hands" };
  return (
    <div className="stat-grid">
      <Tile label="Hands played" value={chips(stats.handsPlayed)} sub={`${chips(stats.handsWon)} won (${pct(rate(stats.handsWon, stats.handsPlayed))})`} />
      <Tile
        label="Net chips"
        value={signed(stats.netChips)}
        tone={stats.netChips > 0 ? "good" : stats.netChips < 0 ? "bad" : undefined}
        sub={`Biggest pot ${chips(stats.biggestPotWon)}`}
      />
      <Tile
        label="VPIP"
        value={pct(vpip)}
        help="Voluntarily Put money In Pot: how often you call or raise before the flop (blinds don't count). Beginners usually play too many hands."
        {...vpipNote}
      />
      <Tile
        label="PFR"
        value={pct(pfr)}
        help="Pre-Flop Raise: how often you raise before the flop. Winning players raise most of the hands they play."
        {...pfrNote}
      />
      <Tile
        label="Showdowns won"
        value={pct(rate(stats.showdownsWon, stats.showdowns))}
        sub={`${stats.showdownsWon} of ${stats.showdowns} showdowns`}
        help="When cards are revealed at the end, how often you have the best hand."
      />
      <Tile
        label="Agreed with coach"
        value={pct(rate(stats.coachAgreed, stats.coachDecisions))}
        sub={`${stats.coachDecisions} decisions with Coach on`}
        help="How often your action matched the coach's suggestion (Coach or Guided assist level)."
      />
    </div>
  );
}

function StackChart({ history }: { history: number[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (history.length < 2) return <div className="box muted">Play a few hands to see your stack over time.</div>;

  const W = 340;
  const H = 140;
  const pad = { l: 40, r: 8, t: 8, b: 20 };
  const max = Math.max(...history);
  const min = Math.min(0, ...history);
  const niceMax = niceCeil(max);
  const x = (i: number) => pad.l + (i / (history.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (niceMax - min)) * (H - pad.t - pad.b);
  const path = history.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${path}L${x(history.length - 1)},${y(min)}L${x(0)},${y(min)}Z`;
  const ticks = [min, (min + niceMax) / 2, niceMax];

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (history.length - 1));
    setHover(Math.max(0, Math.min(history.length - 1, i)));
  };

  const last = history.length - 1;
  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={ref}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Stack over ${last} hands, from ${history[0]} to ${history[last]}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={pad.l - 6} y={y(t) + 3} textAnchor="end">{compact(t)}</text>
          </g>
        ))}
        <text className="axis-label" x={pad.l} y={H - 4}>Hand 0</text>
        <text className="axis-label" x={W - pad.r} y={H - 4} textAnchor="end">{last}</text>
        <path className="area" d={area} />
        <path className="series" d={path} />
        <circle cx={x(last)} cy={y(history[last])} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        {hover !== null && (
          <>
            <line className="baseline" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
            <circle cx={x(hover)} cy={y(history[hover])} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </>
        )}
        {/* Transparent hit area so hovering anywhere over the plot works. */}
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" />
      </svg>
      {hover !== null && (
        <div
          className="chart-tooltip num"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(history[hover]) / H) * 100}%` }}
        >
          Hand {hover}: <strong>{chips(history[hover])}</strong>
        </div>
      )}
    </div>
  );
}

function CategoryBars({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return <div className="box muted">Win a showdown to see which hands win you pots.</div>;
  const max = Math.max(...counts);
  return (
    <div className="bars">
      {[...HAND_RANKS].reverse().filter((r) => counts[r.category] > 0).map((r) => (
        <div key={r.category} className="bar-row" title={`${r.name}: ${counts[r.category]} showdown wins (${pct(counts[r.category] / total)})`}>
          <span className="text-2">{r.name}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ display: "block", width: `${(counts[r.category] / max) * 100}%` }} />
          </span>
          <span className="num">{counts[r.category]}</span>
        </div>
      ))}
    </div>
  );
}

const compact = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(Math.round(n)));
function niceCeil(n: number) {
  if (n <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (mag / 2)) * (mag / 2);
}

export function StatsPanel() {
  const session = useGameStore((s) => s.session) as SessionStats;
  const lifetime = useGameStore((s) => s.lifetime);
  const resetLifetime = useGameStore((s) => s.resetLifetime);
  // Native confirm() dialogs aren't reliable in the desktop webview, so confirm with a second click.
  const [confirming, setConfirming] = useState(false);
  const onReset = () => {
    if (confirming) resetLifetime();
    setConfirming(!confirming);
  };
  return (
    <div className="panel">
      <section className="section">
        <h3>This session</h3>
        <StatBlock stats={session} />
      </section>
      <section className="section">
        <h3>Your stack</h3>
        <StackChart history={session.stackHistory} />
      </section>
      <section className="section">
        <h3>Showdowns won with</h3>
        <CategoryBars counts={session.wonByCategory} />
      </section>
      <section className="section">
        <h3 style={{ display: "flex", justifyContent: "space-between" }}>
          All time
          <button className="btn btn-ghost btn-sm" style={{ padding: 0, textTransform: "none", letterSpacing: 0 }} onClick={onReset} onBlur={() => setConfirming(false)}>
            {confirming ? "Click again to reset" : "Reset"}
          </button>
        </h3>
        <StatBlock stats={lifetime} />
      </section>
    </div>
  );
}
