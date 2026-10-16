import { BOT_PROFILES } from "../ai/profiles";
import { VARIANTS } from "../engine/variants";
import { rate } from "../stats/tracker";
import { useGameStore } from "../store/gameStore";
import { chips, pct, signed } from "./format";
import { ASSIST_LEVELS } from "./Modals";

/** Variants on the roadmap; shown so players know what's coming. */
const UPCOMING = [
  { id: "omaha", name: "Omaha", description: "4 hole cards, and you must use exactly 2 of them. Big draws, big pots." },
  { id: "draw", name: "Five-Card Draw", description: "The classic: 5 private cards, swap some, then bet." },
  { id: "stud", name: "Seven-Card Stud", description: "No shared cards; some of each hand is dealt face up." },
];

const BLINDS = [10, 20, 50, 100];
const STACKS_BB = [50, 100, 200];

export function Lobby() {
  const { setup, updateSetup, settings, updateSettings, sitDown, lifetime } = useGameStore();

  return (
    <div className="lobby">
      <div className="lobby-inner">
        <div className="hero">
          <h1>Learn poker by playing it.</h1>
          <p>
            Sit down against computer opponents with real personalities. While you play, a helper panel shows what hand you
            have, your odds, what beats you, and, if you want, what a solid player would do and why.
          </p>
        </div>

        <section>
          <h2>Game</h2>
          <div className="choice-grid">
            {Object.values(VARIANTS).map((v) => (
              <button key={v.id} className="choice" aria-pressed={setup.variantId === v.id} onClick={() => updateSetup({ variantId: v.id })}>
                <span className="title">{v.name}</span>
                <span className="desc">{v.shortDescription}</span>
              </button>
            ))}
            {UPCOMING.map((v) => (
              <button key={v.id} className="choice" disabled>
                <span className="title">
                  {v.name} <span className="soon">Coming soon</span>
                </span>
                <span className="desc">{v.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2>Table</h2>
          <div className="form-row">
            <label>
              Opponents
              <select value={setup.bots} onChange={(e) => updateSetup({ bots: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>{n === 1 ? "1 (heads-up)" : n}</option>
                ))}
              </select>
            </label>
            <label>
              Opponent style
              <select value={setup.botStyle} onChange={(e) => updateSetup({ botStyle: e.target.value })}>
                <option value="mixed">Mixed table</option>
                {Object.values(BOT_PROFILES).map((p) => (
                  <option key={p.id} value={p.id}>All {p.name}s</option>
                ))}
              </select>
            </label>
            <label>
              Blinds
              <select value={setup.bigBlind} onChange={(e) => updateSetup({ bigBlind: Number(e.target.value) })}>
                {BLINDS.map((bb) => (
                  <option key={bb} value={bb}>{chips(bb / 2)} / {chips(bb)}</option>
                ))}
              </select>
            </label>
            <label>
              Starting chips
              <select
                value={setup.startingStack / setup.bigBlind}
                onChange={(e) => updateSetup({ startingStack: Number(e.target.value) * setup.bigBlind })}
              >
                {STACKS_BB.map((n) => (
                  <option key={n} value={n}>{chips(n * setup.bigBlind)} ({n} big blinds)</option>
                ))}
              </select>
            </label>
          </div>
          <div className="choice-grid" style={{ marginTop: 12 }}>
            {Object.values(BOT_PROFILES).map((p) => (
              <div key={p.id} className="choice" style={{ cursor: "default" }}>
                <span className="title">{p.name}</span>
                <span className="desc">{p.description}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Assistance</h2>
          <div className="choice-grid">
            {ASSIST_LEVELS.map((l) => (
              <button key={l.id} className="choice" aria-pressed={settings.assist === l.id} onClick={() => updateSettings({ assist: l.id })}>
                <span className="title">{l.name}</span>
                <span className="desc">{l.description}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="lobby-actions">
          <button className="btn btn-primary" onClick={sitDown}>Sit down</button>
          {lifetime.handsPlayed > 0 && (
            <span className="muted">
              All time: {chips(lifetime.handsPlayed)} hands · {signed(lifetime.netChips)} chips · won{" "}
              {pct(rate(lifetime.handsWon, lifetime.handsPlayed))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
