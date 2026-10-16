import { afterEach, describe, expect, it } from "vitest";
import { emptyStats } from "../../stats/tracker";
import { load } from "../../stats/storage";
import { sanitizers } from "../gameStore";

const store = new Map<string, string>();
(globalThis as { localStorage?: Pick<Storage, "getItem" | "setItem"> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
};
const put = (key: string, raw: string) => store.set(`imaplaypoker.${key}`, raw);

const SETTINGS = {
  assist: "coach" as const, showHandHelper: true, fourColorDeck: false, botSpeed: "normal" as const, autoDeal: false,
  soundEffects: true, volume: 0.7, music: false, musicVolume: 0.35, largeText: false, reduceMotion: false,
};
const SETUP = { variantId: "holdem", bots: 5, botStyle: "mixed", bigBlind: 20, startingStack: 2000 };

afterEach(() => store.clear());

describe("loading saved data", () => {
  it("falls back on garbage", () => {
    for (const raw of ["not json", "null", "42", "[1,2]", '"text"']) {
      put("settings", raw);
      expect(load("settings", SETTINGS, sanitizers.settings)).toEqual(SETTINGS);
    }
  });

  it("repairs bad settings field by field", () => {
    put("settings", JSON.stringify({ botSpeed: "warp", volume: 9, assist: "hints", music: "yes", musicVolume: Number.NaN }));
    const s = load("settings", SETTINGS, sanitizers.settings);
    expect(s.botSpeed).toBe("normal");
    expect(s.volume).toBe(1);
    expect(s.assist).toBe("hints");
    expect(s.music).toBe(false);
    expect(s.musicVolume).toBe(0.35);
  });

  it("keeps the table setup playable", () => {
    put("setup", JSON.stringify({ bots: 50, bigBlind: 15, startingStack: 7, variantId: "omaha", botStyle: "evil" }));
    expect(load("setup", SETUP, sanitizers.setup)).toEqual({ ...SETUP, bots: 8 });
    put("setup", JSON.stringify({ bots: 2, bigBlind: 50, startingStack: 10000 }));
    expect(load("setup", SETUP, sanitizers.setup)).toMatchObject({ bots: 2, bigBlind: 50, startingStack: 10000 });
  });

  it("drops corrupt lifetime stats", () => {
    put("lifetime", JSON.stringify({ handsPlayed: -3, handsWon: 4, wonByCategory: [1, 2], netChips: 1.5 }));
    const s = load("lifetime", emptyStats(), sanitizers.lifetime);
    expect(s.handsPlayed).toBe(0);
    expect(s.handsWon).toBe(4);
    expect(s.wonByCategory).toHaveLength(10);
    expect(s.netChips).toBe(0);
  });
});
