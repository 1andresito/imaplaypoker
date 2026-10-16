import type { Card } from "../engine/cards";
import { legalActions, potTotal } from "../engine/gameState";
import type { GameState, LegalActions, Street } from "../engine/types";

export type Position = "early" | "middle" | "late" | "small blind" | "big blind";

/** Everything a decision-maker (coach or bot) needs to know about a spot. */
export interface Situation {
  seat: number;
  hole: Card[];
  board: Card[];
  street: Street;
  legal: LegalActions;
  pot: number;
  currentBet: number;
  bigBlind: number;
  stack: number;
  /** Opponents still in the hand. */
  opponents: number;
  position: Position;
  /** Preflop: someone has raised beyond the big blind. */
  facingRaise: boolean;
  /** Preflop: players who just called the big blind. */
  limpers: number;
}

export function positionOf(state: GameState, seat: number): Position {
  const live = state.players.map((p, i) => ({ p, i })).filter(({ p }) => !p.busted);
  const n = live.length;
  const dealerIdx = live.findIndex(({ i }) => i === state.dealer);
  const offset = (live.findIndex(({ i }) => i === seat) - dealerIdx + n) % n;
  if (seat === state.bigBlindSeat) return "big blind";
  if (offset === 0) return "late"; // the button (also the small blind heads-up)
  if (seat === state.smallBlindSeat) return "small blind";
  // Seats between the big blind and the button, split into thirds.
  const others = n - 3;
  const k = offset - 3; // 0 = first to act preflop (under the gun)
  if (k < Math.ceil(others / 3)) return "early";
  if (k < Math.ceil((2 * others) / 3)) return "middle";
  return "late";
}

export function situationFor(state: GameState, seat = state.toAct): Situation | null {
  const legal = seat === state.toAct ? legalActions(state) : null;
  if (!legal) return null;
  const me = state.players[seat];
  const preflopActions = state.history.filter((e) => e.kind === "action" && e.street === "preflop");
  return {
    seat,
    hole: me.hole,
    board: state.board,
    street: state.street,
    legal,
    pot: potTotal(state),
    currentBet: state.currentBet,
    bigBlind: state.config.bigBlind,
    stack: me.stack,
    opponents: state.players.filter((p, i) => i !== seat && !p.busted && !p.folded).length,
    position: positionOf(state, seat),
    facingRaise: state.street === "preflop" && state.currentBet > state.config.bigBlind,
    limpers: preflopActions.filter((e) => e.kind === "action" && e.type === "call" && e.to === state.config.bigBlind).length,
  };
}
