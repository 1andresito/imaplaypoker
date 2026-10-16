import { useEffect, useMemo } from "react";
import { type Advice, advise } from "../analysis/advisor";
import { type EquityResult, estimateEquity } from "../analysis/equity";
import { boardThreats, currentHand, finalCategoryOdds, type MadeHand, type ThreatReport } from "../analysis/madeHand";
import { countOuts, type OutsReport } from "../analysis/outs";
import { type PotOdds, potOdds } from "../analysis/potOdds";
import { situationFor } from "../analysis/situation";
import { potTotal } from "../engine/gameState";
import { HUMAN_ID, useGameStore } from "../store/gameStore";

export interface Analysis {
  made: MadeHand;
  equity: EquityResult;
  finalOdds: number[];
  outs: OutsReport | null;
  threats: ThreatReport | null;
  potOdds: PotOdds | null;
  advice: Advice | null;
  opponents: number;
}

/**
 * Monte Carlo runs on the main thread, so cap the total hand evaluations (each
 * iteration evaluates your hand plus every opponent's) to keep the table smooth.
 */
const equityIterations = (opponents: number): number =>
  Math.round(Math.min(5000, Math.max(2000, 25_000 / (1 + Math.max(1, opponents)))));

/**
 * Everything the learning panels show about your hand. Recomputed only when
 * your cards, the board or the number of opponents change.
 */
export function useAnalysis(): Analysis | null {
  const game = useGameStore((s) => s.game);
  const setAdvice = useGameStore((s) => s.setAdvice);

  const me = game?.players.find((p) => p.id === HUMAN_ID);
  const active = !!game && !!me && me.hole.length > 0 && !me.folded && !me.busted;
  const hole = me?.hole ?? [];
  const board = game?.board ?? [];
  const opponents = game ? game.players.filter((p) => p.id !== HUMAN_ID && !p.busted && !p.folded).length : 0;
  const key = `${hole.join(",")}|${board.join(",")}|${opponents}`;

  const core = useMemo(() => {
    if (!active) return null;
    return {
      made: currentHand(hole, board),
      equity: estimateEquity({ hole, board, opponents: Math.max(1, opponents), iterations: equityIterations(opponents) }),
      finalOdds: finalCategoryOdds(hole, board),
      outs: countOuts(hole, board),
      threats: boardThreats(hole, board),
    };
    // `key` captures hole/board/opponents.
  }, [active, key]);

  const myTurn = !!game && game.phase === "betting" && game.players[game.toAct]?.id === HUMAN_ID;
  const sit = myTurn ? situationFor(game) : null;
  const odds = sit ? potOdds(potTotal(game!), sit.legal.toCall) : null;
  const advice = useMemo(
    () => (sit && core ? advise(sit, core.equity.equity) : null),
    // Recompute whenever the decision point changes.
    [core, myTurn, game?.history.length],
  );

  useEffect(() => {
    setAdvice(advice);
  }, [advice, setAdvice]);

  if (!core) return null;
  return { ...core, potOdds: odds, advice, opponents };
}
