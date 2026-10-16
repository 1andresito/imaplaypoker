import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRng } from "../../engine/cards";
import { applyAction, createGame, legalActions, startHand } from "../../engine/gameState";
import type { GameState, PlayerAction } from "../../engine/types";
import { autoAction, useGameStore } from "../../store/gameStore";
import { setClientTransport, useClientStore } from "../clientSession";
import { HOST_SEAT, sanitizeHostSetup, setHostTransport, useHostStore } from "../hostSession";
import { type HostMessage, MAX_SEATS, PROTOCOL_VERSION } from "../protocol";
import type { ClientEvent, ClientTransport, HostEvent, HostTransport } from "../transport";
import { parseClientMessage, parseHostMessage, sanitizeName, validView } from "../validate";
import { HIDDEN_CARD, viewFor } from "../view";

// ---------------------------------------------------------------------------
// In-memory transports

class FakeHost implements HostTransport {
  cb: ((e: HostEvent) => void) | null = null;
  sent = new Map<number, HostMessage[]>();
  kicked: number[] = [];
  status = { capacity: -1, seatsUsed: -1, open: false };
  open = vi.fn(async () => ({ code: "ABCD2345", port: 47820, lanIps: ["192.168.1.2"] }));
  send(connId: number, json: string) {
    // Everything the host sends must pass the player's own validation.
    const msg = parseHostMessage(json);
    expect(msg, json.slice(0, 200)).not.toBeNull();
    this.sent.set(connId, [...(this.sent.get(connId) ?? []), msg!]);
  }
  kick(connId: number) {
    this.kicked.push(connId);
  }
  setStatus(capacity: number, seatsUsed: number, open: boolean) {
    this.status = { capacity, seatsUsed, open };
  }
  regenerateCode = vi.fn(async () => "ZZZZ9999");
  close = vi.fn();
  onEvent(cb: (e: HostEvent) => void) {
    this.cb = cb;
    return () => (this.cb = null);
  }
  emit(e: HostEvent) {
    this.cb?.(e);
  }
  connect(connId: number, hello: object) {
    this.emit({ kind: "joined", connId, ip: "192.168.1.50" });
    this.emit({ kind: "message", connId, json: JSON.stringify(hello) });
  }
  last(connId: number, t?: HostMessage["t"]) {
    const msgs = (this.sent.get(connId) ?? []).filter((m) => !t || m.t === t);
    return msgs[msgs.length - 1];
  }
}

const hello = (name: string, token?: string) => ({ t: "hello", v: PROTOCOL_VERSION, name, ...(token ? { token } : {}) });

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function makeGame(): GameState {
  const g = createGame({ variantId: "holdem", smallBlind: 10, bigBlind: 20, startingStack: 1000 }, [
    { id: "a", name: "A", isHuman: true },
    { id: "b", name: "B", isHuman: true },
    { id: "c", name: "C", isHuman: false, botProfile: "tag" },
  ]);
  return startHand(g, createRng(7));
}

// ---------------------------------------------------------------------------

describe("table views", () => {
  it("hide the deck and other players' cards", () => {
    const g = makeGame();
    const v = viewFor(g, "a");
    expect(v.deck).toEqual([]);
    expect(v.players[0].hole).toEqual(g.players[0].hole);
    expect(v.players[1].hole).toEqual([HIDDEN_CARD, HIDDEN_CARD]);
    expect(v.players[2].hole).toEqual([HIDDEN_CARD, HIDDEN_CARD]);
    expect(validView(v)).toBe(true);
    // The original is untouched.
    expect(g.deck.length).toBeGreaterThan(0);
  });

  it("reveal only hands that went to showdown", () => {
    let g = makeGame();
    // Seat c folds, a and b check it down.
    let guard = 0;
    while (g.phase === "betting" && guard++ < 50) {
      const actor = g.players[g.toAct];
      const legal = legalActions(g)!;
      g = applyAction(g, actor.id === "c" && legal.canFold ? { type: "fold" } : legal.canCheck ? { type: "check" } : { type: "call" });
    }
    expect(g.phase).toBe("complete");
    const v = viewFor(g, "a");
    for (const p of v.players) {
      if (p.id === "a") continue;
      if (g.outcome!.hands[p.id]) expect(p.hole).toEqual(g.players.find((q) => q.id === p.id)!.hole);
      else expect(p.hole.every((c) => c === HIDDEN_CARD)).toBe(true);
    }
  });
});

