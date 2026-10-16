import { describe, expect, it } from "vitest";
import { botDecision } from "../../ai/bot";
import { createRng, parseCards } from "../../engine/cards";
import { HandCategory } from "../../engine/evaluator";
import { applyAction, createGame, legalActions, startHand } from "../../engine/gameState";
import type { SeatSetup } from "../../engine/types";
import { advise } from "../advisor";
import { estimateEquity } from "../equity";
import { boardThreats, currentHand, finalCategoryOdds } from "../madeHand";
import { countOuts } from "../outs";
import { potOdds } from "../potOdds";
import { describeStartingHand, handClass, preflopGroup, topPercent } from "../preflopChart";
import { positionOf, situationFor } from "../situation";

describe("equity", () => {
  it("AA is about 85% vs one random hand preflop", () => {
    const r = estimateEquity({ hole: parseCards("As Ah"), board: [], opponents: 1, iterations: 20000 });
    expect(r.equity).toBeGreaterThan(0.83);
    expect(r.equity).toBeLessThan(0.87);
  });

  it("72o is weak vs one random hand (~35%)", () => {
    const r = estimateEquity({ hole: parseCards("7s 2h"), board: [], opponents: 1, iterations: 20000 });
    expect(r.equity).toBeGreaterThan(0.32);
    expect(r.equity).toBeLessThan(0.38);
  });

  it("the nuts on the river always wins", () => {
    const r = estimateEquity({ hole: parseCards("As Ks"), board: parseCards("Qs Js Ts 2d 3c"), opponents: 3, iterations: 500 });
    expect(r.win).toBe(1);
  });
});

describe("outs", () => {
  it("counts 9 flush outs", () => {
    const r = countOuts(parseCards("Ah 5h"), parseCards("Kh 9h 2c"))!;
    const flush = r.byCategory.find((g) => g.category === HandCategory.Flush)!;
    expect(flush.cards).toHaveLength(9);
    // Flush draw on the flop: ~35% by the river (plus pair outs here).
    expect(r.byRiver).toBeGreaterThan(0.34);
  });

  it("counts 8 outs for an open-ended straight draw", () => {
    const r = countOuts(parseCards("8c 7d"), parseCards("6h 5s Kc"))!;
    expect(r.byCategory.find((g) => g.category === HandCategory.Straight)!.cards).toHaveLength(8);
  });

  it("ignores cards that only improve the board", () => {
    const r = countOuts(parseCards("Ac Kd"), parseCards("7h 7s 2c 9d"))!;
    // A third 7 makes trips on the board for everyone; it should not count.
    expect(r.outs.some((c) => c >> 2 === 5)).toBe(false);
  });
});

describe("made hand and threats", () => {
  it("describes hands", () => {
    expect(currentHand(parseCards("Kd Kc"), []).name).toBe("Pocket Kings");
    expect(currentHand(parseCards("Kd 7c"), parseCards("Ks 7h 2d")).name).toBe("Two Pair, Kings and Sevens");
    expect(currentHand(parseCards("2d 3c"), parseCards("As Ah Ad Ac Ks")).playsTheBoard).toBe(true);
  });

  it("finds flush threats on a three-suited board", () => {
    const r = boardThreats(parseCards("Ac Ad"), parseCards("Kh 9h 2h"))!;
    expect(r.isNuts).toBe(false);
    expect(r.byCategory.some((g) => g.category === HandCategory.Flush)).toBe(true);
    expect(r.total).toBe(1081);
  });

  it("recognizes the nuts", () => {
    expect(boardThreats(parseCards("As Ks"), parseCards("Qs Js Ts"))!.isNuts).toBe(true);
  });

  it("final category odds sum to 1", () => {
    const odds = finalCategoryOdds(parseCards("Ah 5h"), parseCards("Kh 9h 2c"));
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(odds[HandCategory.FourOfAKind]).toBe(0);
  });
});

describe("preflop chart & pot odds", () => {
  it("classifies starting hands", () => {
    expect(handClass(parseCards("Ks As"))).toBe("AKs");
    expect(preflopGroup(parseCards("As Ah"))).toBe(1);
    expect(preflopGroup(parseCards("7s 2h"))).toBe(9);
    expect(describeStartingHand(parseCards("Ts 9h"))).toBe("Ten-Nine offsuit");
    expect(topPercent(parseCards("7s 2h"))).toBe(100);
    expect(topPercent(parseCards("As Ah"))).toBeLessThan(3);
  });

  it("computes pot odds", () => {
    const o = potOdds(30, 10)!;
    expect(o.requiredEquity).toBeCloseTo(0.25);
    expect(o.ratio).toBe("3.0 : 1");
  });
});

const seats = (n: number): SeatSetup[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    isHuman: false,
    botProfile: ["rock", "tag", "lag", "station"][i % 4],
  }));

describe("positions and advisor", () => {
  it("labels positions at a 6-max table", () => {
    const s = startHand(createGame({ variantId: "holdem", smallBlind: 5, bigBlind: 10, startingStack: 1000 }, seats(6)), createRng(1));
    expect([0, 1, 2, 3, 4, 5].map((i) => positionOf(s, i))).toEqual([
      "late", "small blind", "big blind", "early", "middle", "late",
    ]);
  });

  it("recommends raising aces and folding trash under the gun", () => {
    let s = startHand(createGame({ variantId: "holdem", smallBlind: 5, bigBlind: 10, startingStack: 1000 }, seats(6)), createRng(1));
    s.players[3].hole = parseCards("As Ah");
    expect(advise(situationFor(s)!, 0).action).toBe("raise");
    s = structuredClone(s);
    s.players[3].hole = parseCards("7s 2h");
    const a = advise(situationFor(s)!, 0);
    expect(a.action).toBe("fold");
    expect(a.reason).toMatch(/Seven-Two offsuit/);
  });
});

describe("bots", () => {
  it("play full games to completion with only legal actions", () => {
    const rng = createRng(99);
    for (let g = 0; g < 6; g++) {
      let s = createGame({ variantId: "holdem", smallBlind: 5, bigBlind: 10, startingStack: 500 }, seats(2 + g));
      const chips = 500 * (2 + g);
      for (let h = 0; h < 40 && s.players.filter((p) => p.stack > 0).length > 1; h++) {
        s = startHand(s, rng);
        while (s.phase === "betting") {
          expect(legalActions(s)).not.toBeNull();
          s = applyAction(s, botDecision(s, rng));
        }
        expect(s.players.reduce((n, p) => n + p.stack, 0)).toBe(chips);
      }
    }
  }, 60_000);
});
