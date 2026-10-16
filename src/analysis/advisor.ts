import type { ActionType } from "../engine/types";
import { potOdds } from "./potOdds";
import { describeStartingHand, GROUP_LABELS, preflopGroup, topPercent } from "./preflopChart";
import type { Position, Situation } from "./situation";

export interface Advice {
  action: ActionType;
  /** For bet/raise: total to bet this street. */
  amount?: number;
  /** Short label, e.g. "Raise to 30". */
  headline: string;
  /** One or two plain-English sentences explaining why. */
  reason: string;
}

/** Hands you can open with from each position (group number, lower = stronger). */
const OPEN_THRESHOLD: Record<Position, number> = {
  early: 3,
  middle: 4,
  late: 6,
  "small blind": 5,
  "big blind": 5,
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

function clampTo(sit: Situation, to: number): number {
  const { minRaiseTo, maxRaiseTo } = sit.legal;
  const step = Math.max(1, Math.round(sit.bigBlind / 2));
  const rounded = Math.round(to / step) * step;
  return Math.max(minRaiseTo, Math.min(maxRaiseTo, rounded));
}

function raise(sit: Situation, to: number, reason: string): Advice {
  const amount = clampTo(sit, to);
  const allIn = amount === sit.legal.maxRaiseTo;
  const verb = sit.legal.raiseType === "bet" ? "Bet" : "Raise to";
  return {
    action: sit.legal.raiseType,
    amount,
    headline: allIn ? `All-in (${amount})` : `${verb} ${amount}`,
    reason,
  };
}

const checkOrFold = (sit: Situation, reason: string): Advice =>
  sit.legal.canCheck
    ? { action: "check", headline: "Check", reason }
    : { action: "fold", headline: "Fold", reason };

const call = (sit: Situation, reason: string): Advice => ({
  action: "call",
  headline: sit.legal.toCall >= sit.stack ? `Call all-in (${sit.legal.toCall})` : `Call ${sit.legal.toCall}`,
  reason,
});

function preflop(sit: Situation): Advice {
  const group = preflopGroup(sit.hole);
  const name = describeStartingHand(sit.hole);
  const label = GROUP_LABELS[group].toLowerCase();
  const top = Math.round(topPercent(sit.hole));
  const strength = `${name} is a ${label} hand (top ${top}% of starting hands)`;
  const { legal, bigBlind, stack } = sit;

  if (!sit.facingRaise) {
    if (group <= OPEN_THRESHOLD[sit.position] && legal.canRaise) {
      return raise(
        sit,
        bigBlind * (3 + sit.limpers),
        `${strength}. Raising from ${sit.position} position builds the pot while you're ahead and gets weaker hands to fold.`,
      );
    }
    if (legal.canCheck) {
      return { action: "check", headline: "Check", reason: `${strength}. You're in the big blind, so you can see the flop for free.` };
    }
    if (sit.position === "small blind" && group <= 7 && legal.toCall <= bigBlind / 2) {
      return call(sit, `${strength}. You already have half a bet in, so completing is cheap.`);
    }
    return {
      action: "fold",
      headline: "Fold",
      reason: `${strength}, too weak to play from ${sit.position} position. Good players fold most hands before the flop.`,
    };
  }

  // Facing a raise.
  const commitment = legal.toCall / Math.max(1, stack);
  const pair = sit.hole[0] >> 2 === sit.hole[1] >> 2;
  if (group === 1 && legal.canRaise) {
    return raise(sit, sit.currentBet * 3, `${strength}. Re-raise (3-bet) for value: you're likely ahead of whatever they raised with.`);
  }
  if (group === 1) return call(sit, `${strength}. You can't re-raise here, but this hand is far too strong to fold.`);
  if (group <= 2 && commitment < 0.35) {
    return call(sit, `${strength}. Strong enough to call a raise, but not strong enough to build a big pot yet.`);
  }
  if (group <= 3 && commitment < 0.08) {
    return call(sit, `${strength}. The raise is small compared to your stack, so calling to see a flop is reasonable.`);
  }
  if (pair && commitment < 0.05) {
    return call(
      sit,
      `${name}: the call is cheap, so you can "set mine": about 1 time in 8 you flop three of a kind and can win a big pot.`,
    );
  }
  return {
    action: "fold",
    headline: "Fold",
    reason: `${strength}. Facing a raise, you want a stronger hand. Raisers usually have good cards.`,
  };
}

function postflop(sit: Situation, rawEquity: number): Advice {
  const { legal, pot, stack } = sit;
  // Equity is computed vs random hands. Players who bet usually have better than
  // random, so be a bit more cautious when facing a bet.
  const equity = legal.toCall > 0 ? rawEquity * 0.85 : rawEquity;
  const vs = sit.opponents === 1 ? "your opponent" : `${sit.opponents} opponents`;
  const eqText = `You have about ${pct(rawEquity)} equity vs ${vs}`;

  if (legal.toCall === 0) {
    if (equity >= 0.65 && legal.canRaise) {
      return raise(sit, pot * 0.66, `${eqText}, which is strong. Bet about two-thirds of the pot for value so worse hands pay you.`);
    }
    if (equity >= 0.5 && legal.canRaise) {
      return raise(sit, pot * 0.5, `${eqText}, so you're probably ahead. A half-pot bet protects your hand and gets value.`);
    }
    return { action: "check", headline: "Check", reason: `${eqText}. Not strong enough to bet. Checking gives you a free card.` };
  }

  const odds = potOdds(pot, legal.toCall)!;
  const need = `You need ${pct(odds.requiredEquity)} to call (pot odds ${odds.ratio})`;

  if (equity >= 0.75 && legal.canRaise) {
    return raise(sit, sit.currentBet * 3, `${eqText}. That's very strong, so raise to build the pot.`);
  }
  if (equity >= odds.requiredEquity) {
    return call(sit, `${eqText}. ${need}, so calling is profitable in the long run.`);
  }
  if (equity >= odds.requiredEquity - 0.05 && legal.toCall < stack * 0.1 && sit.street !== "river") {
    return call(sit, `${eqText}. ${need}. It's close, but the bet is small and you might win more on later streets (implied odds).`);
  }
  return checkOrFold(sit, `${eqText}. ${need}, so calling loses chips over time. Fold and wait for a better spot.`);
}

/**
 * Rule-based recommendation. `equity` is your share of the pot vs random hands
 * (from estimateEquity); it's ignored preflop, where starting-hand charts are used.
 */
export function advise(sit: Situation, equity: number): Advice {
  return sit.street === "preflop" ? preflop(sit) : postflop(sit, equity);
}
