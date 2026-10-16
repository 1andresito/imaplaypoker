import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advise } from "../../analysis/advisor";
import { estimateEquity } from "../../analysis/equity";
import { situationFor } from "../../analysis/situation";
import { HUMAN_ID, useGameStore } from "../gameStore";

describe("game store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    useGameStore.getState().leaveTable();
    vi.useRealTimers();
  });

  it("plays many hands end to end, following the coach, and tracks stats", () => {
    const store = useGameStore;
    store.getState().updateSetup({ bots: 5, botStyle: "mixed", bigBlind: 20, startingStack: 2000 });
    store.getState().updateSettings({ assist: "coach", autoDeal: false });
    store.getState().sitDown();

    let hands = 0;
    let guard = 0;
    while (hands < 60 && guard++ < 20000) {
      const { game } = store.getState();
      expect(game).not.toBeNull();
      if (game!.phase === "complete") {
        const me = game!.players.find((p) => p.id === HUMAN_ID)!;
        if (me.stack === 0 || game!.players.every((p) => p.isHuman || p.stack === 0)) store.getState().rebuy();
        else store.getState().dealNextHand();
        hands++;
        continue;
      }
      if (game!.players[game!.toAct].id === HUMAN_ID) {
        // Act exactly as the UI would with the coach's advice.
        const sit = situationFor(game!)!;
        const eq = estimateEquity({ hole: sit.hole, board: sit.board, opponents: Math.max(1, sit.opponents), iterations: 300 });
        const advice = advise(sit, eq.equity);
        store.getState().setAdvice(advice);
        store.getState().humanAct({ type: advice.action, amount: advice.amount });
      } else {
        vi.advanceTimersByTime(5000);
      }
    }

    const { session } = store.getState();
    expect(hands).toBe(60);
    expect(session.handsPlayed).toBeGreaterThanOrEqual(55);
    expect(session.coachDecisions).toBeGreaterThan(0);
    expect(session.coachAgreed).toBe(session.coachDecisions);
    expect(session.stackHistory.length).toBeGreaterThan(50);
  }, 60_000);
});
