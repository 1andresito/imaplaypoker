import { type Card, type Rng, createRng, fullDeck } from "../engine/cards";
import { evaluate } from "../engine/evaluator";

export interface EquityResult {
  /** Probability of winning outright. */
  win: number;
  /** Probability of splitting the pot. */
  tie: number;
  /** Win + tie share (tie counted as your fraction of the pot): your "equity". */
  equity: number;
  /** Probability your final hand ends up in each category (index = HandCategory). */
  finalCategory: number[];
  iterations: number;
}

export interface EquityInput {
  hole: readonly Card[];
  board: readonly Card[];
  /** Number of opponents still in the hand; they are assumed to hold random cards. */
  opponents: number;
  iterations?: number;
  rng?: Rng;
  /** Cards known to be out of play (e.g. folded hands you saw) — usually empty. */
  dead?: readonly Card[];
}

/**
 * Monte Carlo equity vs random opponent hands, plus the distribution of your
 * final hand category by the river. Hold'em only (2 hole + 5 board).
 */
export function estimateEquity({
  hole,
  board,
  opponents,
  iterations = 4000,
  rng = createRng(hole[0] * 131 + hole[1] * 17 + board.length * 7919 + opponents),
  dead = [],
}: EquityInput): EquityResult {
  const known = new Set<Card>([...hole, ...board, ...dead]);
  const stub = fullDeck().filter((c) => !known.has(c));
  const need = 5 - board.length;
  const finalCategory = new Array<number>(10).fill(0);
  let win = 0;
  let tie = 0;
  let share = 0;

  const mine = new Array<Card>(7);
  const theirs = new Array<Card>(7);
  const deck = stub.slice();

  for (let it = 0; it < iterations; it++) {
    // Partial Fisher–Yates: draw just the cards we need from the front.
    const draw = need + opponents * 2;
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    const fullBoard = [...board, ...deck.slice(0, need)];
    mine.length = 0;
    mine.push(hole[0], hole[1], ...fullBoard);
    const me = evaluate(mine);
    finalCategory[me.category]++;

    let best = 0;
    let bestCount = 0;
    for (let o = 0; o < opponents; o++) {
      theirs.length = 0;
      theirs.push(deck[need + o * 2], deck[need + o * 2 + 1], ...fullBoard);
      const score = evaluate(theirs).score;
      if (score > best) {
        best = score;
        bestCount = 1;
      } else if (score === best) bestCount++;
    }
    if (me.score > best) {
      win++;
      share += 1;
    } else if (me.score === best) {
      tie++;
      share += 1 / (bestCount + 1);
    }
  }

  return {
    win: win / iterations,
    tie: tie / iterations,
    equity: share / iterations,
    finalCategory: finalCategory.map((n) => n / iterations),
    iterations,
  };
}

