// Strict checks on everything that arrives over the network. The host treats
// players as untrusted: anything that doesn't match the protocol exactly is
// dropped. Players check the host's messages too, so a broken or hostile host
// can't crash the table or corrupt saved stats.

import type { ActionType, GameState, PlayerAction } from "../engine/types";
import {
  type ClientMessage,
  type HostMessage,
  type LobbySeat,
  MAX_SEATS,
  type RejectReason,
  type RoomSettings,
} from "./protocol";

/** Client messages are tiny; the Rust layer caps frames too, this is belt and braces. */
const MAX_CLIENT_JSON = 4096;
const NAME_MAX = 16;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isArr = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
/** Exactly these keys (optional ones may be missing). */
const hasOnly = (o: Obj, required: string[], optional: string[] = []) =>
  required.every((k) => k in o) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));

function parse(raw: string, max: number): Obj | null {
  if (typeof raw !== "string" || raw.length > max) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

// Bidi overrides/isolates and zero-width characters let a name pretend to be someone else.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯﻿￹-￻]/g;

/** A display name made safe to show: printable, trimmed, 1–16 characters. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const name = [...raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim()].slice(0, NAME_MAX).join("").trim();
  return name.length > 0 ? name : null;
}

const ACTION_TYPES: readonly ActionType[] = ["fold", "check", "call", "bet", "raise"];

function parseAction(v: unknown): PlayerAction | null {
  if (!isObj(v) || !hasOnly(v, ["type"], ["amount"])) return null;
  if (!ACTION_TYPES.includes(v.type as ActionType)) return null;
  if (v.amount !== undefined && !isInt(v.amount, 0, 1e12)) return null;
  return v.amount === undefined ? { type: v.type as ActionType } : { type: v.type as ActionType, amount: v.amount as number };
}

/** Host side: a message from a player, or null if it isn't one. */
export function parseClientMessage(raw: string): ClientMessage | null {
  const o = parse(raw, MAX_CLIENT_JSON);
  if (!o) return null;
  switch (o.t) {
    case "hello":
      if (!hasOnly(o, ["t", "v", "name"], ["token"]) || !isInt(o.v, 0, 1000) || !isStr(o.name, 200)) return null;
      if (o.token !== undefined && !(isStr(o.token, 64) && /^[0-9a-f]{32}$/.test(o.token))) return null;
      return o.token === undefined ? { t: "hello", v: o.v, name: o.name } : { t: "hello", v: o.v, name: o.name, token: o.token as string };
    case "action": {
      if (!hasOnly(o, ["t", "handNumber", "seq", "action"]) || !isInt(o.handNumber, 1) || !isInt(o.seq, 1)) return null;
      const action = parseAction(o.action);
      return action ? { t: "action", handNumber: o.handNumber, seq: o.seq, action } : null;
    }
    case "leave":
      return hasOnly(o, ["t"]) ? { t: "leave" } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Host → player

const CHIP_MAX = 1e12;
const isChips = (v: unknown) => isInt(v, 0, CHIP_MAX);
/** -1 is a hidden card. */
const isCard = (v: unknown, hidden = false) => isInt(v, hidden ? -1 : 0, 51);
const isCards = (v: unknown, max: number, hidden = false) => isArr(v, max) && v.every((c) => isCard(c, hidden));
const isId = (v: unknown) => isStr(v, 32) && (v as string).length > 0;
const isName = (v: unknown) => isStr(v, 40);
const STREETS = ["preflop", "flop", "turn", "river"];

function validRoom(v: unknown): v is RoomSettings {
  return (
    isObj(v) &&
    isStr(v.name, 40) &&
    isChips(v.smallBlind) &&
    isInt(v.bigBlind, 1, CHIP_MAX) &&
    isInt(v.startingStack, 1, CHIP_MAX) &&
    isInt(v.turnSeconds, 0, 600) &&
    isBool(v.helpers)
  );
}

function validSeat(v: unknown): v is LobbySeat {
  return (
    isObj(v) &&
    isId(v.id) &&
    isName(v.name) &&
    ["host", "remote", "bot"].includes(v.kind as string) &&
    (v.botProfile === undefined || isStr(v.botProfile, 32))
  );
}

function validHand(v: unknown): boolean {
  return isObj(v) && isInt(v.category, 0, 9) && typeof v.score === "number" && isCards(v.bestFive, 5) && isArr(v.ranks, 5) && v.ranks.every((r) => isInt(r, 2, 14));
}

function validEvent(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case "blind":
      return isId(v.playerId) && (v.blind === "small" || v.blind === "big") && isChips(v.amount);
    case "action":
      return (
        STREETS.includes(v.street as string) &&
        isId(v.playerId) &&
        ACTION_TYPES.includes(v.type as ActionType) &&
        isChips(v.amount) &&
        isChips(v.to) &&
        isBool(v.allIn) &&
        isChips(v.potBefore) &&
        isChips(v.toCall)
      );
    case "deal":
      return STREETS.includes(v.street as string) && isCards(v.cards, 5);
    case "refund":
      return isId(v.playerId) && isChips(v.amount);
    case "win":
      return isId(v.playerId) && isChips(v.amount) && isInt(v.potIndex, 0, 16) && (v.handName === undefined || isStr(v.handName, 80));
    default:
      return false;
  }
}

function validOutcome(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v) || !isBool(v.showdown) || !isObj(v.payouts) || !isObj(v.hands) || !isArr(v.pots, 16)) return false;
  return (
    Object.values(v.payouts).every(isChips) &&
    Object.values(v.hands).every(validHand) &&
    v.pots.every(
      (p) =>
        isObj(p) &&
        isChips(p.amount) &&
        isArr(p.eligible, MAX_SEATS) &&
        p.eligible.every(isId) &&
        isArr(p.winners, MAX_SEATS) &&
        p.winners.length > 0 &&
        p.winners.every(isId) &&
        (p.handName === undefined || isStr(p.handName, 80)),
    )
  );
}

