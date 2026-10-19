import { describe, expect, it } from "vitest";
import { createRng, parseCards } from "../cards";
import { applyAction, createGame, legalActions, potTotal, runOutBoard, startHand } from "../gameState";
import { buildPots } from "../showdown";
import type { GameState, PlayerAction, SeatSetup } from "../types";

const seats = (n: number): SeatSetup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isHuman: i === 0 }));

const config = { variantId: "holdem", smallBlind: 5, bigBlind: 10, startingStack: 1000 };

// Once a hand is complete the pot has been paid out; handBet is kept only for display.
const totalChips = (s: GameState) =>
  s.players.reduce((sum, p) => sum + p.stack, 0) + (s.phase === "betting" ? potTotal(s) : 0);
const actor = (s: GameState) => s.players[s.toAct].id;

/** Replaces the deck so the next cards dealt are known: hole cards per seat, then the board. */
function rig(state: GameState, holes: string[], board: string): GameState {
  const s = structuredClone(state);
  holes.forEach((h, i) => (s.players[i].hole = parseCards(h)));
  // Board is dealt from the end of the deck.
  s.deck = parseCards(board).reverse();
  return s;
}

describe("blinds and action order", () => {
  it("posts blinds and starts left of the big blind (3-handed)", () => {
    const s = startHand(createGame(config, seats(3)), createRng(1));
    expect(s.dealer).toBe(0);
    expect(s.players[1].streetBet).toBe(5);
    expect(s.players[2].streetBet).toBe(10);
    expect(actor(s)).toBe("p0");
    expect(s.players.every((p) => p.hole.length === 2)).toBe(true);
  });

  it("heads-up: dealer is small blind and acts first preflop, last postflop", () => {
    let s = startHand(createGame(config, seats(2)), createRng(1));
    expect(s.dealer).toBe(0);
    expect(s.smallBlindSeat).toBe(0);
    expect(actor(s)).toBe("p0");
    s = applyAction(s, { type: "call" });
    expect(actor(s)).toBe("p1"); // big blind option
    s = applyAction(s, { type: "check" });
    expect(s.street).toBe("flop");
    expect(s.board).toHaveLength(3);
    expect(actor(s)).toBe("p1");
  });

  it("gives the big blind an option when everyone limps", () => {
    let s = startHand(createGame(config, seats(3)), createRng(2));
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "call" });
    expect(actor(s)).toBe("p2");
    const legal = legalActions(s)!;
    expect(legal.canCheck).toBe(true);
    expect(legal.canRaise).toBe(true);
    s = applyAction(s, { type: "raise", amount: 40 });
    expect(actor(s)).toBe("p0");
    expect(legalActions(s)!.toCall).toBe(30);
  });

  it("rotates the button", () => {
    let s = startHand(createGame(config, seats(3)), createRng(3));
    s = applyAction(s, { type: "fold" });
    s = applyAction(s, { type: "fold" });
    expect(s.phase).toBe("complete");
    s = startHand(s, createRng(4));
    expect(s.dealer).toBe(1);
  });
});

describe("raising rules", () => {
  it("enforces the minimum raise", () => {
    let s = startHand(createGame(config, seats(3)), createRng(5));
    expect(legalActions(s)!.minRaiseTo).toBe(20);
    s = applyAction(s, { type: "raise", amount: 50 }); // raise of 40
    expect(legalActions(s)!.minRaiseTo).toBe(90);
    expect(() => applyAction(s, { type: "raise", amount: 80 })).toThrow();
  });

  it("a short all-in does not reopen raising for players who already acted", () => {
    const game = createGame(config, seats(3));
    game.players[2].stack = 65; // big blind will be short
    let s = startHand(game, createRng(6));
    s = applyAction(s, { type: "raise", amount: 50 }); // p0 raises to 50
    s = applyAction(s, { type: "call" }); // p1 calls
    s = applyAction(s, { type: "raise", amount: 65 }); // p2 all-in for 65: only +15
    expect(actor(s)).toBe("p0");
    const legal = legalActions(s)!;
    expect(legal.toCall).toBe(15);
    expect(legal.canRaise).toBe(false);
  });
});

