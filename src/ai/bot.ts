import { advise } from "../analysis/advisor";
import { estimateEquity } from "../analysis/equity";
import { potOdds } from "../analysis/potOdds";
import { preflopGroup } from "../analysis/preflopChart";
import { situationFor } from "../analysis/situation";
import type { Rng } from "../engine/cards";
import type { GameState, PlayerAction } from "../engine/types";
import { BOT_PROFILES } from "./profiles";

/**
 * Bots start from the same advice the coach gives you, then bend it to their
 * personality. That keeps them sensible but exploitable in recognizable ways.
 */
export function botDecision(state: GameState, rng: Rng): PlayerAction {
  const sit = situationFor(state)!;
  const me = state.players[state.toAct];
  const profile = BOT_PROFILES[me.botProfile ?? "tag"] ?? BOT_PROFILES.tag;
  const { legal } = sit;

  const equity =
    sit.street === "preflop"
      ? 0
      : estimateEquity({ hole: sit.hole, board: sit.board, opponents: Math.max(1, sit.opponents), iterations: 800, rng }).equity;
  const advice = advise(sit, equity);
  const raiseTo = (fraction: number): PlayerAction => {
    const to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(sit.currentBet + sit.pot * fraction)));
    return { type: legal.raiseType, amount: to };
  };

  if (sit.street === "preflop") {
    const group = preflopGroup(sit.hole);
    if (advice.action === "fold" && legal.canCall) {
      // Loose players call with hands the coach would fold.
      const playable = group <= 5 + profile.looseness && legal.toCall <= sit.stack * (0.04 + profile.stickiness * 0.3);
      if (playable) return { type: "call" };
    }
    if ((advice.action === "call" || advice.action === "check") && legal.canRaise && rng() < profile.aggression * 0.5) {
      return { type: legal.raiseType, amount: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, sit.currentBet * 3)) };
    }
    if (advice.action === "raise" && rng() < (profile.looseness < 0 ? 0.4 : 0.1)) {
      // Passive players often just call strong hands.
      return legal.canCall ? { type: "call" } : { type: "check" };
    }
    return { type: advice.action, amount: advice.amount };
  }

  // Post-flop personality adjustments.
  if (advice.action === "check" && legal.canRaise) {
    if (equity >= 0.45 && rng() < profile.aggression) return raiseTo(0.5 + rng() * 0.3);
    if (rng() < profile.bluff) return raiseTo(0.4 + rng() * 0.4);
  }
  if (advice.action === "call" && equity >= 0.55 && legal.canRaise && rng() < profile.aggression * 0.5) {
    return { type: legal.raiseType, amount: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, sit.currentBet * 3)) };
  }
  if (advice.action === "fold") {
    const odds = potOdds(sit.pot, legal.toCall);
    if (odds && equity >= odds.requiredEquity - profile.stickiness) return { type: "call" };
    // Occasional hero call so bluffing bots is not free.
    if (odds && rng() < 0.04) return { type: "call" };
  }
  return { type: advice.action, amount: advice.amount };
}

/** Think time in ms; varies so the table feels human. */
export const botThinkTime = (rng: Rng): number => 500 + rng() * 900;
