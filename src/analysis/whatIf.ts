import { type Card, createRng } from "../engine/cards";
import type { HandResult } from "../engine/evaluator";
import { runOutBoard, variantOf } from "../engine/gameState";
import type { GameState } from "../engine/types";

export interface LiveWhatIf {
  kind: "live";
  /** Chance you'd win outright against the real hands still in. */
  win: number;
  tie: number;
  /** Win + your share of ties. */
  equity: number;
}

export interface FinalWhatIf {
  kind: "final";
  result: "win" | "tie" | "lose";
  myHand: HandResult;
  /** The best hand among the players still in at the end. */
  bestOpponent: { id: string; hand: HandResult };
  /** The full five-card board the comparison used. */
  board: Card[];
  /** True when the hand ended early and the rest of the board was dealt from the deck. */
  ranOut: boolean;
}

export type FoldWhatIf = LiveWhatIf | FinalWhatIf;

/**
 * After a player folds: how they would have done if they'd stayed in to the
 * end, against the real cards of everyone still in. Needs the full game state
 * (with the deck), so it only works in solo games; returns null otherwise.
 */
export function foldWhatIf(game: GameState, playerId: string, iterations = 3000): FoldWhatIf | null {
  const me = game.players.find((p) => p.id === playerId);
  if (!me || !me.folded || me.hole.length === 0 || game.deck.length === 0) return null;
  const opponents = game.players.filter((p) => p.id !== playerId && !p.folded && !p.busted);
  if (opponents.length === 0) return null;
  const variant = variantOf(game);

  if (game.phase === "complete") {
    const board = runOutBoard(game);
    const myHand = variant.bestHand(me.hole, board);
    let best: FinalWhatIf["bestOpponent"] | null = null;
    for (const o of opponents) {
      const hand = variant.bestHand(o.hole, board);
      if (!best || hand.score > best.hand.score) best = { id: o.id, hand };
    }
    const result = myHand.score > best!.hand.score ? "win" : myHand.score === best!.hand.score ? "tie" : "lose";
    return { kind: "final", result, myHand, bestOpponent: best!, board, ranOut: board.length > game.board.length };
  }

  // The deck holds exactly the unseen cards; sample the rest of the board from it.
  const need = 5 - game.board.length;
  const deck = game.deck.slice();
  const rng = createRng(game.handNumber * 7919 + game.board.length * 131 + opponents.length);
  let win = 0;
  let tie = 0;
  let share = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    const board = [...game.board, ...deck.slice(0, need)];
    const mine = variant.bestHand(me.hole, board).score;
    let best = 0;
    let bestCount = 0;
    for (const o of opponents) {
      const score = variant.bestHand(o.hole, board).score;
      if (score > best) {
        best = score;
        bestCount = 1;
      } else if (score === best) bestCount++;
    }
    if (mine > best) {
      win++;
      share += 1;
    } else if (mine === best) {
      tie++;
      share += 1 / (bestCount + 1);
    }
  }
  return { kind: "live", win: win / iterations, tie: tie / iterations, equity: share / iterations };
}
