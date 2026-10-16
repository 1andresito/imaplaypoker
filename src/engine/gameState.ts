import { type Rng, fullDeck, shuffle } from "./cards";
import type { HandResult } from "./evaluator";
import { describeHand } from "./handRanks";
import { buildPots, splitPot } from "./showdown";
import type {
  GameState,
  HandOutcome,
  LegalActions,
  PlayerAction,
  PlayerState,
  SeatSetup,
  TableConfig,
} from "./types";
import { VARIANTS, type Variant } from "./variants";

export const variantOf = (state: GameState): Variant => VARIANTS[state.config.variantId];

const inHand = (p: PlayerState) => !p.busted && !p.folded;
const canAct = (p: PlayerState) => inHand(p) && !p.allIn;

/** Next seat index after `from` (exclusive, wrapping) that satisfies `pred`, or -1. */
export function nextSeat(players: readonly PlayerState[], from: number, pred: (p: PlayerState) => boolean): number {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step + n) % n;
    if (pred(players[i])) return i;
  }
  return -1;
}

export const potTotal = (state: GameState): number => state.players.reduce((sum, p) => sum + p.handBet, 0);

/** Pot from previous streets only (excludes bets in front of players this street). */
export const collectedPot = (state: GameState): number =>
  state.players.reduce((sum, p) => sum + p.handBet - p.streetBet, 0);

export function createGame(config: TableConfig, seats: readonly SeatSetup[]): GameState {
  if (seats.length < 2) throw new Error("Need at least 2 players");
  return {
    config,
    players: seats.map((s) => ({
      ...s,
      stack: config.startingStack,
      hole: [],
      folded: false,
      allIn: false,
      streetBet: 0,
      handBet: 0,
      hasActed: false,
      busted: false,
    })),
    dealer: seats.length - 1,
    smallBlindSeat: -1,
    bigBlindSeat: -1,
    handNumber: 0,
    phase: "idle",
    street: "preflop",
    deck: [],
    board: [],
    toAct: -1,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    history: [],
    outcome: null,
  };
}

/** Number of players who still have chips. */
export const playersWithChips = (state: GameState): number => state.players.filter((p) => p.stack > 0).length;

export function startHand(prev: GameState, rng: Rng): GameState {
  if (prev.phase === "betting") throw new Error("Hand already in progress");
  const state = structuredClone(prev);
  const { players, config } = state;
  const variant = variantOf(state);

  for (const p of players) {
    p.busted = p.stack <= 0;
    p.hole = [];
    p.folded = false;
    p.allIn = false;
    p.streetBet = 0;
    p.handBet = 0;
    p.hasActed = false;
  }
  const live = (p: PlayerState) => !p.busted;
  if (players.filter(live).length < 2) throw new Error("Not enough players with chips");

  state.handNumber++;
  state.phase = "betting";
  state.street = "preflop";
  state.board = [];
  state.history = [];
  state.outcome = null;
  state.deck = shuffle(fullDeck(), rng);
  state.dealer = nextSeat(players, state.dealer, live);

  const headsUp = players.filter(live).length === 2;
  // Heads-up the dealer posts the small blind and acts first before the flop.
  state.smallBlindSeat = headsUp ? state.dealer : nextSeat(players, state.dealer, live);
  state.bigBlindSeat = nextSeat(players, state.smallBlindSeat, live);

  const post = (seat: number, amount: number, blind: "small" | "big") => {
    const p = players[seat];
    const paid = Math.min(amount, p.stack);
    p.stack -= paid;
    p.streetBet += paid;
    p.handBet += paid;
    if (p.stack === 0) p.allIn = true;
    state.history.push({ kind: "blind", playerId: p.id, blind, amount: paid });
  };
  post(state.smallBlindSeat, config.smallBlind, "small");
  post(state.bigBlindSeat, config.bigBlind, "big");

  for (let round = 0; round < variant.holeCards; round++) {
    let seat = state.smallBlindSeat;
    for (let k = 0; k < players.length; k++) {
      if (live(players[seat])) players[seat].hole.push(state.deck.pop()!);
      seat = (seat + 1) % players.length;
    }
  }

  state.currentBet = config.bigBlind;
  state.lastRaiseSize = config.bigBlind;
  state.toAct = state.bigBlindSeat;
  return advance(state);
}

export function legalActions(state: GameState): LegalActions | null {
  if (state.phase !== "betting" || state.toAct < 0) return null;
  const p = state.players[state.toAct];
  const owed = Math.max(0, state.currentBet - p.streetBet);
  const toCall = Math.min(owed, p.stack);
  const maxRaiseTo = p.streetBet + p.stack;
  const othersCanAct = state.players.some((o, i) => i !== state.toAct && canAct(o));
  const fullMin = state.currentBet + state.lastRaiseSize;
  return {
    canFold: owed > 0,
    canCheck: owed === 0,
    canCall: owed > 0,
    toCall,
    // A player who already acted can only re-raise if someone made a full raise since.
    canRaise: !p.hasActed && othersCanAct && maxRaiseTo > state.currentBet,
    raiseType: state.currentBet === 0 ? "bet" : "raise",
    minRaiseTo: Math.min(fullMin, maxRaiseTo),
    maxRaiseTo,
  };
}

