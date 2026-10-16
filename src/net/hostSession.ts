// Hosting a multiplayer room. The game itself runs in the game store on this
// computer; this module decides who sits where, checks every message from
// players, and sends each player a view of the table with other players'
// cards hidden.

import { create } from "zustand";
import { BOT_NAMES, BOT_PROFILES } from "../ai/profiles";
import { createRng, randomSeed, shuffle } from "../engine/cards";
import type { SeatSetup } from "../engine/types";
import { bool, load, oneOf, save } from "../stats/storage";
import { BIG_BLINDS, setNetHooks, STACK_DEPTHS, useGameStore } from "../store/gameStore";
import {
  type ClientMessage,
  DEFAULT_PORT,
  type HostMessage,
  type LobbySeat,
  MAX_SEATS,
  PROTOCOL_VERSION,
  type RejectReason,
  type RoomSettings,
  TURN_TIMES,
} from "./protocol";
import { describeNetError, type HostEvent, type HostInfo, type HostTransport, tauriHost } from "./transport";
import { parseClientMessage, sanitizeName } from "./validate";
import { viewFor } from "./view";

export const HOST_SEAT = "p0";
/** A connection that hasn't introduced itself by then is dropped. */
const HELLO_TIMEOUT_MS = 10_000;
/** Malformed or out-of-place messages tolerated before a player is disconnected. */
const MAX_STRIKES = 5;

export interface HostSetup {
  hostName: string;
  port: number;
  room: RoomSettings;
  bots: number;
  /** "mixed" or a profile id. */
  botStyle: string;
}

export interface Member {
  seatId: string;
  name: string;
  /** Secret that lets this player reclaim the seat after a disconnect. */
  token: string;
  /** Current connection, or null while disconnected. */
  connId: number | null;
  /** Highest action sequence number seen (stops replays). */
  lastSeq: number;
}

export type HostStatus = "idle" | "opening" | "lobby" | "playing";

interface HostStore {
  status: HostStatus;
  info: HostInfo | null;
  setup: HostSetup;
  members: Member[];
  /** No new players (reconnects still work). */
  locked: boolean;
  /** Someone is guessing the code; joins are paused until it's changed. */
  alert: boolean;
  error: string | null;

  updateSetup(patch: Partial<HostSetup>): void;
  updateRoom(patch: Partial<RoomSettings>): void;
  setBots(n: number): void;
  open(): Promise<void>;
  close(): void;
  kick(seatId: string): void;
  setLocked(locked: boolean): void;
  regenerateCode(): Promise<void>;
  start(): void;
}

const DEFAULT_SETUP: HostSetup = {
  hostName: "Host",
  port: DEFAULT_PORT,
  room: { name: "Poker night", smallBlind: 10, bigBlind: 20, startingStack: 2000, turnSeconds: 30, helpers: true },
  bots: 0,
  botStyle: "mixed",
};

const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.slice(0, max) : fallback);

/** Saved setup is untrusted (old versions, hand edits): keep only values the lobby offers. */
export function sanitizeHostSetup(s: HostSetup, d: HostSetup): HostSetup {
  const r = (typeof s.room === "object" && s.room !== null ? s.room : d.room) as Partial<RoomSettings>;
  const bigBlind = oneOf(r.bigBlind, BIG_BLINDS, d.room.bigBlind);
  const depth = oneOf((r.startingStack ?? 0) / bigBlind, STACK_DEPTHS, d.room.startingStack / d.room.bigBlind);
  return {
    hostName: str(s.hostName, 16, d.hostName),
    port: Number.isInteger(s.port) && s.port >= 1024 && s.port <= 65535 ? s.port : d.port,
    room: {
      name: str(r.name, 24, d.room.name),
      bigBlind,
      smallBlind: bigBlind / 2,
      startingStack: depth * bigBlind,
      turnSeconds: oneOf(r.turnSeconds, TURN_TIMES, d.room.turnSeconds),
      helpers: bool(r.helpers, d.room.helpers),
    },
    bots: Number.isInteger(s.bots) ? Math.min(MAX_SEATS - 1, Math.max(0, s.bots)) : d.bots,
    botStyle: oneOf(s.botStyle, ["mixed", ...Object.keys(BOT_PROFILES)], d.botStyle),
  };
}

