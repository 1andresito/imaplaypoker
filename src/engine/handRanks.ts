import { type Rank, rankName, rankPlural } from "./cards";
import { HandCategory, type HandResult } from "./evaluator";

export interface HandRankInfo {
  category: HandCategory;
  name: string;
  description: string;
  /** Example hand in parseCards() notation. */
  example: string;
  /** Probability of making this as your best 7-card hand (Texas Hold'em, by the river). */
  sevenCardOdds: number;
}

// Probabilities from the full enumeration of 133,784,560 seven-card hands.
export const HAND_RANKS: readonly HandRankInfo[] = [
  {
    category: HandCategory.HighCard,
    name: "High Card",
    description: "No combination. Your highest card plays.",
    example: "As Jd 8c 5h 3s",
    sevenCardOdds: 0.1741,
  },
  {
    category: HandCategory.Pair,
    name: "One Pair",
    description: "Two cards of the same rank.",
    example: "Kh Kc 9s 6d 2h",
    sevenCardOdds: 0.4383,
  },
  {
    category: HandCategory.TwoPair,
    name: "Two Pair",
    description: "Two different pairs.",
    example: "Js Jd 7h 7c Ad",
    sevenCardOdds: 0.235,
  },
  {
    category: HandCategory.ThreeOfAKind,
    name: "Three of a Kind",
    description: "Three cards of the same rank. Also called trips or a set.",
    example: "8s 8h 8d Kc 4s",
    sevenCardOdds: 0.0483,
  },
  {
    category: HandCategory.Straight,
    name: "Straight",
    description: "Five cards in a row, any suits. Ace can be high (10-J-Q-K-A) or low (A-2-3-4-5).",
    example: "9c Td Jh Qs Kd",
    sevenCardOdds: 0.0462,
  },
  {
    category: HandCategory.Flush,
    name: "Flush",
    description: "Five cards of the same suit, in any order.",
    example: "Ah Jh 8h 6h 2h",
    sevenCardOdds: 0.0303,
  },
  {
    category: HandCategory.FullHouse,
    name: "Full House",
    description: "Three of a kind plus a pair.",
    example: "Qs Qh Qd 5c 5s",
    sevenCardOdds: 0.026,
  },
  {
    category: HandCategory.FourOfAKind,
    name: "Four of a Kind",
    description: "All four cards of one rank. Also called quads.",
    example: "7s 7h 7d 7c Ks",
    sevenCardOdds: 0.00168,
  },
  {
    category: HandCategory.StraightFlush,
    name: "Straight Flush",
    description: "Five cards in a row, all the same suit.",
    example: "5d 6d 7d 8d 9d",
    sevenCardOdds: 0.000279,
  },
  {
    category: HandCategory.RoyalFlush,
    name: "Royal Flush",
    description: "10-J-Q-K-A, all the same suit. The best possible hand.",
    example: "Ts Js Qs Ks As",
    sevenCardOdds: 0.000032,
  },
];

export const categoryName = (category: HandCategory): string => HAND_RANKS[category].name;

/** Plain-English description, e.g. "Two Pair, Kings and Sevens". */
export function describeHand(hand: HandResult): string {
  const [a, b] = hand.ranks as Rank[];
  switch (hand.category) {
    case HandCategory.HighCard:
      return `High Card, ${rankName(a)}`;
    case HandCategory.Pair:
      return `Pair of ${rankPlural(a)}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${rankPlural(a)} and ${rankPlural(b)}`;
    case HandCategory.ThreeOfAKind:
      return `Three ${rankPlural(a)}`;
    case HandCategory.Straight:
      return `Straight, ${rankName(a)} high`;
    case HandCategory.Flush:
      return `Flush, ${rankName(a)} high`;
    case HandCategory.FullHouse:
      return `Full House, ${rankPlural(a)} full of ${rankPlural(b)}`;
    case HandCategory.FourOfAKind:
      return `Four ${rankPlural(a)}`;
    case HandCategory.StraightFlush:
      return `Straight Flush, ${rankName(a)} high`;
    case HandCategory.RoyalFlush:
      return "Royal Flush";
  }
}
