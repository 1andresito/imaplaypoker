import { create } from "zustand";
import { buildTimeline } from "../animation/timeline";
import { botDecision, botThinkTime } from "../ai/bot";
import { BOT_NAMES, BOT_PROFILES } from "../ai/profiles";
import type { Advice } from "../analysis/advisor";
import { createRng, randomSeed, type Rng, shuffle } from "../engine/cards";
import { applyAction, createGame, startHand } from "../engine/gameState";
import type { GameState, PlayerAction, SeatSetup } from "../engine/types";
import { VARIANTS } from "../engine/variants";
import { bool, clampNum, count, load, oneOf, save } from "../stats/storage";
import {
  addCoachDecision,
  addHand,
  emptySession,
  emptyStats,
  type PlayerStats,
  type SessionStats,
  summarizeHand,
} from "../stats/tracker";

export type AssistLevel = "off" | "hints" | "coach" | "guided";
export type BotSpeed = "slow" | "normal" | "fast";

export interface Settings {
  assist: AssistLevel;
  showHandHelper: boolean;
  fourColorDeck: boolean;
  botSpeed: BotSpeed;
  autoDeal: boolean;
  soundEffects: boolean;
  /** Sound-effects volume, 0–1. */
  volume: number;
  /** Looping background jazz. Off until the player turns it on. */
  music: boolean;
  /** Music volume, 0–1. */
  musicVolume: number;
  /** Scales all text up for readability. */
  largeText: boolean;
  /** Instant changes instead of flying cards and chips. */
  reduceMotion: boolean;
}

export interface TableSetup {
  variantId: string;
  bots: number;
  /** "mixed" or a profile id. */
  botStyle: string;
  bigBlind: number;
  startingStack: number;
}

export const HUMAN_ID = "you";

export type Screen = "menu" | "setup" | "howto" | "stats" | "table";

export const ASSIST_IDS: readonly AssistLevel[] = ["off", "hints", "coach", "guided"];
export const BOT_SPEEDS: readonly BotSpeed[] = ["slow", "normal", "fast"];
/** Big blinds offered in table setup (small blind is half). */
export const BIG_BLINDS = [10, 20, 50, 100] as const;
/** Starting stacks offered in table setup, in big blinds. */
export const STACK_DEPTHS = [50, 100, 200] as const;
export const MAX_BOTS = 8;

const DEFAULT_SETTINGS: Settings = {
  assist: "coach",
  showHandHelper: true,
  fourColorDeck: false,
  botSpeed: "normal",
  autoDeal: false,
  soundEffects: true,
  volume: 0.7,
  music: false,
  musicVolume: 0.35,
  largeText: false,
  // Off by default: many Windows machines report "reduce motion" just because
  // animation effects were turned off for performance. Players can opt in.
  reduceMotion: false,
};

const DEFAULT_SETUP: TableSetup = {
  variantId: "holdem",
  bots: 5,
  botStyle: "mixed",
  bigBlind: 20,
  startingStack: 2000,
};

function sanitizeSettings(s: Settings, d: Settings): Settings {
  return {
    assist: oneOf(s.assist, ASSIST_IDS, d.assist),
    showHandHelper: bool(s.showHandHelper, d.showHandHelper),
    fourColorDeck: bool(s.fourColorDeck, d.fourColorDeck),
    botSpeed: oneOf(s.botSpeed, BOT_SPEEDS, d.botSpeed),
    autoDeal: bool(s.autoDeal, d.autoDeal),
    soundEffects: bool(s.soundEffects, d.soundEffects),
    volume: clampNum(s.volume, 0, 1, d.volume),
    music: bool(s.music, d.music),
    musicVolume: clampNum(s.musicVolume, 0, 1, d.musicVolume),
    largeText: bool(s.largeText, d.largeText),
    reduceMotion: bool(s.reduceMotion, d.reduceMotion),
  };
}

