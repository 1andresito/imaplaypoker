import { type Card, type Rank, rankOf, suitOf } from "./cards";

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export interface HandResult {
  category: HandCategory;
  /** Comparable strength: higher always beats lower, equal means a split. */
  score: number;
  /** The five cards that make the hand, most important first. */
  bestFive: Card[];
  /** Ranks that define the hand (e.g. [13, 7, 4] for kings & sevens, four kicker). */
  ranks: Rank[];
}

const encodeScore = (category: HandCategory, ranks: number[]): number => {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (ranks[i] ?? 0);
  return score;
};

/** Highest card of a 5-long run in the rank bitmask (bit r set = rank r present), or 0. */
function straightHigh(mask: number): number {
  for (let high = 14; high >= 5; high--) {
    const run = 0b11111 << (high - 4);
    if ((mask & run) === run) return high;
  }
  // Wheel: A-2-3-4-5 (ace plays low).
  const wheel = (1 << 14) | 0b111100;
  return (mask & wheel) === wheel ? 5 : 0;
}

const straightRanks = (high: number): number[] =>
  high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4];

/**
 * Evaluates the best 5-card poker hand from 5 to 7 cards.
 */
export function evaluate(cards: readonly Card[]): HandResult {
  if (cards.length < 5 || cards.length > 7) throw new Error(`evaluate needs 5–7 cards, got ${cards.length}`);

  const rankCount = new Array<number>(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCount[r]++;
    suitCount[s]++;
    suitMask[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  // Picks cards of the given ranks (in order), optionally restricted to a suit.
  const pick = (ranks: number[], suit?: number): Card[] => {
    const used = new Set<Card>();
    return ranks.map((r) => {
      const card = cards.find((c) => rankOf(c) === r && !used.has(c) && (suit === undefined || suitOf(c) === suit))!;
      used.add(card);
      return card;
    });
  };

  const result = (category: HandCategory, ranks: number[], bestFive: Card[], defining = ranks): HandResult => ({
    category,
    score: encodeScore(category, ranks),
    bestFive,
    ranks: defining as Rank[],
  });

  // Ranks grouped by multiplicity, highest rank first.
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }
  const kickersExcluding = (exclude: number[], count: number): number[] => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < count; r--) {
      if (rankCount[r] > 0 && !exclude.includes(r)) out.push(r);
    }
    return out;
  };

  const flushSuit = suitCount.findIndex((n) => n >= 5);

  if (flushSuit >= 0) {
    const sfHigh = straightHigh(suitMask[flushSuit]);
    if (sfHigh) {
      const ranks = straightRanks(sfHigh);
      const category = sfHigh === 14 ? HandCategory.RoyalFlush : HandCategory.StraightFlush;
      return result(category, ranks, pick(ranks, flushSuit), [sfHigh]);
    }
  }

  if (quads.length) {
    const q = quads[0];
    const [kicker] = kickersExcluding([q], 1);
    return result(HandCategory.FourOfAKind, [q, q, q, q, kicker], pick([q, q, q, q, kicker]), [q, kicker]);
  }

  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return result(HandCategory.FullHouse, [t, t, t, p, p], pick([t, t, t, p, p]), [t, p]);
  }

  if (flushSuit >= 0) {
    const ranks: number[] = [];
    for (let r = 14; r >= 2 && ranks.length < 5; r--) if (suitMask[flushSuit] & (1 << r)) ranks.push(r);
    return result(HandCategory.Flush, ranks, pick(ranks, flushSuit));
  }

  const high = straightHigh(rankMask);
  if (high) {
    const ranks = straightRanks(high);
    return result(HandCategory.Straight, ranks, pick(ranks), [high]);
  }

  if (trips.length) {
    const t = trips[0];
    const kickers = kickersExcluding([t], 2);
    return result(HandCategory.ThreeOfAKind, [t, t, t, ...kickers], pick([t, t, t, ...kickers]), [t, ...kickers]);
  }

  if (pairs.length >= 2) {
    const [hi, lo] = pairs;
    const [kicker] = kickersExcluding([hi, lo], 1);
    return result(HandCategory.TwoPair, [hi, hi, lo, lo, kicker], pick([hi, hi, lo, lo, kicker]), [hi, lo, kicker]);
  }

  if (pairs.length) {
    const p = pairs[0];
    const kickers = kickersExcluding([p], 3);
    return result(HandCategory.Pair, [p, p, ...kickers], pick([p, p, ...kickers]), [p, ...kickers]);
  }

  const top = singles.slice(0, 5);
  return result(HandCategory.HighCard, top, pick(top));
}

/** Score only — convenience for hot loops that don't need the card breakdown. */
export const scoreHand = (cards: readonly Card[]): number => evaluate(cards).score;
