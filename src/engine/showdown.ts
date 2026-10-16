import type { HandResult } from "./evaluator";
import type { PlayerState } from "./types";

export interface Pot {
  amount: number;
  /** Ids of players who can win this pot. */
  eligible: string[];
}

/**
 * Splits everyone's hand contributions into a main pot and side pots.
 * Folded players' chips count toward pots, but they can't win them.
 */
export function buildPots(players: readonly PlayerState[]): Pot[] {
  const contenders = players.filter((p) => !p.folded && p.handBet > 0);
  const levels = [...new Set(contenders.map((p) => p.handBet))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.min(p.handBet, level) - Math.min(p.handBet, prev);
    const eligible = contenders.filter((p) => p.handBet >= level).map((p) => p.id);
    const last = pots[pots.length - 1];
    if (last && last.eligible.length === eligible.length) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // Chips from folded players above the top contender level (rare) go to the last pot.
  const leftover = players.reduce((sum, p) => sum + Math.max(0, p.handBet - prev), 0);
  if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
  return pots;
}

/**
 * Awards a pot to the best hand(s). Odd chips from a split go to the winners
 * closest to the left of the dealer, which `seatOrder` (ids, from left of the
 * dealer around the table) determines.
 */
export function splitPot(
  pot: Pot,
  hands: Record<string, HandResult>,
  seatOrder: readonly string[],
): { winners: string[]; shares: Record<string, number> } {
  const best = Math.max(...pot.eligible.map((id) => hands[id].score));
  const winners = seatOrder.filter((id) => pot.eligible.includes(id) && hands[id].score === best);
  const base = Math.floor(pot.amount / winners.length);
  let remainder = pot.amount - base * winners.length;
  const shares: Record<string, number> = {};
  for (const id of winners) {
    shares[id] = base + (remainder > 0 ? 1 : 0);
    remainder--;
  }
  return { winners, shares };
}
