export interface BotProfile {
  id: string;
  name: string;
  /** Shown in the lobby and on hover, so players learn to recognize styles. */
  description: string;
  /** Plays this many starting-hand groups looser (+) or tighter (−) than the coach. */
  looseness: number;
  /** Chance to bet/raise instead of check/call when the coach says check/call with a decent hand. */
  aggression: number;
  /** Chance to bet as a bluff with a weak hand when checked to. */
  bluff: number;
  /** Lowers the equity needed to call; a "calling station" calls far too much. */
  stickiness: number;
}

export const BOT_PROFILES: Record<string, BotProfile> = {
  rock: {
    id: "rock",
    name: "Rock",
    description: "Tight-passive. Plays very few hands and rarely bluffs. When a Rock bets, believe them.",
    looseness: -1,
    aggression: 0.05,
    bluff: 0.02,
    stickiness: 0,
  },
  tag: {
    id: "tag",
    name: "Shark",
    description: "Tight-aggressive (TAG). Solid, plays good hands hard. The style most winning players use.",
    looseness: 0,
    aggression: 0.3,
    bluff: 0.12,
    stickiness: 0,
  },
  lag: {
    id: "lag",
    name: "Maniac",
    description: "Loose-aggressive (LAG). Plays lots of hands and bets often. Call down lighter against them.",
    looseness: 3,
    aggression: 0.55,
    bluff: 0.35,
    stickiness: 0.05,
  },
  station: {
    id: "station",
    name: "Calling Station",
    description: "Loose-passive. Calls almost everything and rarely raises. Don't bluff them; value-bet them.",
    looseness: 3,
    aggression: 0.05,
    bluff: 0.03,
    stickiness: 0.2,
  },
};

export const BOT_NAMES = [
  "Ava", "Bruno", "Chen", "Dara", "Eli", "Fatima", "Gus", "Hana", "Ivan", "Jules", "Kofi", "Lena", "Mateo", "Nia",
];
