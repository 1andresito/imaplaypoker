// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { createRng } from "../../engine/cards";
import { createGame, startHand } from "../../engine/gameState";
import { setClientTransport, useClientStore } from "../../net/clientSession";
import { setHostTransport, useHostStore } from "../../net/hostSession";
import type { ClientEvent, ClientTransport, HostEvent, HostTransport } from "../../net/transport";
import { viewFor } from "../../net/view";
import { useGameStore } from "../../store/gameStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let hostCb: ((e: HostEvent) => void) | null = null;
let clientCb: ((e: ClientEvent) => void) | null = null;

const hostNet: HostTransport = {
  open: async () => ({ code: "K7QM2XPA", port: 47820, lanIps: ["192.168.1.2"] }),
  send: () => {},
  kick: () => {},
  setStatus: () => {},
  regenerateCode: async () => "ZZZZ9999",
  close: () => {},
  onEvent: (cb) => ((hostCb = cb), () => (hostCb = null)),
};
const clientNet: ClientTransport = {
  join: async () => {},
  send: () => {},
  leave: () => {},
  discover: async () => [{ name: "Kitchen", seats: 3, max: 8, address: "192.168.1.9:47820" }],
  onEvent: (cb) => ((clientCb = cb), () => (clientCb = null)),
};
const room = { name: "Kitchen", smallBlind: 10, bigBlind: 20, startingStack: 1000, turnSeconds: 30, helpers: false };
const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;

beforeEach(() => {
  setHostTransport(hostNet);
  setClientTransport(clientNet);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useHostStore.getState().close();
  useClientStore.getState().leave();
  useGameStore.getState().leaveTable();
  vi.useRealTimers();
});

describe("multiplayer UI", () => {
  it("opens a room, shows the code and seats, and starts", async () => {
    act(() => root.render(<App />));
    act(() => useGameStore.getState().goTo("multiplayer"));
    expect(text()).toContain("Host a game");
    await act(async () => button("Open room").click());
    expect(text()).toContain("K7QM-2XPA");
    expect(text()).toContain("192.168.1.2:47820");

    act(() => {
      hostCb!({ kind: "joined", connId: 1, ip: "192.168.1.5" });
      hostCb!({ kind: "message", connId: 1, json: JSON.stringify({ t: "hello", v: 1, name: "Bo" }) });
    });
    expect(text()).toContain("Bo");
    expect(text()).toMatch(/Seats\s*2\/8/);
    act(() => (container.querySelector('[aria-label="More bots"]') as HTMLButtonElement).click());
    expect(text()).toMatch(/Seats\s*3\/8/);

    vi.useFakeTimers();
    act(() => button("Start game").click());
    expect(container.querySelector(".felt")).not.toBeNull();
    expect(container.querySelectorAll(".seat")).toHaveLength(3);
    expect(text()).toContain("Room code");
  });

  it("joins a room and shows the host's table with hidden cards", async () => {
    act(() => root.render(<App />));
    act(() => useGameStore.getState().goTo("multiplayer"));
    act(() => button("Join a game").click());
    await act(async () => {});
    expect(text()).toContain("Kitchen");
    act(() => useClientStore.getState().updatePrefs({ name: "Bo", address: "192.168.1.9:47820" }));
    const code = container.querySelector('[aria-label="Room code"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(code, "k7qm-2xpa");
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (container.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    act(() => clientCb!({ kind: "message", json: JSON.stringify({ t: "welcome", seatId: "b", token: "a".repeat(32), room }) }));
    expect(text()).toContain("Waiting for the host");

    const game = startHand(
      createGame({ variantId: "holdem", smallBlind: 10, bigBlind: 20, startingStack: 1000 }, [
        { id: "a", name: "Ann", isHuman: true },
        { id: "b", name: "Bo", isHuman: true },
        { id: "bot0", name: "Rex", isHuman: false, botProfile: "lag" },
      ]),
      createRng(3),
    );
    act(() =>
      clientCb!({ kind: "message", json: JSON.stringify({ t: "state", view: viewFor(game, "b"), turnMsLeft: 20000, away: ["a"], room }) }),
    );
    expect(container.querySelector(".felt")).not.toBeNull();
    // Our two cards face up, the other four face down.
    // (Face-up cards also carry a back face for the flip animation, so count by label.)
    expect(container.querySelectorAll('.seat [aria-label="Face-down card"]')).toHaveLength(4);
    expect(container.querySelectorAll(".seat .card.front")).toHaveLength(2);
    expect(text()).toContain("Away");
    // Helpers are off for this room, so the assist buttons are locked.
    expect((container.querySelector(".topbar .segmented button") as HTMLButtonElement).disabled).toBe(true);

    act(() => clientCb!({ kind: "closed", reason: "closed" }));
    expect(text()).toContain("Lost the connection");
    expect(button("Reconnect")).toBeTruthy();
  });
});
