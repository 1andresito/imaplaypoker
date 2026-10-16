// Messages between the host and remote players. The host runs the game; players
// only send intents and receive a view of the table made for their seat.

import type { GameState, PlayerAction } from "../engine/types";

export const PROTOCOL_VERSION = 1;
/** Seats at a multiplayer table, counting the host and bots. */
export const MAX_SEATS = 8;
export const DEFAULT_PORT = 47820;
export const TURN_TIMES = [0, 20, 30, 60] as const;

export interface RoomSettings {
  name: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  /** Seconds per decision; 0 = no timer. */
  turnSeconds: number;
  /** Whether players may use the coach, win chance and other learning helpers. */
  helpers: boolean;
}

export type SeatKind = "host" | "remote" | "bot";

export interface LobbySeat {
  id: string;
  name: string;
  kind: SeatKind;
  botProfile?: string;
}

export type ClientMessage =
  | { t: "hello"; v: number; name: string; token?: string }
  | { t: "action"; handNumber: number; seq: number; action: PlayerAction }
  | { t: "leave" };

export type RejectReason = "full" | "started" | "locked" | "version" | "badName";

export type HostMessage =
  | { t: "welcome"; seatId: string; token: string; room: RoomSettings }
  | { t: "lobby"; seats: LobbySeat[]; room: RoomSettings }
  | { t: "state"; view: GameState; turnMsLeft: number | null; away: string[]; room: RoomSettings }
  | { t: "error"; msg: string }
  | { t: "rejected"; reason: RejectReason }
  | { t: "kicked" }
  | { t: "closed" };
