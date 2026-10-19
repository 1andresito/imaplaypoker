import { describe, expect, it } from "vitest";
import { createRng, parseCards } from "../../engine/cards";
import { applyAction, createGame, startHand } from "../../engine/gameState";
import type { GameState, SeatSetup } from "../../engine/types";
import { foldWhatIf } from "../whatIf";

const seats = (n: number): SeatSetup[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isHuman: i === 0 }));
const config = { variantId: "holdem", smallBlind: 5, bigBlind: 10, startingStack: 1000 };

/** A fresh hand with known hole cards and a known board (dealt from the end of the deck). */
function rigged(n: number, holes: string[], board: string): GameState {
  const s = startHand(createGame(config, seats(n)), createRng(1));
  holes.forEach((h, i) => (s.players[i].hole = parseCards(h)));
  s.deck = parseCards(board).reverse();
  return s;
}

describe("foldWhatIf", () => {
  it("says you would have won after folding the best hand", () => {
    // Heads-up: p0 is the dealer and acts first preflop.
    const s = applyAction(rigged(2, ["As Ah", "7c 2d"], "Kd Kh 9s 3c 4c"), { type: "fold" });
    expect(s.phase).toBe("complete");
    const r = foldWhatIf(s, "p0");
    expect(r?.kind).toBe("final");
    if (r?.kind !== "final") return;
    expect(r.result).toBe("win");
    expect(r.ranOut).toBe(true);
    expect(r.board).toEqual(parseCards("Kd Kh 9s 3c 4c"));
    expect(r.bestOpponent.id).toBe("p1");
  });

  it("says you would have lost after folding the worse hand", () => {
    const s = applyAction(rigged(2, ["7c 2d", "As Ah"], "Kd Kh 9s 3c 4c"), { type: "fold" });
    const r = foldWhatIf(s, "p0");
    expect(r?.kind === "final" && r.result).toBe("lose");
  });

  it("gives live odds against the real hands while the hand plays on", () => {
    // 3-handed: p0 acts first preflop; the others play on after the fold.
    const s = applyAction(rigged(3, ["As Ah", "7c 2d", "8c 3d"], "Kd Kh 9s Jc 4c"), { type: "fold" });
    expect(s.phase).toBe("betting");
    const r = foldWhatIf(s, "p0");
    expect(r?.kind).toBe("live");
    if (r?.kind !== "live") return;
    expect(r.equity).toBe(1);
  });

  it("returns null without the deck (multiplayer view) or when you didn't fold", () => {
    const s = applyAction(rigged(2, ["As Ah", "7c 2d"], "Kd Kh 9s 3c 4c"), { type: "fold" });
    expect(foldWhatIf({ ...s, deck: [] }, "p0")).toBeNull();
    expect(foldWhatIf(s, "p1")).toBeNull();
  });
});
