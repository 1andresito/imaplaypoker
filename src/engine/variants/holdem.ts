import { evaluate } from "../evaluator";
import type { Variant } from "./Variant";

export const holdem: Variant = {
  id: "holdem",
  name: "Texas Hold'em",
  shortDescription: "2 private cards and 5 shared cards. Make the best 5-card hand from any of the 7.",
  holeCards: 2,
  streets: [
    { street: "preflop", boardCards: 0 },
    { street: "flop", boardCards: 3 },
    { street: "turn", boardCards: 1 },
    { street: "river", boardCards: 1 },
  ],
  bestHand: (hole, board) => evaluate([...hole, ...board]),
};