describe("hand completion", () => {
  it("everyone folds: winner takes blinds and uncalled bet is returned", () => {
    let s = startHand(createGame(config, seats(3)), createRng(7));
    s = applyAction(s, { type: "raise", amount: 30 });
    s = applyAction(s, { type: "fold" });
    s = applyAction(s, { type: "fold" });
    expect(s.phase).toBe("complete");
    expect(s.outcome!.showdown).toBe(false);
    expect(s.players[0].stack).toBe(1015);
    expect(s.history.some((e) => e.kind === "refund" && e.amount === 20)).toBe(true);
  });

  it("showdown: best hand wins, split pots divide evenly", () => {
    let s = startHand(createGame(config, seats(2)), createRng(8));
    s = rig(s, ["As Kd", "Ah Kc"], "2c 7d 9h Js 3s");
    s = applyAction(s, { type: "call" });
    s = applyAction(s, { type: "check" });
    for (let i = 0; i < 6; i++) s = applyAction(s, { type: "check" });
    expect(s.phase).toBe("complete");
    expect(s.outcome!.pots[0].winners).toEqual(["p1", "p0"]);
    expect(s.players[0].stack).toBe(1000);
    expect(s.players[1].stack).toBe(1000);
  });

  it("all-in runs out the board and builds side pots", () => {
    const game = createGame(config, seats(3));
    game.players[0].stack = 100;
    game.players[1].stack = 300;
    game.players[2].stack = 1000;
    let s = startHand(game, createRng(9));
    // p0 has the nuts but is shortest; p1 beats p2.
    s = rig(s, ["As Ah", "Ks Kh", "Qs Qh"], "2c 7d 9h Jc 3d");
    s = applyAction(s, { type: "raise", amount: 100 }); // p0 all-in
    s = applyAction(s, { type: "raise", amount: 300 }); // p1 all-in
    s = applyAction(s, { type: "call" }); // p2 calls 300
    expect(s.phase).toBe("complete");
    expect(s.board).toHaveLength(5);
    expect(s.outcome!.pots.map((p) => p.amount)).toEqual([300, 400]);
    expect(s.players.map((p) => p.stack)).toEqual([300, 400, 700]);
  });
});

describe("runOutBoard", () => {
  it("predicts the board the hand actually deals", () => {
    for (const seed of [1, 2, 3]) {
      let s = startHand(createGame(config, seats(4)), createRng(seed));
      const predicted = runOutBoard(s);
      expect(predicted).toHaveLength(5);
      while (s.phase === "betting") s = applyAction(s, { type: legalActions(s)!.canCheck ? "check" : "call" });
      expect(s.board).toEqual(predicted);
    }
  });
});

describe("buildPots", () => {
  it("counts folded chips but excludes folded players", () => {
    const base = { id: "", name: "", isHuman: false, stack: 0, hole: [], allIn: false, streetBet: 0, hasActed: true, busted: false };
    const pots = buildPots([
      { ...base, id: "a", handBet: 50, folded: false },
      { ...base, id: "b", handBet: 100, folded: false },
      { ...base, id: "c", handBet: 100, folded: true },
      { ...base, id: "d", handBet: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligible: ["a", "b", "d"] },
      { amount: 150, eligible: ["b", "d"] },
      { amount: 100, eligible: ["d"] },
    ]);
  });
});

describe("simulation", () => {
  it("plays thousands of random hands without breaking invariants", () => {
    const rng = createRng(42);
    for (let game = 0; game < 40; game++) {
      const n = 2 + (game % 8);
      let s = createGame({ ...config, startingStack: 200 + game * 37 }, seats(n));
      const chips = totalChips(s);
      for (let hand = 0; hand < 60 && s.players.filter((p) => p.stack > 0).length > 1; hand++) {
        s = startHand(s, rng);
        let guard = 0;
        while (s.phase === "betting") {
          if (++guard > 500) throw new Error("hand did not terminate");
          const legal = legalActions(s)!;
          const r = rng();
          let action: PlayerAction;
          if (legal.canRaise && r < 0.25) {
            const to = legal.minRaiseTo + Math.floor(rng() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
            action = { type: legal.raiseType, amount: to };
          } else if (legal.canFold && r < 0.4) action = { type: "fold" };
          else action = { type: legal.canCheck ? "check" : "call" };
          s = applyAction(s, action);
          expect(totalChips(s)).toBe(chips);
          for (const p of s.players) expect(p.stack).toBeGreaterThanOrEqual(0);
        }
        expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(chips);
        if (s.outcome!.showdown) expect(s.board).toHaveLength(5);
      }
    }
  });
});
