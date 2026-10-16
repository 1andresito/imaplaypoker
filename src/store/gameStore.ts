import { create } from "zustand";
import { buildTimeline } from "../animation/timeline";
import { botDecision, botThinkTime } from "../ai/bot";
import { BOT_NAMES, BOT_PROFILES } from "../ai/profiles";
import type { Advice } from "../analysis/advisor";
import { createRng, randomSeed, type Rng, shuffle } from "../engine/cards";
import { applyAction, createGame, legalActions, playersWithChips, startHand } from "../engine/gameState";
import type { GameState, PlayerAction, SeatSetup } from "../engine/types";
import { VARIANTS } from "../engine/variants";
import type { RoomSettings } from "../net/protocol";
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

/** Your seat id in a solo game. In multiplayer, `myId` in the store. */
export const HUMAN_ID = "you";

export type Screen = "menu" | "setup" | "howto" | "stats" | "multiplayer" | "table";

/** solo: you vs bots. host: this computer runs a multiplayer game. client: you joined someone's game. */
export type Mode = "solo" | "host" | "client";

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
/** A disconnected player's turn is taken (check, else fold) after this. */
const AWAY_ACT_MS = 1200;
/** Multiplayer always deals the next hand automatically, so the host can't stall the table. */
const MULTIPLAYER_DEAL_MS = 6000;

interface Store {
  screen: Screen;
  settings: Settings;
  setup: TableSetup;
  game: GameState | null;
  session: SessionStats;
  lifetime: PlayerStats;
  /** The coach's advice for the current decision, if any (set by the UI's analysis hook). */
  currentAdvice: Advice | null;
  mode: Mode;
  /** Your seat id: HUMAN_ID in solo games. */
  myId: string;
  /** Multiplayer room settings (null in solo games). */
  room: RoomSettings | null;
  /** Seats whose player is disconnected. */
  away: string[];
  /** When the current player's turn timer runs out (epoch ms), if there is one. */
  turnEndsAt: number | null;

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

  /** Host: start a multiplayer game with these seats (yours is `myId`). */
  startHosted(seats: SeatSetup[], room: RoomSettings, myId: string): void;
  /** Host: a remote player's action. Returns an error message, or null if it was applied. */
  remoteAct(seatId: string, handNumber: number, action: PlayerAction): string | null;
  /** Host: mark which players are disconnected. */
  setAway(ids: string[]): void;
  /** Player: show the table the host sent. */
  receiveView(view: GameState, turnMsLeft: number | null, away: string[], room: RoomSettings, myId: string): void;
}

/** How the store talks to the multiplayer session that owns the connection. */
interface NetHooks {
  /** Player: send your action to the host. */
  sendAction?(handNumber: number, action: PlayerAction): void;
  /** Leaving the table: close the room or the connection. */
  onLeave?(): void;
}
let netHooks: NetHooks = {};
export function setNetHooks(hooks: NetHooks): void {
  netHooks = hooks;
}

let rng: Rng = createRng(randomSeed());
let botTimer: ReturnType<typeof setTimeout> | null = null;
let dealTimer: ReturnType<typeof setTimeout> | null = null;
/** The decision the turn timer is running for, so re-arming it keeps the same deadline. */
let turnDeadline: { key: string; at: number } | null = null;
/** Player: the decision we already sent an action for (ignore double clicks). */
let sentFor: string | null = null;

function clearTimers() {
  if (botTimer) clearTimeout(botTimer);
  if (dealTimer) clearTimeout(dealTimer);
  botTimer = dealTimer = null;
}

/** Identifies one decision: a new action or hand changes it. */
const decisionKey = (game: GameState) => `${game.handNumber}:${game.history.length}`;