function sanitizeSetup(s: TableSetup, d: TableSetup): TableSetup {
  const bigBlind = oneOf(s.bigBlind, BIG_BLINDS, d.bigBlind);
  // The stack must be one of the offered depths at this blind level.
  const depth = oneOf(s.startingStack / bigBlind, STACK_DEPTHS, d.startingStack / d.bigBlind);
  return {
    variantId: oneOf(s.variantId, Object.keys(VARIANTS), d.variantId),
    bots: Number.isInteger(s.bots) ? Math.min(MAX_BOTS, Math.max(1, s.bots)) : d.bots,
    botStyle: oneOf(s.botStyle, ["mixed", ...Object.keys(BOT_PROFILES)], d.botStyle),
    bigBlind,
    startingStack: depth * bigBlind,
  };
}

function sanitizeLifetime(s: PlayerStats, d: PlayerStats): PlayerStats {
  const byCat = Array.isArray(s.wonByCategory) && s.wonByCategory.length === d.wonByCategory.length ? s.wonByCategory : d.wonByCategory;
  return {
    handsPlayed: count(s.handsPlayed, 0),
    vpipHands: count(s.vpipHands, 0),
    pfrHands: count(s.pfrHands, 0),
    handsWon: count(s.handsWon, 0),
    showdowns: count(s.showdowns, 0),
    showdownsWon: count(s.showdownsWon, 0),
    netChips: Number.isInteger(s.netChips) ? s.netChips : 0,
    biggestPotWon: count(s.biggestPotWon, 0),
    wonByCategory: byCat.map((n) => count(n, 0)),
    coachDecisions: count(s.coachDecisions, 0),
    coachAgreed: count(s.coachAgreed, 0),
  };
}

/** Exported for tests. */
export const sanitizers = { settings: sanitizeSettings, setup: sanitizeSetup, lifetime: sanitizeLifetime };

const SPEED_FACTOR: Record<BotSpeed, number> = { slow: 1.8, normal: 1, fast: 0.35 };

interface Store {
  screen: Screen;
  settings: Settings;
  setup: TableSetup;
  game: GameState | null;
  session: SessionStats;
  lifetime: PlayerStats;
  /** The coach's advice for the current decision, if any (set by the UI's analysis hook). */
  currentAdvice: Advice | null;

  goTo(screen: Exclude<Screen, "table">): void;
  updateSettings(patch: Partial<Settings>): void;
  updateSetup(patch: Partial<TableSetup>): void;
  sitDown(): void;
  leaveTable(): void;
  dealNextHand(): void;
  rebuy(): void;
  humanAct(action: PlayerAction): void;
  setAdvice(advice: Advice | null): void;
  resetLifetime(): void;
}

let rng: Rng = createRng(randomSeed());
let botTimer: ReturnType<typeof setTimeout> | null = null;
let dealTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (botTimer) clearTimeout(botTimer);
  if (dealTimer) clearTimeout(dealTimer);
  botTimer = dealTimer = null;
}

function buildSeats(setup: TableSetup): SeatSetup[] {
  const names = shuffle(BOT_NAMES, rng);
  const profileIds = Object.keys(BOT_PROFILES);
  const bots: SeatSetup[] = Array.from({ length: setup.bots }, (_, i) => ({
    id: `bot${i}`,
    name: names[i % names.length],
    isHuman: false,
    botProfile: setup.botStyle === "mixed" ? profileIds[Math.floor(rng() * profileIds.length)] : setup.botStyle,
  }));
  return [{ id: HUMAN_ID, name: "You", isHuman: true }, ...bots];
}

