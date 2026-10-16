// Joining someone else's room: connect, introduce yourself, then show whatever
// table view the host sends and pass your actions back.

import { create } from "zustand";
import { load, save } from "../stats/storage";
import { setNetHooks, useGameStore } from "../store/gameStore";
import { type ClientMessage, type LobbySeat, PROTOCOL_VERSION, type RejectReason, type RoomSettings } from "./protocol";
import { type ClientEvent, type ClientTransport, describeNetError, type FoundRoom, tauriClient } from "./transport";
import { parseHostMessage, sanitizeName } from "./validate";

export type ClientStatus = "idle" | "connecting" | "lobby" | "playing" | "ended";
/** Why a game ended: the host left, you were removed, or the connection dropped. */
export type EndReason = "hostClosed" | "kicked" | "lost";

interface JoinPrefs {
  name: string;
  address: string;
}

interface ClientStore {
  status: ClientStatus;
  prefs: JoinPrefs;
  rooms: FoundRoom[];
  discovering: boolean;
  seatId: string | null;
  room: RoomSettings | null;
  seats: LobbySeat[];
  error: string | null;
  /** A short-lived message from the host (e.g. an illegal move). */
  notice: string | null;
  endReason: EndReason | null;

  updatePrefs(patch: Partial<JoinPrefs>): void;
  discover(): Promise<void>;
  join(address: string, code: string): Promise<void>;
  /** Rejoin the same room and seat after the connection dropped. */
  reconnect(): Promise<void>;
  leave(): void;
}

const REJECT_TEXT: Record<RejectReason, string> = {
  full: "That room is full.",
  started: "That game has already started.",
  locked: "The host has locked the room.",
  version: "You and the host have different versions of the game. Both of you should update.",
  badName: "Pick a different name.",
};

let transport: ClientTransport = tauriClient;
/** Tests use an in-memory transport. */
export function setClientTransport(t: ClientTransport): void {
  transport = t;
}

let unsubscribe: (() => void) | null = null;
let seq = 0;
/** Kept in memory only, so a dropped connection can reclaim the seat. */
let last: { address: string; code: string; token: string | null } | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const sendMsg = (msg: ClientMessage) => transport.send(JSON.stringify(msg));

export const useClientStore = create<ClientStore>((set, get) => {
  function end(reason: EndReason) {
    unsubscribe?.();
    unsubscribe = null;
    transport.leave();
    if (reason !== "lost" && last) last.token = null;
    set({ status: "ended", endReason: reason });
  }

  function onEvent(e: ClientEvent) {
    if (e.kind === "closed") {
      const { status } = get();
      if (status === "lobby" || status === "playing") end("lost");
      return;
    }
    const msg = parseHostMessage(e.json);
    if (!msg) return;
    switch (msg.t) {
      case "welcome":
        if (last) last.token = msg.token;
        set({ seatId: msg.seatId, room: msg.room, status: get().status === "playing" ? "playing" : "lobby", error: null });
        return;
      case "lobby":
        set({ seats: msg.seats, room: msg.room });
        return;
      case "state": {
        const { seatId } = get();
        if (!seatId) return;
        set({ status: "playing", room: msg.room });
        useGameStore.getState().receiveView(msg.view, msg.turnMsLeft, msg.away, msg.room, seatId);
        return;
      }
      case "error":
        if (noticeTimer) clearTimeout(noticeTimer);
        set({ notice: msg.msg });
        noticeTimer = setTimeout(() => set({ notice: null }), 4000);
        return;
      case "rejected":
        unsubscribe?.();
        unsubscribe = null;
        transport.leave();
        set({ status: "idle", error: REJECT_TEXT[msg.reason] });
        return;
      case "kicked":
        return end("kicked");
      case "closed":
        return end("hostClosed");
    }
  }

  async function connect(address: string, code: string, token: string | null) {
    const name = sanitizeName(get().prefs.name);
    if (!name) {
      set({ error: "Type a name first." });
      return;
    }
    unsubscribe?.();
    unsubscribe = transport.onEvent(onEvent);
    set({ status: "connecting", error: null, endReason: null });
    try {
      await transport.join(address, code);
    } catch (e) {
      unsubscribe?.();
      unsubscribe = null;
      set({ status: "idle", error: describeNetError(e) });
      return;
    }
    last = { address, code, token };
    seq = 0;
    setNetHooks({
      sendAction(handNumber, action) {
        sendMsg({ t: "action", handNumber, seq: ++seq, action });
      },
      onLeave: () => get().leave(),
    });
    sendMsg(token ? { t: "hello", v: PROTOCOL_VERSION, name, token } : { t: "hello", v: PROTOCOL_VERSION, name });
  }

  return {
    status: "idle",
    prefs: load("joinPrefs", { name: "", address: "" }),
    rooms: [],
    discovering: false,
    seatId: null,
    room: null,
    seats: [],
    error: null,
    notice: null,
    endReason: null,

    updatePrefs(patch) {
      const prefs = { ...get().prefs, ...patch };
      set({ prefs });
      save("joinPrefs", prefs);
    },

    async discover() {
      set({ discovering: true });
      try {
        set({ rooms: await transport.discover() });
      } catch {
        set({ rooms: [] });
      } finally {
        set({ discovering: false });
      }
    },

    async join(address, code) {
      if (get().status === "connecting") return;
      last = null;
      set({ seatId: null, seats: [], room: null });
      await connect(address, code, null);
    },

    async reconnect() {
      if (!last?.token || get().status === "connecting") return;
      await connect(last.address, last.code, last.token);
    },

    leave() {
      const { status } = get();
      if (status === "lobby" || status === "playing") sendMsg({ t: "leave" });
      unsubscribe?.();
      unsubscribe = null;
      transport.leave();
      last = null;
      setNetHooks({});
      set({ status: "idle", seatId: null, seats: [], room: null, endReason: null, notice: null });
      if (useGameStore.getState().mode === "client") useGameStore.getState().leaveTable();
    },
  };
});

/** True if the last game can be rejoined (the connection dropped, nobody ended it). */
export const canReconnect = () => !!last?.token;
