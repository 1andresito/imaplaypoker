import { useEffect, useState } from "react";
import { BOT_PROFILES } from "../ai/profiles";
import type { Card } from "../engine/cards";
import { potTotal } from "../engine/gameState";
import { categoryName } from "../engine/handRanks";
import type { GameState, HandEvent, PlayerState } from "../engine/types";
import { useGameStore } from "../store/gameStore";
import { chips } from "./format";
import { PlayingCard } from "./PlayingCard";

interface Props {
  game: GameState;
  /** Cards to highlight (your best five), when the Hand Helper is on. */
  highlight: readonly Card[];
}

const STREET_NAMES = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" } as const;

/** Avatar colors per bot style, so you can tell personalities apart at a glance. */
export const STYLE_COLORS: Record<string, string> = {
  rock: "#a9bccd",
  tag: "#62b3f0",
  lag: "#f0846f",
  station: "#c9a3f2",
};

/** Seat positions around the oval: you sit at the bottom center, bots go clockwise. */
function seatPosition(index: number, count: number) {
  const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
  return { x: 50 + 43 * Math.cos(angle), y: 50 + 42 * Math.sin(angle) };
}

type BubbleKind = "fold" | "check" | "call" | "raise" | "allin" | "blind" | "win" | "thinking";

/** The player's most recent action on this street, as a speech bubble. */
function lastAction(history: HandEvent[], player: PlayerState): { text: string; kind: BubbleKind } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.kind === "deal") return null;
    if (e.kind === "blind" && e.playerId === player.id) {
      return { text: `${e.blind === "small" ? "Small" : "Big"} blind ${chips(e.amount)}`, kind: "blind" };
    }
    if (e.kind === "action" && e.playerId === player.id) {
      if (e.allIn && e.type !== "fold") return { text: `ALL-IN ${chips(e.to)}!`, kind: "allin" };
      switch (e.type) {
        case "fold": return { text: "Fold", kind: "fold" };
        case "check": return { text: "Check", kind: "check" };
        case "call": return { text: `Call ${chips(e.amount)}`, kind: "call" };
        case "bet": return { text: `Bet ${chips(e.to)}`, kind: "raise" };
        case "raise": return { text: `Raise to ${chips(e.to)}`, kind: "raise" };
      }
    }
  }
  return null;
}

