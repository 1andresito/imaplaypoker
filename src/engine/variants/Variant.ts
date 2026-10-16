import type { Card } from "../cards";
import type { HandResult } from "../evaluator";

export type Street = "preflop" | "flop" | "turn" | "river";

/**
 * Describes the rules that differ between poker variants. The betting engine,
 * stats and UI only talk to this interface, so new variants plug in here.
 */
export interface Variant {
  id: string;
  name: string;
  shortDescription: string;
  holeCards: number;
  /** Betting streets in order, with how many community cards are dealt before each. */
  streets: readonly { street: Street; boardCards: number }[];
  /** Best hand a player can make from their hole cards and the board. */
  bestHand(hole: readonly Card[], board: readonly Card[]): HandResult;
}
