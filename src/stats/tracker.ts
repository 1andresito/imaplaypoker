import type { GameState } from "../engine/types";

export interface PlayerStats {
  handsPlayed: number;
  /** Hands where you voluntarily put chips in preflop (call/bet/raise, not blinds). */
  vpipHands: number;
  /** Hands where you raised preflop. */
  pfrHands: number;
  handsWon: number;
  showdowns: number;
  showdownsWon: number;
  netChips: number;
  biggestPotWon: number;
  /** Hands won at showdown, by winning hand category (index = HandCategory). */
  wonByCategory: number[];
  /** Decisions made while the coach had a recommendation. */
  coachDecisions: number;
  coachAgreed: number;
}

export interface SessionStats extends PlayerStats {
  /** Your stack after each hand (index 0 = starting stack). */
  stackHistory: number[];
}

export const emptyStats = (): PlayerStats => ({
  handsPlayed: 0,
  vpipHands: 0,
  pfrHands: 0,
  handsWon: 0,
  showdowns: 0,
  showdownsWon: 0,
  netChips: 0,
  biggestPotWon: 0,
  wonByCategory: new Array(10).fill(0),
  coachDecisions: 0,
  coachAgreed: 0,
});

export const emptySession = (startingStack: number): SessionStats => ({ ...emptyStats(), stackHistory: [startingStack] });

export interface HandSummary {
  vpip: boolean;
  pfr: boolean;
  won: boolean;
  sawShowdown: boolean;
  wonShowdown: boolean;
  net: number;
  potWon: number;
  winningCategory: number | null;
}

/** Extracts your stats from a completed hand. */
export function summarizeHand(state: GameState, playerId: string): HandSummary | null {
  if (state.phase !== "complete" || !state.outcome) return null;
  const me = state.players.find((p) => p.id === playerId);
  if (!me || me.busted) return null;
  const mine = state.history.filter((e) => e.kind === "action" && e.playerId === playerId && e.street === "preflop");
  const vpip = mine.some((e) => e.kind === "action" && (e.type === "call" || e.type === "bet" || e.type === "raise"));
  const pfr = mine.some((e) => e.kind === "action" && (e.type === "bet" || e.type === "raise"));
  const payout = state.outcome.payouts[playerId] ?? 0;
  const sawShowdown = state.outcome.showdown && !me.folded;
  return {
    vpip,
    pfr,
    won: payout > 0,
    sawShowdown,
    wonShowdown: sawShowdown && payout > 0,
    net: payout - me.handBet,
    potWon: payout,
    winningCategory: sawShowdown && payout > 0 ? state.outcome.hands[playerId].category : null,
  };
}

export function addHand<T extends PlayerStats>(stats: T, h: HandSummary): T {
  const wonByCategory = stats.wonByCategory.slice();
  if (h.winningCategory !== null) wonByCategory[h.winningCategory]++;
  return {
    ...stats,
    handsPlayed: stats.handsPlayed + 1,
    vpipHands: stats.vpipHands + (h.vpip ? 1 : 0),
    pfrHands: stats.pfrHands + (h.pfr ? 1 : 0),
    handsWon: stats.handsWon + (h.won ? 1 : 0),
    showdowns: stats.showdowns + (h.sawShowdown ? 1 : 0),
    showdownsWon: stats.showdownsWon + (h.wonShowdown ? 1 : 0),
    netChips: stats.netChips + h.net,
    biggestPotWon: Math.max(stats.biggestPotWon, h.potWon),
    wonByCategory,
  };
}

export const addCoachDecision = <T extends PlayerStats>(stats: T, agreed: boolean): T => ({
  ...stats,
  coachDecisions: stats.coachDecisions + 1,
  coachAgreed: stats.coachAgreed + (agreed ? 1 : 0),
});

export const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