export const useGameStore = create<Store>((set, get) => {
  /** After every state change: schedule the next bot action or record a finished hand. */
  function step(game: GameState) {
    clearTimers();
    // Let the cards and chips finish moving before anyone acts again.
    const animationMs = get().settings.reduceMotion ? 0 : buildTimeline(get().game, game).duration * 1000;
    set({ game });
    if (game.phase === "betting") {
      const actor = game.players[game.toAct];
      if (actor.isHuman) return;
      const human = game.players.find((p) => p.isHuman)!;
      // Speed things up once you're out of the hand.
      const factor = SPEED_FACTOR[get().settings.botSpeed] * (human.folded || human.busted ? 0.4 : 1);
      botTimer = setTimeout(() => {
        const current = get().game;
        if (current !== game) return;
        step(applyAction(current, botDecision(current, rng)));
      }, animationMs + botThinkTime(rng) * factor);
      return;
    }
    if (game.phase === "complete") {
      const summary = summarizeHand(game, HUMAN_ID);
      if (summary) {
        const human = game.players.find((p) => p.id === HUMAN_ID)!;
        const session = addHand(get().session, summary);
        session.stackHistory = [...session.stackHistory, human.stack];
        const lifetime = addHand(get().lifetime, summary);
        set({ session, lifetime });
        save("lifetime", lifetime);
      }
      const { autoDeal } = get().settings;
      if (autoDeal && canDeal(game)) dealTimer = setTimeout(() => get().dealNextHand(), animationMs + 3500);
    }
  }

  return {
    screen: "menu",
    settings: load("settings", DEFAULT_SETTINGS, sanitizeSettings),
    setup: load("setup", DEFAULT_SETUP, sanitizeSetup),
    game: null,
    session: emptySession(DEFAULT_SETUP.startingStack),
    lifetime: load("lifetime", emptyStats(), sanitizeLifetime),
    currentAdvice: null,

    goTo(screen) {
      set({ screen });
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      save("settings", settings);
    },

    updateSetup(patch) {
      const setup = { ...get().setup, ...patch };
      set({ setup });
      save("setup", setup);
    },

    sitDown() {
      clearTimers();
      const { setup } = get();
      rng = createRng(randomSeed());
      const config = {
        variantId: setup.variantId,
        smallBlind: setup.bigBlind / 2,
        bigBlind: setup.bigBlind,
        startingStack: setup.startingStack,
      };
      const game = createGame(config, buildSeats(setup));
      game.dealer = Math.floor(rng() * game.players.length);
      set({ screen: "table", session: emptySession(setup.startingStack), currentAdvice: null });
      step(startHand(game, rng));
    },

    leaveTable() {
      clearTimers();
      set({ screen: "menu", game: null, currentAdvice: null });
    },

    dealNextHand() {
      const { game } = get();
      if (!game || !canDeal(game)) return;
      set({ currentAdvice: null });
      step(startHand(game, rng));
    },

    rebuy() {
      const { game } = get();
      if (!game || game.phase === "betting") return;
      const next = structuredClone(game);
      const human = next.players.find((p) => p.id === HUMAN_ID)!;
      // Refill everyone who is out of chips (you and the bots) so the table stays lively.
      for (const p of next.players) if (p.stack === 0) p.stack = next.config.startingStack;
      const session = { ...get().session, stackHistory: [...get().session.stackHistory, human.stack] };
      set({ session, currentAdvice: null });
      step(startHand(next, rng));
    },

    humanAct(action) {
      const { game, currentAdvice, settings } = get();
      if (!game || game.phase !== "betting" || !game.players[game.toAct].isHuman) return;
      if (currentAdvice && (settings.assist === "coach" || settings.assist === "guided")) {
        const agreed = sameKind(action.type, currentAdvice.action);
        set({ session: addCoachDecision(get().session, agreed), lifetime: addCoachDecision(get().lifetime, agreed) });
      }
      set({ currentAdvice: null });
      step(applyAction(game, action));
    },

    setAdvice(advice) {
      set({ currentAdvice: advice });
    },

    resetLifetime() {
      const lifetime = emptyStats();
      set({ lifetime });
      save("lifetime", lifetime);
    },
  };
});

/** Bet and raise are the same decision; so are check and call when nothing is owed. */
const sameKind = (a: string, b: string) => {
  const norm = (t: string) => (t === "bet" ? "raise" : t);
  return norm(a) === norm(b);
};

/** A new hand can start if you still have chips and at least one bot does. */
export function canDeal(game: GameState): boolean {
  if (game.phase === "betting") return false;
  const human = game.players.find((p) => p.id === HUMAN_ID)!;
  return human.stack > 0 && game.players.some((p) => !p.isHuman && p.stack > 0);
}
