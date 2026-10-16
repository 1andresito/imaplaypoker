// The bridge to the Rust networking layer (src-tauri/src/net). Sockets, crypto
// and rate limits live there; this file only invokes commands and listens for
// events. Tests swap in in-memory transports.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface HostInfo {
  code: string;
  port: number;
  lanIps: string[];
}

export type HostEvent =
  | { kind: "joined"; connId: number; ip: string }
  | { kind: "message"; connId: number; json: string }
  | { kind: "left"; connId: number; reason: string }
  | { kind: "alert"; alert: "guessing" };

export type ClientEvent = { kind: "message"; json: string } | { kind: "closed"; reason: string };

export interface FoundRoom {
  name: string;
  seats: number;
  max: number;
  address: string;
}

export interface HostTransport {
  open(port: number, roomName: string): Promise<HostInfo>;
  send(connId: number, json: string): void;
  kick(connId: number): void;
  setStatus(capacity: number, seatsUsed: number, open: boolean): void;
  regenerateCode(): Promise<string | null>;
  close(): void;
  /** Returns an unsubscribe function. */
  onEvent(cb: (e: HostEvent) => void): () => void;
}

export interface ClientTransport {
  join(address: string, code: string): Promise<void>;
  send(json: string): void;
  leave(): void;
  discover(): Promise<FoundRoom[]>;
  onEvent(cb: (e: ClientEvent) => void): () => void;
}

/** Errors from Rust come back as short codes; turn them into something readable. */
export function describeNetError(e: unknown): string {
  const code = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  const messages: Record<string, string> = {
    wrongCode: "That room code isn't right. Check it with the host.",
    badCode: "Room codes are 8 letters and numbers, like K7QM-2XPA.",
    badAddress: "That address doesn't look right. Use the host's IP, like 192.168.1.20.",
    unreachable: "Couldn't reach the host. Check the address, and that their firewall or router lets the game through.",
    timeout: "The host didn't answer in time.",
    refused: "The host refused the connection.",
    full: "That room is full.",
    paused: "The host's room isn't accepting players right now.",
    portInUse: "That port is already in use. Pick another one.",
    portDenied: "That port isn't allowed. Use a number from 1024 to 65535.",
    bindFailed: "Couldn't open the room on this computer.",
  };
  return messages[code] ?? "Something went wrong with the connection.";
}

/** Tauri delivers events asynchronously; keep the unsubscribe usable right away. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void listen<T>(event, (e) => cb(e.payload)).then((un) => {
    if (cancelled) un();
    else stop = un;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

export const tauriHost: HostTransport = {
  open: (port, roomName) => invoke<HostInfo>("host_open", { port, roomName }),
  send: (connId, json) => void invoke("host_send", { connId, json }),
  kick: (connId) => void invoke("host_kick", { connId }),
  setStatus: (capacity, seatsUsed, open) => void invoke("host_set_status", { capacity, seatsUsed, open }),
  regenerateCode: () => invoke<string | null>("host_regenerate_code"),
  close: () => void invoke("host_close"),
  onEvent: (cb) => subscribe<HostEvent>("net-host", cb),
};

export const tauriClient: ClientTransport = {
  join: (address, code) => invoke("client_join", { address, code }),
  send: (json) => void invoke("client_send", { json }),
  leave: () => void invoke("client_leave"),
  discover: () => invoke<FoundRoom[]>("discover_rooms"),
  onEvent: (cb) => subscribe<ClientEvent>("net-client", cb),
};
