import { describe, expect, it } from "vitest";
import { parseCards } from "../cards";
import { evaluate, HandCategory } from "../evaluator";
import { describeHand } from "../handRanks";

const ev = (s: string) => evaluate(parseCards(s));

describe("evaluate", () => {
  it.each([
    ["As Ks Qs Js Ts 2d 3c", HandCategory.RoyalFlush, "Royal Flush"],
    ["9h 8h 7h 6h 5h Ah Kd", HandCategory.StraightFlush, "Straight Flush, Nine high"],
    ["Ad 2d 3d 4d 5d 9c 9h", HandCategory.StraightFlush, "Straight Flush, Five high"],
    ["7s 7h 7d 7c Ks 2d 3c", HandCategory.FourOfAKind, "Four Sevens"],
    ["Qs Qh Qd 5c 5s 2d 3c", HandCategory.FullHouse, "Full House, Queens full of Fives"],
    ["Qs Qh Qd 5c 5s 5d 3c", HandCategory.FullHouse, "Full House, Queens full of Fives"],
    ["Ah Jh 8h 6h 2h Kd Kc", HandCategory.Flush, "Flush, Ace high"],
    ["9c Td Jh Qs Kd 2c 2h", HandCategory.Straight, "Straight, King high"],
    ["Ac 2d 3h 4s 5d Kc Kh", HandCategory.Straight, "Straight, Five high"],
    ["8s 8h 8d Kc 4s 2d 3c", HandCategory.ThreeOfAKind, "Three Eights"],
    ["Js Jd 7h 7c Ad 2s 3c", HandCategory.TwoPair, "Two Pair, Jacks and Sevens"],
    ["6s 6d 9h 2c Ad Ks 3c", HandCategory.Pair, "Pair of Sixes"],
    ["As Jd 8c 5h 3s 2d 9c", HandCategory.HighCard, "High Card, Ace"],
  ])("%s → %s", (cards, category, name) => {
    const hand = ev(cards);
    expect(hand.category).toBe(category);
    expect(describeHand(hand)).toBe(name);
    expect(hand.bestFive).toHaveLength(5);
  });

  it("orders hands correctly", () => {
    const ladder = [
      "As Jd 8c 5h 3s",
      "2s 2d 4c 5h 6s",
      "2s 2d 3c 3h 6s",
      "2s 2d 2c 4h 6s",
      "Ac 2d 3h 4s 5d",
      "2c 3d 4h 5s 6d",
      "2h 4h 6h 8h Th",
      "2s 2d 2c 3h 3s",
      "2s 2d 2c 2h 3s",
      "Ad 2d 3d 4d 5d",
      "Ts Js Qs Ks As",
    ].map((h) => ev(h).score);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
  });

  it("uses kickers", () => {
    expect(ev("As Ad Kc 9h 4s").score).toBeGreaterThan(ev("Ah Ac Qc Jh 9s").score);
    expect(ev("Ks Kd 7c 7h As").score).toBeGreaterThan(ev("Kh Kc 7s 7d Qs").score);
    // Third pair is ignored except as a kicker.
    expect(ev("Ks Kd 7c 7h 5s 5d 2c").ranks).toEqual([13, 7, 5]);
  });

  it("detects ties", () => {
    expect(ev("As Kd Qc Jh 9s").score).toBe(ev("Ad Kc Qh Js 9d").score);
  });

  it("matches the known 5-card category frequencies (full enumeration)", () => {
    const counts = new Array(10).fill(0);
    const hand = [0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              hand[0] = a; hand[1] = b; hand[2] = c; hand[3] = d; hand[4] = e;
              counts[evaluate(hand).category]++;
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 36, 4]);
  }, 120_000);
});