export function Table({ game, highlight }: Props) {
  const { players, outcome } = game;
  const myId = useGameStore((s) => s.myId);
  const away = useGameStore((s) => s.away);
  const turnEndsAt = useGameStore((s) => s.turnEndsAt);
  const turnSeconds = useGameStore((s) => s.room?.turnSeconds ?? 0);
  const humanIndex = Math.max(0, players.findIndex((p) => p.id === myId));
  const done = game.phase === "complete";

  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="felt-center">
        <div className="board">
          {game.board.map((c) => (
            <PlayingCard key={c} card={c} highlight={highlight.includes(c)} dim={highlight.length > 0 && !highlight.includes(c)} />
          ))}
          {Array.from({ length: 5 - game.board.length }, (_, i) => (
            <div key={i} className="slot" />
          ))}
        </div>
        {done && outcome ? (
          <FeltResult game={game} />
        ) : (
          <div className="pot-row">
            <span className="street-label">{STREET_NAMES[game.street]}</span>
            <div className="pot num">
              <span className="chip-dot" /> <span className="lbl">POT</span> {chips(potTotal(game))}
            </div>
          </div>
        )}
      </div>

      {players.map((p, i) => {
        const rel = (i - humanIndex + players.length) % players.length;
        const pos = seatPosition(rel, players.length);
        // "isHuman" here means "you": the seat at the bottom with big cards.
        const isHuman = p.id === myId;
        const isAway = away.includes(p.id);
        // Bets sit between the seat and the center of the table; yours sits beside your cards.
        const betPos = isHuman ? { x: 34, y: 82 } : { x: 50 + (pos.x - 50) * 0.62, y: 50 + (pos.y - 50) * 0.62 };
        const shownHand = done && outcome?.showdown && !p.folded ? outcome.hands[p.id] : undefined;
        const showCards = isHuman || !!shownHand;
        const won = outcome?.payouts[p.id];
        const toAct = game.phase === "betting" && game.toAct === i;
        const profile = p.botProfile ? BOT_PROFILES[p.botProfile] : undefined;

        let bubble: { text: string; kind: BubbleKind } | null;
        if (p.busted) bubble = null;
        else if (toAct && !isHuman) bubble = { text: "", kind: "thinking" };
        else if (done && won) bubble = { text: `Wins ${chips(won)}${shownHand ? ` · ${categoryName(shownHand.category)}` : ""}`, kind: "win" };
        else if (shownHand) bubble = { text: categoryName(shownHand.category), kind: "check" };
        else if (p.folded) bubble = { text: "Folded", kind: "fold" };
        else bubble = done ? null : lastAction(game.history, p);

        const cls = [
          "seat",
          isHuman && "human",
          p.folded && "folded",
          p.busted && "busted",
          toAct && "to-act",
          won && "winner",
        ].filter(Boolean).join(" ");

        return (
          <div key={p.id}>
            <div className={cls} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              <div className="hole">
                {!p.busted &&
                  (isHuman || !p.folded) &&
                  p.hole.map((c, j) =>
                    showCards ? (
                      <PlayingCard
                        key={j}
                        card={c}
                        size={isHuman ? "lg" : "sm"}
                        highlight={highlight.includes(c)}
                        dim={p.folded}
                      />
                    ) : (
                      <PlayingCard key={j} faceDown size="sm" />
                    ),
                  )}
              </div>
              <div className="seat-plate" title={profile?.description}>
                {bubble && (
                  <div className={`bubble ${bubble.kind}`}>
                    {bubble.kind === "thinking" ? (
                      <span className="think" aria-label="Thinking"><i /><i /><i /></span>
                    ) : (
                      bubble.text
                    )}
                  </div>
                )}
                {i === game.dealer && <div className="dealer-btn" title="Dealer button">D</div>}
                {toAct && turnEndsAt !== null && turnSeconds > 0 && <TurnClock endsAt={turnEndsAt} totalMs={turnSeconds * 1000} />}
                <div
                  className="avatar"
                  style={{ background: isHuman ? "var(--accent)" : p.isHuman ? "var(--info)" : STYLE_COLORS[p.botProfile ?? "tag"] }}
                  aria-hidden
                >
                  {isHuman ? "★" : p.name[0]}
                </div>
                <div className="seat-info">
                  <span className="seat-name">{p.name}</span>
                  <span className="seat-stack num">{p.busted ? "Out" : chips(p.stack)}</span>
                </div>
              </div>
              {isAway ? (
                <div className="seat-style away" title="Disconnected. Their turns are checked or folded until they come back.">Away</div>
              ) : (
                profile && <div className="seat-style">{profile.name}</div>
              )}
            </div>
            {!done && p.streetBet > 0 && (
              <div className="bet-chip num" style={{ left: `${betPos.x}%`, top: `${betPos.y}%` }}>
                <span className="chip-dot" />
                {chips(p.streetBet)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Shrinking bar under the acting player's name while their turn timer runs. */
function TurnClock({ endsAt, totalMs }: { endsAt: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, endsAt - now);
  const frac = Math.min(1, left / totalMs);
  return (
    <div className={`turn-clock ${left < 6000 ? "low" : ""}`} role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div style={{ width: `${frac * 100}%` }} />
    </div>
  );
}

function FeltResult({ game }: { game: GameState }) {
  const outcome = game.outcome!;
  const myId = useGameStore((s) => s.myId);
  const name = (id: string) => (id === myId ? "You" : game.players.find((p) => p.id === id)!.name);
  const myWin = outcome.payouts[myId] ?? 0;
  const main = outcome.pots[0];
  const winners = main.winners.map(name).join(" & ");
  const big =
    myWin > 0
      ? main.winners.length > 1 && main.winners.includes(myId)
        ? `Split pot! You get ${chips(myWin)}`
        : `You win ${chips(myWin)}!`
      : `${winners} win${main.winners.length > 1 ? "" : "s"} ${chips(main.amount)}`;
  return (
    <div className={`felt-result ${myWin > 0 ? "won" : ""}`} role="status">
      <div className="big">{big}</div>
      <div className="small">
        {main.handName ? `with ${main.handName}` : "Everyone else folded"}
        {outcome.pots.length > 1 && ` · ${outcome.pots.length - 1} side pot${outcome.pots.length > 2 ? "s" : ""}`}
      </div>
    </div>
  );
}
