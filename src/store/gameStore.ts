import { create } from "zustand";
import { botDecision, botThinkTime } from "../ai/bot";
import { BOT_NAMES, BOT_PROFILES } from "../ai/profiles";
import type { Advice } from "../analysis/advisor";
import { createRng, randomSeed, type Rng, shuffle } from "../engine/cards";
import { applyAction, createGame, startHand } from "../engine/gameState";
import type { GameState, PlayerAction, SeatSetup } from "../engine/types";
import { load, save } from "../stats/storage";
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

const DEFAULT_SETTINGS: Settings = {
  assist: "coach",
  showHandHelper: true,
  fourColorDeck: false,
  botSpeed: "normal",
  autoDeal: false,
};

const DEFAULT_SETUP: TableSetup = {
  variantId: "holdem",
  bots: 5,
  botStyle: "mixed",
  bigBlind: 20,
  startingStack: 2000,
};

const SPEED_FACTOR: Record<BotSpeed, number> = { slow: 1.8, normal: 1, fast: 0.35 };

interface Store {
  screen: "lobby" | "table";
  settings: Settings;
  setup: TableSetup;
  game: GameState | null;
  session: SessionStats;
  lifetime: PlayerStats;
  /** The coach's advice for the current decision, if any (set by the UI's analysis hook). */
  currentAdvice: Advice | null;

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
      }, botThinkTime(rng) * factor);
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
      if (autoDeal && canDeal(game)) dealTimer = setTimeout(() => get().dealNextHand(), 3500);
    }
  }

  return {
    screen: "lobby",
    settings: load("settings", DEFAULT_SETTINGS),
    setup: load("setup", DEFAULT_SETUP),
    game: null,
    session: emptySession(DEFAULT_SETUP.startingStack),
    lifetime: load("lifetime", emptyStats()),
    currentAdvice: null,

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
      set({ screen: "lobby", game: null, currentAdvice: null });
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
