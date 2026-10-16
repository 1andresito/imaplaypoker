// Cards are encoded as integers 0..51 so the evaluator and Monte Carlo
// simulations stay fast: rank = (card >> 2) + 2 (2..14), suit = card & 3.

export type Card = number;
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type Suit = 0 | 1 | 2 | 3;

export const SUITS: readonly Suit[] = [0, 1, 2, 3];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const SUIT_CHARS = ["s", "h", "d", "c"] as const;
export const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"] as const;
export const SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"] as const;
const RANK_CHARS = "23456789TJQKA";

const RANK_NAMES: Record<Rank, string> = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight",
  9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace",
};

export const makeCard = (rank: Rank, suit: Suit): Card => ((rank - 2) << 2) | suit;
export const rankOf = (card: Card): Rank => ((card >> 2) + 2) as Rank;
export const suitOf = (card: Card): Suit => (card & 3) as Suit;

export const rankChar = (rank: Rank): string => RANK_CHARS[rank - 2];
/** Display label used on card faces: "10" instead of "T". */
export const rankLabel = (rank: Rank): string => (rank === 10 ? "10" : rankChar(rank));
export const rankName = (rank: Rank): string => RANK_NAMES[rank];
export const rankPlural = (rank: Rank): string => (rank === 6 ? "Sixes" : `${RANK_NAMES[rank]}s`);

export const cardToString = (card: Card): string => rankChar(rankOf(card)) + SUIT_CHARS[suitOf(card)];

export function parseCard(text: string): Card {
  const t = text.trim();
  const rank = RANK_CHARS.indexOf(t[0].toUpperCase()) + 2;
  const suit = SUIT_CHARS.indexOf(t[1]?.toLowerCase() as (typeof SUIT_CHARS)[number]);
  if (rank < 2 || suit < 0 || t.length !== 2) throw new Error(`Invalid card: "${text}"`);
  return makeCard(rank as Rank, suit as Suit);
}

/** Parses "As Kd 7h" (spaces optional) into cards. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/\s+/g, "");
  const cards: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) cards.push(parseCard(compact.slice(i, i + 2)));
  return cards;
}

export const fullDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);

// ---------------------------------------------------------------------------
// Seedable RNG (mulberry32). Deterministic seeds make hands reproducible in tests.

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = (): number => (Math.random() * 2 ** 32) >>> 0;

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
