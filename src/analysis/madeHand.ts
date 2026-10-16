import { type Card, type Rng, createRng, fullDeck } from "../engine/cards";
import { evaluate, HandCategory, type HandResult } from "../engine/evaluator";
import { describeHand } from "../engine/handRanks";
import { describeStartingHand } from "./preflopChart";

export interface MadeHand {
  category: HandCategory;
  name: string;
  /** Cards that make the hand (the 5 best, or your hole cards preflop). */
  cards: Card[];
  /** True if your best five are all on the board — everyone has at least this. */
  playsTheBoard: boolean;
  result: HandResult | null;
}

export function currentHand(hole: readonly Card[], board: readonly Card[]): MadeHand {
  if (board.length < 3) {
    const pair = (hole[0] >> 2) === (hole[1] >> 2);
    return {
      category: pair ? HandCategory.Pair : HandCategory.HighCard,
      name: describeStartingHand(hole),
      cards: [...hole],
      playsTheBoard: false,
      result: null,
    };
  }
  const result = evaluate([...hole, ...board]);
  return {
    category: result.category,
    name: describeHand(result),
    cards: result.bestFive,
    playsTheBoard: !result.bestFive.some((c) => hole.includes(c)),
    result,
  };
}

const unseen = (known: readonly Card[]) => {
  const set = new Set(known);
  return fullDeck().filter((c) => !set.has(c));
};

/**
 * Probability that each category ends up being your best hand at the river.
 * Exact on the flop/turn (enumerates every runout); sampled preflop.
 */
export function finalCategoryOdds(hole: readonly Card[], board: readonly Card[], rng: Rng = createRng(7)): number[] {
  const dist = new Array<number>(10).fill(0);
  const rest = unseen([...hole, ...board]);
  const base = [...hole, ...board];
  if (board.length === 5) {
    dist[evaluate(base).category] = 1;
  } else if (board.length === 4) {
    for (const c of rest) dist[evaluate([...base, c]).category]++;
    return dist.map((n) => n / rest.length);
  } else if (board.length === 3) {
    let total = 0;
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++) {
        dist[evaluate([...base, rest[i], rest[j]]).category]++;
        total++;
      }
    return dist.map((n) => n / total);
  } else {
    const samples = 20000;
    const deck = rest.slice();
    const need = 5 - board.length;
    for (let s = 0; s < samples; s++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rng() * (deck.length - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      dist[evaluate([...base, ...deck.slice(0, need)]).category]++;
    }
    return dist.map((n) => n / samples);
  }
  return dist;
}

export interface ThreatReport {
  /** Number of possible two-card opponent hands. */
  total: number;
  beatYou: number;
  tieYou: number;
  /** Hands that beat you right now, grouped by what they make (strongest first). */
  byCategory: { category: HandCategory; count: number; example: Card[] }[];
  isNuts: boolean;
}

/**
 * "What beats me on this board?" — checks every two-card hand an opponent could hold.
 * Only meaningful once the flop is out.
 */
export function boardThreats(hole: readonly Card[], board: readonly Card[]): ThreatReport | null {
  if (board.length < 3) return null;
  const mine = evaluate([...hole, ...board]).score;
  const rest = unseen([...hole, ...board]);
  const groups = new Map<HandCategory, { count: number; example: Card[] }>();
  let total = 0;
  let beatYou = 0;
  let tieYou = 0;
  for (let i = 0; i < rest.length; i++)
    for (let j = i + 1; j < rest.length; j++) {
      total++;
      const theirs = evaluate([rest[i], rest[j], ...board]);
      if (theirs.score > mine) {
        beatYou++;
        const g = groups.get(theirs.category);
        if (g) g.count++;
        else groups.set(theirs.category, { count: 1, example: [rest[i], rest[j]] });
      } else if (theirs.score === mine) tieYou++;
    }
  const byCategory = [...groups.entries()]
    .map(([category, g]) => ({ category, ...g }))
    .sort((a, b) => b.category - a.category);
  return { total, beatYou, tieYou, byCategory, isNuts: beatYou === 0 };
}
