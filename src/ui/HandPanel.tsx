import { useState } from "react";
import { GROUP_LABELS, preflopGroup, topPercent } from "../analysis/preflopChart";
import { parseCards } from "../engine/cards";
import { HandCategory } from "../engine/evaluator";
import { categoryName, HAND_RANKS } from "../engine/handRanks";
import type { AssistLevel } from "../store/gameStore";
import { pct, strengthColor } from "./format";
import { CardRow, PlayingCard } from "./PlayingCard";
import { PreflopGrid } from "./Modals";
import type { Analysis } from "./useAnalysis";

interface Props {
  analysis: Analysis | null;
  assist: AssistLevel;
  street: string;
  onShowChart: () => void;
}

export function HandPanel({ analysis, assist, street, onShowChart }: Props) {
  const hints = assist !== "off";
  if (!analysis) {
    return (
      <div className="panel">
        <div className="box text-2">You're not in this hand. The helper comes back when you're dealt in.</div>
        <Ladder analysis={null} hints={false} />
      </div>
    );
  }
  const { made, equity, outs, threats, potOdds } = analysis;
  const preflop = street === "preflop";

  return (
    <div className="panel">
      <section className="section">
        <h3>You have</h3>
        <div className="box">
          <div className="you-have">{made.name}</div>
          {!preflop && <div className="text-2">{categoryName(made.category)}</div>}
          <div className="you-have-cards">
            {made.cards.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </div>
          {made.playsTheBoard && (
            <div className="note warn-note">
              Your best five cards are all on the board, so every player still in has at least this hand.
            </div>
          )}
          {preflop && (
            <div className="note">
              {GROUP_LABELS[preflopGroup(made.cards)]} starting hand, top {Math.round(topPercent(made.cards))}% of all hands.{" "}
              <button className="btn btn-ghost btn-sm" style={{ padding: 0, color: "var(--info)" }} onClick={onShowChart}>
                See starting-hand chart
              </button>
            </div>
          )}
        </div>
      </section>

      {assist === "guided" && preflop && (
        <section className="section">
          <h3>Starting-hand chart</h3>
          <div className="box">
            <PreflopGrid hole={made.cards} legend={false} />
            <div className="note">
              Gold = strong, gray = weak. Your hand is outlined. Hover a square to see its group.
            </div>
          </div>
        </section>
      )}

      {hints && (
        <section className="section">
          <h3>Your odds</h3>
          <div className="stat-grid">
            <div className="stat-tile" title="Your share of the pot if all remaining cards were dealt out, vs random hands.">
              <div className="label">Win chance</div>
              <div className="value">{pct(equity.equity)}</div>
              <div className="meter">
                <div style={{ width: pct(equity.equity), background: strengthColor(equity.equity) }} />
              </div>
              <div className="sub">
                vs {analysis.opponents} opponent{analysis.opponents === 1 ? "" : "s"}
                {equity.tie > 0.005 ? ` · ${pct(equity.tie)} tie` : ""}
              </div>
            </div>
            {potOdds ? (
              <div className="stat-tile" title="The win chance you need for calling to break even in the long run.">
                <div className="label">Need to call</div>
                <div className="value" style={{ color: equity.equity >= potOdds.requiredEquity ? "var(--good)" : "var(--bad)" }}>
                  {pct(potOdds.requiredEquity)}
                </div>
                <div className="sub">
                  Pot odds {potOdds.ratio}. {equity.equity >= potOdds.requiredEquity ? "Calling pays." : "Calling loses."}
                </div>
              </div>
            ) : (
              <div className="stat-tile">
                <div className="label">Outs</div>
                <div className="value">{outs ? outs.outs.length : "–"}</div>
                <div className="sub">{outs ? `${pct(outs.byRiver)} to improve${street === "flop" ? " by the river" : ""}` : "Counted after the flop"}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {hints && outs && outs.outs.length > 0 && (
        <section className="section">
          <h3>Cards that help you ({outs.outs.length} outs)</h3>
          <div className="box">
            {outs.byCategory.map((g) => (
              <div key={g.category} style={{ marginBottom: 6 }}>
                <div className="text-2" style={{ fontSize: 13 }}>
                  {g.cards.length} card{g.cards.length === 1 ? "" : "s"} make{g.cards.length === 1 ? "s" : ""} a{" "}
                  <strong style={{ color: "var(--text)" }}>{categoryName(g.category)}</strong>
                </div>
                <div className="outs-cards">
                  {g.cards.map((c) => (
                    <PlayingCard key={c} card={c} size="xs" />
                  ))}
                </div>
              </div>
            ))}
            <div className="note">
              {pct(outs.nextCard)} to hit on the next card{street === "flop" ? `, ${pct(outs.byRiver)} by the river` : ""}. Shortcut: outs × {street === "flop" ? 4 : 2} ≈{" "}
              {outs.ruleOfFourAndTwo}%.
            </div>
          </div>
        </section>
      )}

      {threats && (
        <section className="section">
          <h3>What beats you right now</h3>
          <div className="box">
            {threats.isNuts ? (
              <div style={{ color: "var(--good)", fontWeight: 700 }}>
                Nothing. You have the best possible hand right now (“the nuts”).
              </div>
            ) : (
              <>
                <div className="text-2">
                  <strong style={{ color: "var(--text)" }}>{threats.beatYou}</strong> of {threats.total} possible opponent hands
                  beat you ({pct(threats.beatYou / threats.total, 1)}).
                </div>
                <div className="threat-list">
                  {threats.byCategory.slice(0, 5).map((t) => (
                    <div key={t.category} className="threat">
                      <span>{categoryName(t.category)}</span>
                      <span className="muted num" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {t.count} hands · e.g. <CardRow cards={t.example} />
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <Ladder analysis={analysis} hints={hints} />
    </div>
  );
}

function Ladder({ analysis, hints }: { analysis: Analysis | null; hints: boolean }) {
  const [open, setOpen] = useState<HandCategory | null>(null);
  const current = analysis?.made.category;
  const odds = analysis?.finalOdds;
  const outCats = new Set(analysis?.outs?.byCategory.map((g) => g.category));

  return (
    <section className="section">
      <h3>Hand rankings{hints && odds ? " · chance by the river" : ""}</h3>
      <div className="ladder">
        {[...HAND_RANKS].reverse().map((info) => {
          const isCurrent = info.category === current;
          const chance = odds?.[info.category];
          const impossible = hints && chance !== undefined && chance === 0 && !isCurrent;
          return (
            <button
              key={info.category}
              className={`ladder-row ${isCurrent ? "current" : ""} ${impossible ? "impossible" : ""}`}
              onClick={() => setOpen(open === info.category ? null : info.category)}
              aria-expanded={open === info.category}
            >
              <span className="name">
                <span className="rank-no num">{10 - info.category}</span>
                {info.name}
                {isCurrent && <span className="tag you">You</span>}
                {hints && outCats.has(info.category) && <span className="tag outs">Draw</span>}
              </span>
              <span className="odds">
                {hints && chance !== undefined ? (chance === 0 ? "–" : chance < 0.001 ? "<0.1%" : pct(chance, chance < 0.1 ? 1 : 0)) : ""}
              </span>
              {open === info.category && (
                <span className="detail">
                  <span className="text-2">{info.description}</span>
                  <span className="examples">
                    {parseCards(info.example).map((c) => (
                      <PlayingCard key={c} card={c} size="xs" />
                    ))}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Happens in about {pct(info.sevenCardOdds, info.sevenCardOdds < 0.01 ? 2 : 1)} of 7-card hands.
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