/** What a timed-out or disconnected player does: check if free, otherwise fold. */
export function autoAction(game: GameState): PlayerAction {
  return legalActions(game)?.canCheck ? { type: "check" } : { type: "fold" };
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
  /** Adds a finished hand to your session and lifetime stats. */
  function recordHand(game: GameState) {
    const { myId } = get();
    const summary = summarizeHand(game, myId);
    if (!summary) return;
    const me = game.players.find((p) => p.id === myId)!;
    const session = addHand(get().session, summary);
    session.stackHistory = [...session.stackHistory, me.stack];
    const lifetime = addHand(get().lifetime, summary);
    set({ session, lifetime });
    save("lifetime", lifetime);
  }

  /** Multiplayer: start (or keep) the acting player's clock. */
  function armTurn(game: GameState) {
    const { mode, room, away, myId } = get();
    const actor = game.players[game.toAct];
    const isAway = mode === "host" && actor.id !== myId && away.includes(actor.id);
    const limit = room && room.turnSeconds > 0 ? room.turnSeconds * 1000 : null;
    if (mode !== "host" || (!isAway && limit === null)) {
      turnDeadline = null;
      set({ turnEndsAt: null });
      return;
    }
    const key = decisionKey(game);
    if (!turnDeadline || turnDeadline.key !== key) turnDeadline = limit === null ? null : { key, at: Date.now() + limit };
    const deadline = turnDeadline?.at ?? null;
    set({ turnEndsAt: deadline });
    const wait = isAway ? Math.min(AWAY_ACT_MS, deadline === null ? AWAY_ACT_MS : deadline - Date.now()) : deadline! - Date.now();
    botTimer = setTimeout(() => {
      const current = get().game;
      if (current !== game) return;
      step(applyAction(current, autoAction(current)));
    }, Math.max(0, wait));
  }

  /** After every state change: schedule the next bot action or record a finished hand. */
  function step(game: GameState) {
    clearTimers();
    // Let the cards and chips finish moving before anyone acts again.
    const animationMs = get().settings.reduceMotion ? 0 : buildTimeline(get().game, game, get().myId).duration * 1000;
    set({ game });
    const { mode, myId } = get();
    if (game.phase === "betting") {
      const actor = game.players[game.toAct];
      if (actor.isHuman) return armTurn(game);
      turnDeadline = null;
      const me = game.players.find((p) => p.id === myId)!;
      // Speed things up once you're out of the hand.
      const factor = SPEED_FACTOR[get().settings.botSpeed] * (me.folded || me.busted ? 0.4 : 1);
      set({ turnEndsAt: null });
      botTimer = setTimeout(() => {
        const current = get().game;
        if (current !== game) return;
        step(applyAction(current, botDecision(current, rng)));
      }, animationMs + botThinkTime(rng) * factor);
      return;
    }
    turnDeadline = null;
    set({ turnEndsAt: null });
    if (game.phase === "complete") {
      recordHand(game);
      if (mode === "host" && canDeal(game, mode, myId)) dealTimer = setTimeout(() => get().dealNextHand(), animationMs + MULTIPLAYER_DEAL_MS);
      else if (get().settings.autoDeal && canDeal(game, mode, myId)) dealTimer = setTimeout(() => get().dealNextHand(), animationMs + 3500);
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
    mode: "solo",
    myId: HUMAN_ID,
    room: null,
    away: [],
    turnEndsAt: null,

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
      set({
        screen: "table",
        session: emptySession(setup.startingStack),
        currentAdvice: null,
        mode: "solo",
        myId: HUMAN_ID,
        room: null,
        away: [],
      });
      step(startHand(game, rng));
    },

    leaveTable() {
      clearTimers();
      turnDeadline = null;
      sentFor = null;
      const leave = netHooks.onLeave;
      set({ screen: "menu", game: null, currentAdvice: null, mode: "solo", myId: HUMAN_ID, room: null, away: [], turnEndsAt: null });
      leave?.();
    },

    dealNextHand() {
      const { game, mode, myId } = get();
      if (!game || mode === "client" || !canDeal(game, mode, myId)) return;
      set({ currentAdvice: null });
      step(startHand(game, rng));
    },

    rebuy() {
      const { game, mode, myId } = get();
      if (!game || game.phase === "betting" || mode === "client") return;
      const next = structuredClone(game);
      const human = next.players.find((p) => p.id === myId)!;
      // Refill everyone who is out of chips (you and the bots) so the table stays lively.
      for (const p of next.players) if (p.stack === 0) p.stack = next.config.startingStack;
      const session = { ...get().session, stackHistory: [...get().session.stackHistory, human.stack] };
      set({ session, currentAdvice: null });
      step(startHand(next, rng));
    },

    humanAct(action) {
      const { game, currentAdvice, mode, myId } = get();
      if (!game || game.phase !== "betting" || game.players[game.toAct].id !== myId) return;
      if (mode === "client") {
        // The host applies it and sends the new table back; don't send twice for one decision.
        if (sentFor === decisionKey(game)) return;
        sentFor = decisionKey(game);
      }
      const assist = effectiveAssist(get());
      if (currentAdvice && (assist === "coach" || assist === "guided")) {
        const agreed = sameKind(action.type, currentAdvice.action);
        set({ session: addCoachDecision(get().session, agreed), lifetime: addCoachDecision(get().lifetime, agreed) });
      }
      set({ currentAdvice: null });
      if (mode === "client") netHooks.sendAction?.(game.handNumber, action);
      else step(applyAction(game, action));
    },

    setAdvice(advice) {
      set({ currentAdvice: advice });
    },

    resetLifetime() {
      const lifetime = emptyStats();
      set({ lifetime });
      save("lifetime", lifetime);
    },

    startHosted(seats, room, myId) {
      clearTimers();
      turnDeadline = null;
      rng = createRng(randomSeed());
      const config = { variantId: "holdem", smallBlind: room.smallBlind, bigBlind: room.bigBlind, startingStack: room.startingStack };
      const game = createGame(config, seats);
      game.dealer = Math.floor(rng() * game.players.length);
      set({ screen: "table", session: emptySession(room.startingStack), currentAdvice: null, mode: "host", myId, room, away: [] });
      step(startHand(game, rng));
    },

    remoteAct(seatId, handNumber, action) {
      const { game, mode } = get();
      if (mode !== "host" || !game || game.phase !== "betting" || game.handNumber !== handNumber || game.players[game.toAct].id !== seatId) {
        return "It isn't your turn.";
      }
      let next: GameState;
      try {
        next = applyAction(game, action);
      } catch (e) {
        return e instanceof Error ? e.message : "That move isn't allowed.";
      }
      step(next);
      return null;
    },

    setAway(ids) {
      const { game, away } = get();
      if (ids.length === away.length && ids.every((id) => away.includes(id))) return;
      set({ away: ids });
      // Re-arm the clock: a player who just dropped acts sooner; one who came back gets their time.
      if (game?.phase === "betting" && game.players[game.toAct].isHuman) {
        clearTimers();
        armTurn(game);
      }
    },

    receiveView(view, turnMsLeft, away, room, myId) {
      const prev = get().game;
      if (get().mode !== "client" || get().myId !== myId) {
        clearTimers();
        sentFor = null;
        set({ mode: "client", myId, session: emptySession(room.startingStack), currentAdvice: null });
      }
      const newDecision = !prev || decisionKey(prev) !== decisionKey(view);
      if (newDecision) sentFor = null;
      set({
        game: view,
        away,
        room,
        screen: "table",
        turnEndsAt: turnMsLeft === null ? null : Date.now() + turnMsLeft,
        ...(newDecision ? { currentAdvice: null } : {}),
      });
      const finished = view.phase === "complete" && (!prev || prev.handNumber !== view.handNumber || prev.phase !== "complete");
      if (finished) recordHand(view);
    },
  };
});

/** The assist level in effect: a multiplayer room can turn helpers off for everyone. */
export function effectiveAssist(s: Pick<Store, "settings" | "mode" | "room">): AssistLevel {
  return s.mode !== "solo" && s.room && !s.room.helpers ? "off" : s.settings.assist;
}

/** Bet and raise are the same decision; so are check and call when nothing is owed. */
const sameKind = (a: string, b: string) => {
  const norm = (t: string) => (t === "bet" ? "raise" : t);
  return norm(a) === norm(b);
};

/**
 * Solo: a new hand can start if you still have chips and at least one bot does.
 * Multiplayer: whenever two players have chips (a busted host keeps dealing for the others).
 */
export function canDeal(game: GameState, mode: Mode = "solo", myId = HUMAN_ID): boolean {
  if (game.phase === "betting") return false;
  if (mode !== "solo") return playersWithChips(game) >= 2;
  const human = game.players.find((p) => p.id === myId)!;
  return human.stack > 0 && game.players.some((p) => !p.isHuman && p.stack > 0);
}
