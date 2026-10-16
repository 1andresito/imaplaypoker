import type { GameState } from "../engine/types";

/** Stands in for a card the viewer isn't allowed to see. Never a real card (0–51). */
export const HIDDEN_CARD = -1;

/**
 * The table as one seat may see it: no deck, and other players' hole cards
 * hidden unless they were shown down at the end of the hand.
 */
export function viewFor(game: GameState, seatId: string): GameState {
  const view = structuredClone(game);
  view.deck = [];
  const shown = view.phase === "complete" && view.outcome?.showdown ? view.outcome.hands : {};
  for (const p of view.players) {
    if (p.id !== seatId && !(p.id in shown)) p.hole = p.hole.map(() => HIDDEN_CARD);
  }
  return view;
}