let transport: HostTransport = tauriHost;
/** Tests use an in-memory transport. */
export function setHostTransport(t: HostTransport): void {
  transport = t;
}

interface Conn {
  seatId: string | null;
  strikes: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

let conns = new Map<number, Conn>();
/** Tokens of kicked players: they can't come back. */
let kickedTokens = new Set<string>();
let nextSeatNum = 1;
let unsubscribeNet: (() => void) | null = null;
let unsubscribeGame: (() => void) | null = null;
let broadcastQueued = false;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const send = (connId: number, msg: HostMessage) => transport.send(connId, JSON.stringify(msg));

export const useHostStore = create<HostStore>((set, get) => {
  const seatsUsed = () => 1 + get().members.length + (get().status === "playing" ? 0 : get().setup.bots);

  /** Tells the Rust layer how many connections to allow and what LAN discovery should show. */
  function syncStatus() {
    const { status, setup, locked } = get();
    if (status !== "lobby" && status !== "playing") return;
    // Mid-game only reconnects are accepted (checked here, by token), but a player whose old
    // connection hasn't timed out yet still needs a free slot to come back on.
    const capacity = status === "lobby" ? MAX_SEATS - 1 - setup.bots : MAX_SEATS - 1;
    const used = status === "lobby" ? seatsUsed() : useGameStore.getState().game?.players.length ?? seatsUsed();
    transport.setStatus(Math.max(0, capacity), used, status === "lobby" && !locked);
  }

  function lobbySeats(): LobbySeat[] {
    const { setup, members } = get();
    return [
      { id: HOST_SEAT, name: setup.hostName, kind: "host" },
      ...members.map((m): LobbySeat => ({ id: m.seatId, name: m.name, kind: "remote" })),
      ...Array.from({ length: setup.bots }, (_, i): LobbySeat => ({
        id: `bot${i}`,
        name: "Bot",
        kind: "bot",
        botProfile: setup.botStyle === "mixed" ? undefined : setup.botStyle,
      })),
    ];
  }

  function broadcastLobby() {
    const msg: HostMessage = { t: "lobby", seats: lobbySeats(), room: get().setup.room };
    for (const m of get().members) if (m.connId !== null) send(m.connId, msg);
    syncStatus();
  }

  function sendState(m: Member) {
    const g = useGameStore.getState();
    if (!g.game || m.connId === null) return;
    send(m.connId, {
      t: "state",
      view: viewFor(g.game, m.seatId),
      turnMsLeft: g.turnEndsAt === null ? null : Math.max(0, g.turnEndsAt - Date.now()),
      away: g.away,
      room: get().setup.room,
    });
  }

  /** Coalesces the several store updates one action causes into one send per player. */
  function queueBroadcast() {
    if (broadcastQueued) return;
    broadcastQueued = true;
    queueMicrotask(() => {
      broadcastQueued = false;
      if (get().status !== "playing") return;
      for (const m of get().members) sendState(m);
    });
  }

  function syncAway() {
    if (get().status !== "playing") return;
    useGameStore.getState().setAway(get().members.filter((m) => m.connId === null).map((m) => m.seatId));
  }

  function dropConn(connId: number) {
    const c = conns.get(connId);
    if (c?.helloTimer) clearTimeout(c.helloTimer);
    conns.delete(connId);
    transport.kick(connId);
  }

  function reject(connId: number, reason: RejectReason) {
    send(connId, { t: "rejected", reason });
    dropConn(connId);
  }

  function strike(connId: number) {
    const c = conns.get(connId);
    if (c && ++c.strikes >= MAX_STRIKES) dropConn(connId);
  }

  function uniqueName(name: string, taken: string[]): string {
    const lower = taken.map((t) => t.toLowerCase());
    if (!lower.includes(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${[...name].slice(0, 13).join("")} ${n}`;
      if (!lower.includes(candidate.toLowerCase())) return candidate;
    }
  }

  function handleHello(connId: number, conn: Conn, msg: Extract<ClientMessage, { t: "hello" }>) {
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.helloTimer = null;
    if (msg.v !== PROTOCOL_VERSION) return reject(connId, "version");

    if (msg.token !== undefined) {
      if (kickedTokens.has(msg.token)) {
        send(connId, { t: "kicked" });
        return dropConn(connId);
      }
      const member = get().members.find((m) => m.token === msg.token);
      if (member) {
        // Reconnecting: take the seat back (and drop a stale connection still holding it).
        if (member.connId !== null && member.connId !== connId) dropConn(member.connId);
        set({ members: get().members.map((m) => (m === member ? { ...m, connId } : m)) });
        conn.seatId = member.seatId;
        send(connId, { t: "welcome", seatId: member.seatId, token: member.token, room: get().setup.room });
        if (get().status === "playing") {
          syncAway();
          sendState(get().members.find((m) => m.seatId === member.seatId)!);
        } else broadcastLobby();
        return;
      }
    }

    if (get().status === "playing") return reject(connId, "started");
    if (get().locked) return reject(connId, "locked");
    if (seatsUsed() >= MAX_SEATS) return reject(connId, "full");
    const clean = sanitizeName(msg.name);
    if (!clean) return reject(connId, "badName");
    const name = uniqueName(clean, [get().setup.hostName, ...get().members.map((m) => m.name)]);
    const member: Member = { seatId: `p${nextSeatNum++}`, name, token: randomToken(), connId, lastSeq: 0 };
    conn.seatId = member.seatId;
    set({ members: [...get().members, member] });
    send(connId, { t: "welcome", seatId: member.seatId, token: member.token, room: get().setup.room });
    broadcastLobby();
  }

  function handleMessage(connId: number, json: string) {
    const conn = conns.get(connId);
    if (!conn) return;
    const msg = parseClientMessage(json);
    if (!msg) return strike(connId);
    if (conn.seatId === null) return msg.t === "hello" ? handleHello(connId, conn, msg) : strike(connId);

    const member = get().members.find((m) => m.seatId === conn.seatId && m.connId === connId);
    if (!member) return dropConn(connId);
    switch (msg.t) {
      case "hello":
        return strike(connId);
      case "action": {
        if (get().status !== "playing") return strike(connId);
        // Each action carries a fresh sequence number, so a replayed message is ignored.
        if (msg.seq <= member.lastSeq) return;
        member.lastSeq = msg.seq;
        const error = useGameStore.getState().remoteAct(member.seatId, msg.handNumber, msg.action);
        if (error) {
          send(connId, { t: "error", msg: error });
          sendState(member);
        }
        return;
      }
      case "leave":
        dropConn(connId);
        return handleLeft(connId);
    }
  }

  function handleLeft(connId: number) {
    const conn = conns.get(connId);
    if (conn?.helloTimer) clearTimeout(conn.helloTimer);
    conns.delete(connId);
    const member = get().members.find((m) => m.connId === connId);
    if (!member) return;
    if (get().status === "lobby") {
      set({ members: get().members.filter((m) => m !== member) });
      broadcastLobby();
    } else {
      // Mid-game the seat stays: the timer plays it (check or fold) until they reconnect.
      set({ members: get().members.map((m) => (m === member ? { ...m, connId: null } : m)) });
      syncAway();
    }
  }

  function onEvent(e: HostEvent) {
    switch (e.kind) {
      case "joined": {
        const helloTimer = setTimeout(() => dropConn(e.connId), HELLO_TIMEOUT_MS);
        conns.set(e.connId, { seatId: null, strikes: 0, helloTimer });
        return;
      }
      case "message":
        return handleMessage(e.connId, e.json);
      case "left":
        return handleLeft(e.connId);
      case "alert":
        set({ alert: true });
        return;
    }
  }

  function reset() {
    unsubscribeNet?.();
    unsubscribeGame?.();
    unsubscribeNet = unsubscribeGame = null;
    for (const c of conns.values()) if (c.helloTimer) clearTimeout(c.helloTimer);
    conns = new Map();
    kickedTokens = new Set();
    nextSeatNum = 1;
    setNetHooks({});
  }

  function buildSeats(): SeatSetup[] {
    const { setup, members } = get();
    const taken = [setup.hostName, ...members.map((m) => m.name)];
    const botNames = BOT_NAMES.filter((n) => !taken.some((t) => t.toLowerCase() === n.toLowerCase()));
    const profileIds = Object.keys(BOT_PROFILES);
    const rng = createRng(randomSeed());
    const shuffledNames = shuffle(botNames, rng);
    return [
      { id: HOST_SEAT, name: setup.hostName, isHuman: true },
      ...members.map((m) => ({ id: m.seatId, name: m.name, isHuman: true })),
      ...Array.from({ length: setup.bots }, (_, i) => ({
        id: `bot${i}`,
        name: shuffledNames[i % shuffledNames.length],
        isHuman: false,
        botProfile: setup.botStyle === "mixed" ? profileIds[Math.floor(rng() * profileIds.length)] : setup.botStyle,
      })),
    ];
  }

  return {
    status: "idle",
    info: null,
    setup: load("hostSetup", DEFAULT_SETUP, sanitizeHostSetup),
    members: [],
    locked: false,
    alert: false,
    error: null,

    updateSetup(patch) {
      const setup = { ...get().setup, ...patch };
      set({ setup });
      save("hostSetup", setup);
      if (get().status === "lobby") broadcastLobby();
    },

    updateRoom(patch) {
      if (get().status === "playing") return;
      get().updateSetup({ room: { ...get().setup.room, ...patch } });
    },

    setBots(n) {
      const max = MAX_SEATS - 1 - get().members.length;
      get().updateSetup({ bots: Math.max(0, Math.min(max, Math.round(n))) });
    },

    async open() {
      if (get().status !== "idle") return;
      reset();
      set({ status: "opening", error: null, alert: false, locked: false, members: [] });
      unsubscribeNet = transport.onEvent(onEvent);
      try {
        const { setup } = get();
        const info = await transport.open(setup.port, setup.room.name);
        if (get().status !== "opening") return transport.close();
        set({ status: "lobby", info });
        setNetHooks({ onLeave: () => get().close() });
        // Bots may need to give up seats if the saved setup had many.
        get().setBots(get().setup.bots);
        syncStatus();
      } catch (e) {
        reset();
        set({ status: "idle", error: describeNetError(e) });
      }
    },

    close() {
      if (get().status === "idle") return;
      for (const m of get().members) if (m.connId !== null) send(m.connId, { t: "closed" });
      transport.close();
      reset();
      set({ status: "idle", info: null, members: [], alert: false, locked: false });
      if (useGameStore.getState().mode === "host") useGameStore.getState().leaveTable();
    },

    kick(seatId) {
      const member = get().members.find((m) => m.seatId === seatId);
      if (!member) return;
      kickedTokens.add(member.token);
      if (member.connId !== null) {
        send(member.connId, { t: "kicked" });
        dropConn(member.connId);
      }
      if (get().status === "lobby") {
        set({ members: get().members.filter((m) => m !== member) });
        broadcastLobby();
      } else {
        set({ members: get().members.map((m) => (m === member ? { ...m, connId: null } : m)) });
        syncAway();
      }
    },

    setLocked(locked) {
      set({ locked });
      syncStatus();
    },

    async regenerateCode() {
      const code = await transport.regenerateCode();
      const { info } = get();
      if (code && info) set({ info: { ...info, code }, alert: false });
    },

    start() {
      if (get().status !== "lobby" || seatsUsed() < 2) return;
      // Late or unidentified connections can't take a seat any more.
      for (const [connId, c] of conns) if (c.seatId === null) reject(connId, "started");
      const seats = buildSeats();
      set({ status: "playing" });
      unsubscribeGame = useGameStore.subscribe((s, prev) => {
        if (s.game !== prev.game || s.away !== prev.away || s.turnEndsAt !== prev.turnEndsAt) queueBroadcast();
      });
      useGameStore.getState().startHosted(seats, get().setup.room, HOST_SEAT);
      syncStatus();
      queueBroadcast();
    },
  };
});
