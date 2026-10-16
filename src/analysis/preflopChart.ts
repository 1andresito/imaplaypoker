import { type Card, type Rank, rankChar, rankName, rankOf, rankPlural, suitOf } from "../engine/cards";

/**
 * Starting-hand groups (based on the classic Sklansky–Malmuth groups).
 * Group 1 is premium; group 9 is everything not listed.
 */
const GROUPS: readonly string[][] = [
  ["AA", "KK", "QQ", "JJ", "AKs"],
  ["TT", "AQs", "AJs", "KQs", "AKo"],
  ["99", "JTs", "QJs", "KJs", "ATs", "AQo"],
  ["T9s", "KQo", "88", "QTs", "98s", "J9s", "AJo", "KTs"],
  ["77", "87s", "Q9s", "T8s", "KJo", "QJo", "JTo", "76s", "97s", "A9s", "A8s", "A7s", "A6s", "A5s", "A4s", "A3s", "A2s", "65s"],
  ["66", "ATo", "55", "86s", "KTo", "QTo", "54s", "K9s", "J8s", "75s"],
  ["44", "J9o", "64s", "T9o", "53s", "33", "98o", "43s", "22", "K8s", "K7s", "K6s", "K5s", "K4s", "K3s", "K2s", "Q8s"],
  ["87o", "A9o", "Q9o", "76o", "42s", "32s", "96s", "85s", "J8o", "J7s", "65o", "54o", "74s", "K9o", "T8o"],
];

const GROUP_OF = new Map<string, number>();
GROUPS.forEach((hands, i) => hands.forEach((h) => GROUP_OF.set(h, i + 1)));

export const GROUP_LABELS: Record<number, string> = {
  1: "Premium",
  2: "Very strong",
  3: "Strong",
  4: "Good",
  5: "Playable",
  6: "Speculative",
  7: "Marginal",
  8: "Weak",
  9: "Trash",
};

/** Canonical class like "AKs", "T9o" or "77". */
export function handClass(hole: readonly Card[]): string {
  const [r1, r2] = [rankOf(hole[0]), rankOf(hole[1])].sort((a, b) => b - a) as Rank[];
  if (r1 === r2) return rankChar(r1) + rankChar(r2);
  return rankChar(r1) + rankChar(r2) + (suitOf(hole[0]) === suitOf(hole[1]) ? "s" : "o");
}

export const groupOfClass = (cls: string): number => GROUP_OF.get(cls) ?? 9;
export const preflopGroup = (hole: readonly Card[]): number => groupOfClass(handClass(hole));

/** "Pocket Kings", "Ace-King suited", "Seven-Two offsuit". */
export function describeStartingHand(hole: readonly Card[]): string {
  const [r1, r2] = [rankOf(hole[0]), rankOf(hole[1])].sort((a, b) => b - a) as Rank[];
  if (r1 === r2) return `Pocket ${rankPlural(r1)}`;
  const suited = suitOf(hole[0]) === suitOf(hole[1]);
  return `${rankName(r1)}-${rankName(r2)} ${suited ? "suited" : "offsuit"}`;
}

/** All 169 classes in grid order: row = first rank (A..2), col = second rank (A..2). */
export function chartGrid(): string[][] {
  const ranks: Rank[] = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  return ranks.map((a, row) =>
    ranks.map((b, col) => {
      if (row === col) return rankChar(a) + rankChar(b);
      // Above the diagonal = suited, below = offsuit (standard chart layout).
      return row < col ? rankChar(a) + rankChar(b) + "s" : rankChar(b) + rankChar(a) + "o";
    }),
  );
}

const combos = (cls: string) => (cls.length === 2 ? 6 : cls.endsWith("s") ? 4 : 12);

/** Percentage of all starting hands (by combos) that are in a better or equal group. */
export function topPercent(hole: readonly Card[]): number {
  const group = preflopGroup(hole);
  let better = 0;
  for (const row of chartGrid()) for (const cls of row) if (groupOfClass(cls) <= group) better += combos(cls);
  return (better / 1326) * 100;
}