export function applyAction(prev: GameState, action: PlayerAction): GameState {
  const legal = legalActions(prev);
  if (!legal) throw new Error("No action expected");
  const state = structuredClone(prev);
  const seat = state.toAct;
  const p = state.players[seat];
  const potBefore = potTotal(state);
  const record = (type: PlayerAction["type"], amount: number) =>
    state.history.push({
      kind: "action",
      street: state.street,
      playerId: p.id,
      type,
      amount,
      to: p.streetBet,
      allIn: p.allIn,
      potBefore,
      toCall: legal.toCall,
    });
  const put = (amount: number) => {
    p.stack -= amount;
    p.streetBet += amount;
    p.handBet += amount;
    if (p.stack === 0) p.allIn = true;
  };

  switch (action.type) {
    case "fold":
      // Folding when you could check is legal in real poker, just never correct.
      p.folded = true;
      record("fold", 0);
      break;
    case "check":
      if (!legal.canCheck) throw new Error("Cannot check facing a bet");
      record("check", 0);
      break;
    case "call":
      if (!legal.canCall) throw new Error("Nothing to call");
      put(legal.toCall);
      record("call", legal.toCall);
      break;
    case "bet":
    case "raise": {
      if (!legal.canRaise) throw new Error("Raising is not allowed here");
      const to = Math.round(action.amount ?? legal.minRaiseTo);
      if (to > legal.maxRaiseTo) throw new Error(`Cannot bet more than your stack (${legal.maxRaiseTo})`);
      if (to < legal.minRaiseTo) throw new Error(`Minimum ${legal.raiseType} is to ${legal.minRaiseTo}`);
      const raiseSize = to - state.currentBet;
      const added = to - p.streetBet;
      put(added);
      if (raiseSize >= state.lastRaiseSize) {
        // Full raise: reopens the action for everyone else.
        state.lastRaiseSize = raiseSize;
        for (const o of state.players) if (o !== p) o.hasActed = false;
      }
      state.currentBet = to;
      record(legal.raiseType, added);
      break;
    }
  }
  p.hasActed = true;
  return advance(state);
}

/** Does this seat still need to act in the current betting round? */
function needsAction(state: GameState, p: PlayerState): boolean {
  if (!canAct(p)) return false;
  if (p.streetBet < state.currentBet) return true;
  const actors = state.players.filter(canAct).length;
  return !p.hasActed && actors >= 2;
}

/** Moves to the next player, next street, or showdown. Mutates `state` (already cloned). */
function advance(state: GameState): GameState {
  const variant = variantOf(state);
  for (;;) {
    if (state.players.filter(inHand).length === 1) return finishHand(state);

    // nextSeat wraps all the way around, so this also finds the current seat if it alone is left.
    const seat = nextSeat(state.players, state.toAct, (p) => needsAction(state, p));
    if (seat >= 0) {
      state.toAct = seat;
      return state;
    }

    // Betting round over.
    const idx = variant.streets.findIndex((s) => s.street === state.street);
    if (idx === variant.streets.length - 1) return finishHand(state);

    const nextStreet = variant.streets[idx + 1];
    state.street = nextStreet.street;
    const cards = state.deck.splice(state.deck.length - nextStreet.boardCards, nextStreet.boardCards).reverse();
    state.board.push(...cards);
    state.history.push({ kind: "deal", street: nextStreet.street, cards });
    for (const p of state.players) {
      p.streetBet = 0;
      p.hasActed = false;
    }
    state.currentBet = 0;
    state.lastRaiseSize = state.config.bigBlind;
    // Post-flop action starts left of the dealer; the dealer itself is checked last.
    state.toAct = state.dealer;
  }
}

function finishHand(state: GameState): GameState {
  const variant = variantOf(state);
  const { players } = state;

  // Return any uncalled part of the biggest bet.
  const bets = players.map((p) => p.handBet).sort((a, b) => b - a);
  const top = players.find((p) => p.handBet === bets[0])!;
  const uncalled = bets[0] - (bets[1] ?? 0);
  if (uncalled > 0) {
    top.handBet -= uncalled;
    top.streetBet = Math.max(0, top.streetBet - uncalled);
    top.stack += uncalled;
    state.history.push({ kind: "refund", playerId: top.id, amount: uncalled });
  }

  const contenders = players.filter(inHand);
  const showdown = contenders.length > 1;
  const hands: Record<string, HandResult> = {};
  if (showdown) for (const p of contenders) hands[p.id] = variant.bestHand(p.hole, state.board);

  // Seat order starting left of the dealer, for odd-chip distribution.
  const order: string[] = [];
  for (let k = 1; k <= players.length; k++) order.push(players[(state.dealer + k) % players.length].id);

  const outcome: HandOutcome = { pots: [], payouts: {}, showdown, hands };
  buildPots(players).forEach((pot, potIndex) => {
    let winners: string[];
    let shares: Record<string, number>;
    if (showdown) ({ winners, shares } = splitPot(pot, hands, order));
    else {
      winners = [contenders[0].id];
      shares = { [contenders[0].id]: pot.amount };
    }
    const handName = showdown ? describeHand(hands[winners[0]]) : undefined;
    outcome.pots.push({ amount: pot.amount, eligible: pot.eligible, winners, handName });
    for (const id of winners) {
      outcome.payouts[id] = (outcome.payouts[id] ?? 0) + shares[id];
      state.history.push({ kind: "win", playerId: id, amount: shares[id], potIndex, handName });
    }
  });

  for (const p of players) p.stack += outcome.payouts[p.id] ?? 0;
  state.outcome = outcome;
  state.phase = "complete";
  state.toAct = -1;
  return state;
}
