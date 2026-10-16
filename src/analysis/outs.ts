import { type Card, fullDeck, rankOf } from "../engine/cards";
import { evaluate, HandCategory } from "../engine/evaluator";

export interface OutsReport {
  /** Unseen cards that improve your hand to a better category. */
  outs: Card[];
  byCategory: { category: HandCategory; cards: Card[] }[];
  unseen: number;
  /** Chance the very next card is an out. */
  nextCard: number;
  /** Chance of hitting at least one out by the river (flop only; equals nextCard on the turn). */
  byRiver: number;
  /** The classic shortcut: outs × 4 on the flop, × 2 on the turn. */
  ruleOfFourAndTwo: number;
}

/** Category the community cards make by themselves (4 cards: pairs/trips/quads only). */
function boardOnlyCategory(board: readonly Card[]): HandCategory {
  if (board.length >= 5) return evaluate(board).category;
  const counts = new Map<number, number>();
  for (const c of board) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const sizes = [...counts.values()].sort((a, b) => b - a);
  if (sizes[0] === 4) return HandCategory.FourOfAKind;
  if (sizes[0] === 3) return HandCategory.ThreeOfAKind;
  if (sizes[0] === 2) return sizes[1] === 2 ? HandCategory.TwoPair : HandCategory.Pair;
  return HandCategory.HighCard;
}

/**
 * Counts "outs": cards that would improve you to a better hand category, using
 * your hole cards (a card that only improves the shared board doesn't count).
 */
export function countOuts(hole: readonly Card[], board: readonly Card[]): OutsReport | null {
  if (board.length < 3 || board.length > 4) return null;
  const current = evaluate([...hole, ...board]).category;
  const known = new Set([...hole, ...board]);
  const rest = fullDeck().filter((c) => !known.has(c));
  const groups = new Map<HandCategory, Card[]>();
  const outs: Card[] = [];

  for (const c of rest) {
    const next = evaluate([...hole, ...board, c]);
    if (next.category <= current) continue;
    // Must beat what the board alone makes, or the "improvement" is shared by everyone.
    if (next.category <= boardOnlyCategory([...board, c])) continue;
    outs.push(c);
    const g = groups.get(next.category);
    if (g) g.push(c);
    else groups.set(next.category, [c]);
  }

  const n = outs.length;
  const u = rest.length;
  const nextCard = n / u;
  const byRiver = board.length === 3 ? 1 - ((u - n) * (u - n - 1)) / (u * (u - 1)) : nextCard;
  return {
    outs,
    byCategory: [...groups.entries()].map(([category, cards]) => ({ category, cards })).sort((a, b) => b.category - a.category),
    unseen: u,
    nextCard,
    byRiver,
    ruleOfFourAndTwo: Math.min(100, n * (board.length === 3 ? 4 : 2)),
  };
}
