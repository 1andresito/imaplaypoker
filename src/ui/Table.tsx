import { BOT_PROFILES } from "../ai/profiles";
import type { Card } from "../engine/cards";
import { collectedPot, potTotal } from "../engine/gameState";
import type { GameState, HandEvent, PlayerState } from "../engine/types";
import { HUMAN_ID } from "../store/gameStore";
import { chips } from "./format";
import { PlayingCard } from "./PlayingCard";

interface Props {
  game: GameState;
  /** Cards to highlight (your best five), when the Hand Helper is on. */
  highlight: readonly Card[];
}

const STREET_NAMES = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" } as const;

/** Seat positions around the oval: you sit at the bottom center, bots go clockwise. */
function seatPosition(index: number, count: number) {
  const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
  return { x: 50 + 44 * Math.cos(angle), y: 50 + 44 * Math.sin(angle) };
}

function lastActionLabel(history: HandEvent[], player: PlayerState): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.kind === "deal") return "";
    if (e.kind === "blind" && e.playerId === player.id) return e.blind === "small" ? "Small blind" : "Big blind";
    if (e.kind === "action" && e.playerId === player.id) {
      if (e.allIn && e.type !== "fold") return "All-in";
      switch (e.type) {
        case "fold": return "Fold";
        case "check": return "Check";
        case "call": return `Call ${chips(e.amount)}`;
        case "bet": return `Bet ${chips(e.to)}`;
        case "raise": return `Raise to ${chips(e.to)}`;
      }
    }
  }
  return "";
}

export function Table({ game, highlight }: Props) {
  const { players, outcome } = game;
  const humanIndex = players.findIndex((p) => p.id === HUMAN_ID);
  const done = game.phase === "complete";
  const pot = done ? potTotal(game) : collectedPot(game);
  const totalBoard = 5;

  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="felt-center">
        <div className="street-label">{done ? (outcome?.showdown ? "Showdown" : "Hand over") : STREET_NAMES[game.street]}</div>
        <div className="board">
          {game.board.map((c) => (
            <PlayingCard key={c} card={c} highlight={highlight.includes(c)} dim={highlight.length > 0 && !highlight.includes(c)} />
          ))}
          {Array.from({ length: totalBoard - game.board.length }, (_, i) => (
            <div key={i} className="slot" />
          ))}
        </div>
        <div className="pot num">
          <span className="chip-dot" /> Pot {chips(pot)}
        </div>
      </div>

      {players.map((p, i) => {
        const rel = (i - humanIndex + players.length) % players.length;
        const pos = seatPosition(rel, players.length);
        // Bets sit between the seat and the center of the table.
        const betPos = { x: 50 + (pos.x - 50) * 0.62, y: 50 + (pos.y - 50) * 0.55 };
        const isHuman = p.id === HUMAN_ID;
        const showCards = isHuman || (done && outcome?.showdown && !p.folded && outcome.hands[p.id]);
        const won = outcome?.payouts[p.id];
        const toAct = game.phase === "betting" && game.toAct === i;
        const profile = p.botProfile ? BOT_PROFILES[p.botProfile] : undefined;
        const status = p.busted
          ? "Out of chips"
          : won
            ? `Wins ${chips(won)}`
            : lastActionLabel(game.history, p);

        return (
          <div key={p.id}>
            <div
              className={`seat ${p.folded || p.busted ? "folded" : ""} ${toAct ? "to-act" : ""} ${won ? "winner" : ""}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <div className="hole">
                {!p.busted &&
                  (isHuman || !p.folded) &&
                  p.hole.map((c) =>
                    showCards ? (
                      <PlayingCard
                        key={c}
                        card={c}
                        size={isHuman ? "md" : "sm"}
                        highlight={isHuman && highlight.includes(c)}
                        dim={p.folded}
                      />
                    ) : (
                      <PlayingCard key={c} faceDown size="sm" />
                    ),
                  )}
              </div>
              <div className="seat-plate" title={profile?.description}>
                {i === game.dealer && <div className="dealer-btn">D</div>}
                <div className="seat-name">
                  {p.name}
                  {profile && <span className="seat-style">{profile.name}</span>}
                </div>
                <div className="seat-stack num">{chips(p.stack)}</div>
                <div className={`seat-status ${won ? "win" : ""}`}>
                  {toAct && !isHuman ? (
                    <span className="think" aria-label="Thinking">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    status
                  )}
                </div>
              </div>
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