/** A table view from the host, checked field by field. */
export function validView(v: unknown): v is GameState {
  if (!isObj(v) || !isObj(v.config) || !isArr(v.players, MAX_SEATS) || v.players.length < 2) return false;
  const c = v.config;
  if (c.variantId !== "holdem" || !isChips(c.smallBlind) || !isInt(c.bigBlind, 1, CHIP_MAX) || !isChips(c.startingStack)) return false;
  const n = v.players.length;
  const seatIdx = (x: unknown) => isInt(x, -1, n - 1);
  const playersOk = v.players.every(
    (p) =>
      isObj(p) &&
      isId(p.id) &&
      isName(p.name) &&
      isBool(p.isHuman) &&
      (p.botProfile === undefined || isStr(p.botProfile, 32)) &&
      isChips(p.stack) &&
      isCards(p.hole, 4, true) &&
      isBool(p.folded) &&
      isBool(p.allIn) &&
      isChips(p.streetBet) &&
      isChips(p.handBet) &&
      isBool(p.hasActed) &&
      isBool(p.busted),
  );
  const ids = new Set(v.players.map((p) => (p as Obj).id));
  return (
    playersOk &&
    ids.size === n &&
    seatIdx(v.dealer) &&
    seatIdx(v.smallBlindSeat) &&
    seatIdx(v.bigBlindSeat) &&
    seatIdx(v.toAct) &&
    isInt(v.handNumber, 0) &&
    ["idle", "betting", "complete"].includes(v.phase as string) &&
    (v.phase !== "betting" || (v.toAct as number) >= 0) &&
    STREETS.includes(v.street as string) &&
    isArr(v.deck, 0) &&
    isCards(v.board, 5) &&
    isChips(v.currentBet) &&
    isChips(v.lastRaiseSize) &&
    isArr(v.history, 1000) &&
    v.history.every(validEvent) &&
    validOutcome(v.outcome)
  );
}

const REJECT_REASONS: readonly RejectReason[] = ["full", "started", "locked", "version", "badName"];
/** Views can be large; Rust caps frames at 512 KiB. */
const MAX_HOST_JSON = 512 * 1024;

/** Player side: a message from the host, or null if malformed. */
export function parseHostMessage(raw: string): HostMessage | null {
  const o = parse(raw, MAX_HOST_JSON);
  if (!o) return null;
  switch (o.t) {
    case "welcome":
      return isId(o.seatId) && isStr(o.token, 64) && validRoom(o.room) ? { t: "welcome", seatId: o.seatId as string, token: o.token, room: o.room } : null;
    case "lobby":
      return isArr(o.seats, MAX_SEATS) && o.seats.every(validSeat) && validRoom(o.room)
        ? { t: "lobby", seats: o.seats as LobbySeat[], room: o.room }
        : null;
    case "state":
      return validView(o.view) &&
        (o.turnMsLeft === null || isInt(o.turnMsLeft, 0, 600_000)) &&
        isArr(o.away, MAX_SEATS) &&
        o.away.every(isId) &&
        validRoom(o.room)
        ? { t: "state", view: o.view, turnMsLeft: o.turnMsLeft as number | null, away: o.away as string[], room: o.room }
        : null;
    case "error":
      return isStr(o.msg, 200) ? { t: "error", msg: o.msg } : null;
    case "rejected":
      return REJECT_REASONS.includes(o.reason as RejectReason) ? { t: "rejected", reason: o.reason as RejectReason } : null;
    case "kicked":
      return { t: "kicked" };
    case "closed":
      return { t: "closed" };
    default:
      return null;
  }
}