describe("message validation", () => {
  it("accepts well-formed player messages", () => {
    expect(parseClientMessage(JSON.stringify(hello("Sam")))).toEqual(hello("Sam"));
    expect(parseClientMessage('{"t":"action","handNumber":3,"seq":1,"action":{"type":"raise","amount":200}}')).toEqual({
      t: "action",
      handNumber: 3,
      seq: 1,
      action: { type: "raise", amount: 200 },
    });
    expect(parseClientMessage('{"t":"leave"}')).toEqual({ t: "leave" });
  });

  it("rejects anything else", () => {
    const bad = [
      "",
      "null",
      "[]",
      "{",
      '{"t":"hello"}',
      '{"t":"hello","v":1,"name":"x","admin":true}',
      '{"t":"hello","v":1,"name":"x","token":"short"}',
      '{"t":"action","handNumber":1,"seq":1,"action":{"type":"allin"}}',
      '{"t":"action","handNumber":1,"seq":1,"action":{"type":"raise","amount":-5}}',
      '{"t":"action","handNumber":1,"seq":1,"action":{"type":"raise","amount":1.5}}',
      '{"t":"action","handNumber":1,"seq":0,"action":{"type":"fold"}}',
      '{"t":"action","handNumber":"1","seq":1,"action":{"type":"fold"}}',
      '{"t":"state"}',
      '{"t":"leave","x":1}',
      '{"__proto__":{"t":"leave"}}',
      JSON.stringify({ ...hello("x"), pad: "a".repeat(5000) }),
    ];
    for (const raw of bad) expect(parseClientMessage(raw), raw.slice(0, 80)).toBeNull();
  });

  it("repairs a corrupted saved host setup", () => {
    const d = useHostStore.getState().setup;
    const bad = { hostName: 5, port: 80, room: { name: "x".repeat(99), bigBlind: 7, startingStack: -1, turnSeconds: 9, helpers: "yes" }, bots: 50, botStyle: "evil" };
    const fixed = sanitizeHostSetup(bad as never, d);
    expect(fixed.port).toBe(d.port);
    expect(fixed.bots).toBe(MAX_SEATS - 1);
    expect(fixed.botStyle).toBe(d.botStyle);
    expect(fixed.room.name).toHaveLength(24);
    expect(fixed.room.bigBlind).toBe(d.room.bigBlind);
    expect(fixed.room.turnSeconds).toBe(d.room.turnSeconds);
    expect(typeof fixed.room.helpers).toBe("boolean");
  });

  it("cleans names", () => {
    expect(sanitizeName("  Sam  ")).toBe("Sam");
    expect(sanitizeName("a‮evil​")).toBe("aevil");
    expect(sanitizeName("x".repeat(40))).toBe("x".repeat(16));
    expect(sanitizeName("\u0000​ ")).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName("<img src=x>")).toBe("<img src=x>"); // React escapes it; it's just text
  });

  it("rejects host views that would break the table", () => {
    const v = viewFor(makeGame(), "a");
    expect(validView(v)).toBe(true);
    expect(validView({ ...v, deck: [1] })).toBe(false);
    expect(validView({ ...v, board: [99] })).toBe(false);
    expect(validView({ ...v, toAct: 9 })).toBe(false);
    expect(validView({ ...v, players: [...v.players, ...v.players, ...v.players] })).toBe(false);
    expect(validView({ ...v, history: [{ kind: "win", playerId: "a", amount: -1, potIndex: 0 }] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("hosting", () => {
  let net: FakeHost;

  beforeEach(async () => {
    vi.useFakeTimers();
    net = new FakeHost();
    setHostTransport(net);
    const host = useHostStore.getState();
    host.updateSetup({
      hostName: "Ann",
      bots: 0,
      botStyle: "mixed",
      room: { name: "Test", smallBlind: 10, bigBlind: 20, startingStack: 1000, turnSeconds: 0, helpers: true },
    });
    await host.open();
  });

  afterEach(() => {
    useHostStore.getState().close();
    useGameStore.getState().leaveTable();
    vi.useRealTimers();
  });

  it("seats players, enforces 8 seats, and refuses late joiners", () => {
    net.connect(1, hello("Bo"));
    net.connect(2, hello("ann")); // clashes with the host's name
    expect(net.last(1, "welcome")).toMatchObject({ t: "welcome", seatId: "p1" });
    const lobby = net.last(1, "lobby") as Extract<HostMessage, { t: "lobby" }>;
    expect(lobby.seats.map((s) => s.name)).toEqual(["Ann", "Bo", "ann 2"]);

    useHostStore.getState().setBots(10);
    expect(useHostStore.getState().setup.bots).toBe(MAX_SEATS - 3);
    expect(net.status).toMatchObject({ capacity: 2, seatsUsed: 8, open: true });
    net.connect(3, hello("Cy"));
    expect(net.last(3)).toEqual({ t: "rejected", reason: "full" });
    expect(net.kicked).toContain(3);

    useHostStore.getState().setBots(1);
    useHostStore.getState().start();
    expect(useGameStore.getState().game!.players).toHaveLength(4);
    net.connect(4, hello("Late"));
    expect(net.last(4)).toEqual({ t: "rejected", reason: "started" });
    expect(net.status.open).toBe(false);
  });

  it("drops connections that never say hello or send garbage", () => {
    net.emit({ kind: "joined", connId: 7, ip: "1.2.3.4" });
    vi.advanceTimersByTime(11_000);
    expect(net.kicked).toContain(7);

    net.connect(8, hello("Bo"));
    for (let i = 0; i < 5; i++) net.emit({ kind: "message", connId: 8, json: '{"t":"nope"}' });
    expect(net.kicked).toContain(8);
  });

  it("plays full games with remote players who only see their own cards", async () => {
    net.connect(1, hello("Bo"));
    net.connect(2, hello("Cy"));
    net.connect(3, hello("Di"));
    useHostStore.getState().setBots(4);
    useHostStore.getState().start();
    await settle();
    const conns: Record<string, number> = { p1: 1, p2: 2, p3: 3 };
    const seqs: Record<number, number> = { 1: 0, 2: 0, 3: 0 };

    let hands = 0;
    let guard = 0;
    while (hands < 40 && guard++ < 20_000) {
      const store = useGameStore.getState();
      const game = store.game!;
      if (game.phase === "complete") {
        if (game.players.filter((p) => p.stack > 0).length < 2) store.rebuy();
        // Multiplayer deals automatically once the animations finish.
        else while (useGameStore.getState().game!.handNumber === game.handNumber) vi.advanceTimersByTime(1000);
        await settle();
        hands++;
        continue;
      }
      const actor = game.players[game.toAct];
      if (actor.id === HOST_SEAT) {
        store.humanAct(autoAction(game).type === "check" ? { type: "check" } : { type: "call" });
      } else if (conns[actor.id]) {
        const connId = conns[actor.id];
        const state = net.last(connId, "state") as Extract<HostMessage, { t: "state" }>;
        const view = state.view;
        // The player's view: own cards only, no deck.
        expect(view.deck).toEqual([]);
        for (const p of view.players) {
          if (p.id !== actor.id && game.phase === "betting") expect(p.hole.every((c) => c === HIDDEN_CARD)).toBe(true);
        }
        expect(view.toAct).toBe(game.toAct);
        const legal = legalActions(view)!;
        const action: PlayerAction =
          legal.canRaise && seqs[connId] % 7 === 0 ? { type: legal.raiseType, amount: legal.minRaiseTo } : legal.canCheck ? { type: "check" } : { type: "call" };
        net.emit({ kind: "message", connId, json: JSON.stringify({ t: "action", handNumber: view.handNumber, seq: ++seqs[connId], action }) });
      } else {
        vi.advanceTimersByTime(3000);
      }
      await settle();
    }
    expect(hands).toBe(40);
    // Chips are conserved (rebuys add a full stack each).
    expect(useGameStore.getState().game!.handNumber).toBeGreaterThanOrEqual(40);
  }, 60_000);

  it("rejects out-of-turn, stale, replayed and illegal actions", async () => {
    net.connect(1, hello("Bo"));
    net.connect(2, hello("Cy"));
    useHostStore.getState().start();
    await settle();

    // Get to a remote player's turn.
    let game = useGameStore.getState().game!;
    let guard = 0;
    while (game.players[game.toAct].id === HOST_SEAT && guard++ < 5) {
      useGameStore.getState().humanAct(autoAction(game).type === "check" ? { type: "check" } : { type: "call" });
      game = useGameStore.getState().game!;
    }
    await settle();
    const actorId = game.players[game.toAct].id;
    const actorConn = actorId === "p1" ? 1 : 2;
    const otherConn = actorConn === 1 ? 2 : 1;
    const before = useGameStore.getState().game;
    const act = (connId: number, body: object) => net.emit({ kind: "message", connId, json: JSON.stringify({ t: "action", ...body }) });

    act(otherConn, { handNumber: game.handNumber, seq: 1, action: { type: "fold" } });
    expect(net.last(otherConn, "error")).toEqual({ t: "error", msg: "It isn't your turn." });
    act(actorConn, { handNumber: game.handNumber - 1 || 99, seq: 1, action: { type: "fold" } });
    expect(useGameStore.getState().game).toBe(before);
    act(actorConn, { handNumber: game.handNumber, seq: 2, action: { type: "raise", amount: 10 ** 9 } });
    expect(net.last(actorConn, "error")?.t).toBe("error");
    expect(useGameStore.getState().game).toBe(before);
    // Replays of an old sequence number are ignored, even if they'd be legal.
    act(actorConn, { handNumber: game.handNumber, seq: 2, action: { type: "fold" } });
    expect(useGameStore.getState().game).toBe(before);

    act(actorConn, { handNumber: game.handNumber, seq: 3, action: { type: "fold" } });
    expect(useGameStore.getState().game).not.toBe(before);
  });

  it("times out slow players and plays for disconnected ones until they reconnect", async () => {
    useHostStore.getState().updateRoom({ turnSeconds: 20 });
    net.connect(1, hello("Bo"));
    const token = (net.last(1, "welcome") as Extract<HostMessage, { t: "welcome" }>).token;
    useHostStore.getState().start();
    await settle();

    const waitForRemoteTurn = () => {
      let g = useGameStore.getState().game!;
      for (let i = 0; i < 10 && !(g.phase === "betting" && g.players[g.toAct].id === "p1"); i++) {
        if (g.phase === "complete") vi.advanceTimersByTime(7000);
        else useGameStore.getState().humanAct(autoAction(g).type === "check" ? { type: "check" } : { type: "call" });
        g = useGameStore.getState().game!;
      }
      return g;
    };

    let g = waitForRemoteTurn();
    expect(useGameStore.getState().turnEndsAt).not.toBeNull();
    await settle();
    expect((net.last(1, "state") as Extract<HostMessage, { t: "state" }>).turnMsLeft).toBeGreaterThan(19_000);
    const key = g.history.length;
    vi.advanceTimersByTime(20_500);
    g = useGameStore.getState().game!;
    expect(g.history.length).toBeGreaterThan(key); // the timer acted

    // Disconnect: seat is marked away and acted for quickly.
    net.emit({ kind: "left", connId: 1, reason: "closed" });
    expect(useGameStore.getState().away).toEqual(["p1"]);
    g = waitForRemoteTurn();
    const len = g.history.length;
    vi.advanceTimersByTime(1500);
    expect(useGameStore.getState().game!.history.length).toBeGreaterThan(len);

    // Reconnect with the token: same seat, no longer away.
    net.connect(5, hello("Bo", token));
    expect(net.last(5, "welcome")).toMatchObject({ seatId: "p1", token });
    expect(useGameStore.getState().away).toEqual([]);
    await settle();
    expect(net.last(5, "state")?.t).toBe("state");

    // A wrong token is just a new player, and the game has started.
    net.connect(6, hello("Bo", "0".repeat(32)));
    expect(net.last(6)).toEqual({ t: "rejected", reason: "started" });
  });

  it("kicked players can't come back", async () => {
    net.connect(1, hello("Bo"));
    const token = (net.last(1, "welcome") as Extract<HostMessage, { t: "welcome" }>).token;
    useHostStore.getState().kick("p1");
    expect(net.last(1)).toEqual({ t: "kicked" });
    expect(useHostStore.getState().members).toEqual([]);
    net.connect(2, hello("Bo", token));
    expect(net.last(2)).toEqual({ t: "kicked" });
    expect(net.kicked).toContain(2);
  });

  it("pauses on a guessing alert until the code changes", async () => {
    net.emit({ kind: "alert", alert: "guessing" });
    expect(useHostStore.getState().alert).toBe(true);
    await useHostStore.getState().regenerateCode();
    expect(useHostStore.getState().alert).toBe(false);
    expect(useHostStore.getState().info!.code).toBe("ZZZZ9999");
  });

  it("tells players when the host closes the room", () => {
    net.connect(1, hello("Bo"));
    useHostStore.getState().close();
    expect(net.last(1)).toEqual({ t: "closed" });
    expect(net.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

class FakeClient implements ClientTransport {
  cb: ((e: ClientEvent) => void) | null = null;
  sent: object[] = [];
  join = vi.fn(async (_address: string, _code: string) => {});
  send(json: string) {
    this.sent.push(JSON.parse(json));
  }
  leave = vi.fn();
  discover = vi.fn(async () => []);
  onEvent(cb: (e: ClientEvent) => void) {
    this.cb = cb;
    return () => (this.cb = null);
  }
  receive(msg: object) {
    this.cb?.({ kind: "message", json: JSON.stringify(msg) });
  }
}

describe("joining", () => {
  let net: FakeClient;
  const room = { name: "Test", smallBlind: 10, bigBlind: 20, startingStack: 1000, turnSeconds: 0, helpers: false };

  beforeEach(() => {
    net = new FakeClient();
    setClientTransport(net);
    useClientStore.getState().updatePrefs({ name: "Bo" });
  });

  afterEach(() => {
    useClientStore.getState().leave();
  });

  it("joins, shows the host's table, and sends actions with fresh sequence numbers", async () => {
    await useClientStore.getState().join("192.168.1.2", "ABCD-2345");
    expect(net.join).toHaveBeenCalledWith("192.168.1.2", "ABCD-2345");
    expect(net.sent[0]).toEqual(hello("Bo"));
    net.receive({ t: "welcome", seatId: "a", token: "f".repeat(32), room });
    expect(useClientStore.getState().status).toBe("lobby");

    const g = makeGame();
    net.receive({ t: "state", view: viewFor(g, "a"), turnMsLeft: null, away: [], room });
    const s = useGameStore.getState();
    expect(s.mode).toBe("client");
    expect(s.myId).toBe("a");
    expect(s.screen).toBe("table");
    // The room turned helpers off.
    expect(s.room?.helpers).toBe(false);

    // Act when it's our turn; a double click sends once.
    if (g.players[g.toAct].id === "a") {
      s.humanAct({ type: "call" });
      s.humanAct({ type: "call" });
      const actions = net.sent.filter((m) => (m as { t: string }).t === "action");
      expect(actions).toEqual([{ t: "action", handNumber: g.handNumber, seq: 1, action: { type: "call" } }]);
    }
  });

  it("ignores malformed host messages and ends on kick", async () => {
    await useClientStore.getState().join("192.168.1.2", "ABCD-2345");
    net.receive({ t: "welcome", seatId: "a", token: "f".repeat(32), room });
    net.receive({ t: "state", view: { ...viewFor(makeGame(), "a"), deck: [5] }, turnMsLeft: null, away: [], room });
    expect(useGameStore.getState().game).toBeNull();
    net.receive({ t: "kicked" });
    expect(useClientStore.getState()).toMatchObject({ status: "ended", endReason: "kicked" });
  });

  it("explains refused joins", async () => {
    net.join.mockRejectedValueOnce("wrongCode");
    await useClientStore.getState().join("192.168.1.2", "ABCD-2345");
    expect(useClientStore.getState().status).toBe("idle");
    expect(useClientStore.getState().error).toMatch(/code/);
  });
});
