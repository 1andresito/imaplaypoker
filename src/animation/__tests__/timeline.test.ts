import { describe, expect, it } from "vitest";
import { createRng } from "../../engine/cards";
import { applyAction, createGame, legalActions, startHand } from "../../engine/gameState";
import type { GameState, SeatSetup } from "../../engine/types";
import { buildTimeline, T, type TimelineEvent } from "../timeline";

const seats = (n: number): SeatSetup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isHuman: i === 0 }));
const config = { variantId: "holdem", smallBlind: 5, bigBlind: 10, startingStack: 1000 };

const passive = (s: GameState) => applyAction(s, { type: legalActions(s)!.canCheck ? "check" : "call" });
const kinds = (events: TimelineEvent[]) => events.map((e) => e.kind);
const sorted = (events: TimelineEvent[]) => events.every((e, i) => i === 0 || events[i - 1].at <= e.at);

describe("timeline", () => {
  it("deals every hole card in engine order, then the blinds", () => {
    const s = startHand(createGame(config, seats(3)), createRng(1));
    const { events, duration } = buildTimeline(null, s);
    const deals = events.filter((e) => e.kind === "deal");
    expect(deals).toHaveLength(6);
    // First round starts at the small blind; second round repeats the order.
    expect(deals.map((e) => e.seat)).toEqual([1, 2, 0, 1, 2, 0]);
    expect(deals.map((e) => e.index)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(kinds(events)).toContain("blinds");
    expect(sorted(events)).toBe(true);
    expect(duration).toBeGreaterThan(deals[5].at);
  });

  it("only covers what changed, and signals your turn", () => {
    const s0 = startHand(createGame(config, seats(3)), createRng(1));
    // Seat 0 (human) acts first; everyone calls around to the big blind.
    const s1 = passive(s0);
    const t1 = buildTimeline(s0, s1);
    expect(kinds(t1.events)).toEqual(["action"]);
    expect(kinds(buildTimeline(null, s0).events)).toContain("yourTurn");
  });

  it("sweeps bets into the pot before the flop turns over", () => {
    let s = startHand(createGame(config, seats(3)), createRng(1));
    let prev = s;
    while (s.street === "preflop") {
      prev = s;
      s = passive(s);
    }
    const { events } = buildTimeline(prev, s);
    const sweep = events.find((e) => e.kind === "sweep")!;
    const boards = events.filter((e) => e.kind === "board");
    expect(sweep.kind === "sweep" && sweep.bets.reduce((n, b) => n + b.amount, 0)).toBe(30);
    expect(boards).toHaveLength(3);
    expect(boards[0].at).toBeCloseTo(sweep.at + T.sweep);
    expect(sorted(events)).toBe(true);
  });

  it("ends with the reveal, payouts and the result at showdown", () => {
    let s = startHand(createGame(config, seats(2)), createRng(7));
    let prev = s;
    while (s.phase === "betting") {
      prev = s;
      s = passive(s);
    }
    const { events, duration } = buildTimeline(prev, s);
    const k = kinds(events);
    expect(k).toContain("reveal");
    expect(k).toContain("payout");
    expect(k.at(-1)).toBe("result");
    expect(k.indexOf("reveal")).toBeLessThan(k.indexOf("payout"));
    expect(k).not.toContain("yourTurn");
    expect(duration).toBeGreaterThanOrEqual(events.at(-1)!.at);
  });

  it("is empty with no game", () => {
    expect(buildTimeline(null, null).events).toEqual([]);
  });
});
