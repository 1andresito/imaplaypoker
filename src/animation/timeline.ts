import type { Card } from "../engine/cards";
import type { ActionType, GameState } from "../engine/types";

// What happened between two game states, as a timed sequence. The sound
// effects and the table animations both play from this, so they stay in sync,
// and the store waits for it to finish before the next bot acts.

export type TimelineEvent =
  /** Hole card number `index` flies from the dealer to `seat`. */
  | { kind: "deal"; at: number; seat: number; index: number }
  | { kind: "blinds"; at: number }
  | { kind: "action"; at: number; seat: number; type: ActionType; allIn: boolean }
  /** End of a betting round: every bet in front of a player slides into the pot. */
  | { kind: "sweep"; at: number; bets: { seat: number; amount: number }[] }
  /** A community card is turned over. */
  | { kind: "board"; at: number; card: Card }
  /** Showdown: the remaining players turn their cards over. */
  | { kind: "reveal"; at: number }
  /** Chips go from the pot to a winner. */
  | { kind: "payout"; at: number; seat: number; amount: number }
  /** The hand is over, from your point of view. */
  | { kind: "result"; at: number; outcome: "win" | "lose" | "neutral" }
  | { kind: "yourTurn"; at: number };

export interface Timeline {
  events: TimelineEvent[];
  /** Seconds until the last animation has finished. */
  duration: number;
}

// Timing, in seconds.
export const T = {
  dealGap: 0.07,
  actionGap: 0.15,
  /** Bets sliding into the pot before the next cards come out. */
  sweep: 0.3,
  flipGap: 0.14,
  resultDelay: 0.3,
  turnDelay: 0.2,
  // How long each kind of animation runs once it starts.
  cardFlight: 0.38,
  flip: 0.45,
  chipFlight: 0.4,
  payout: 0.7,
} as const;

const LENGTH: Partial<Record<TimelineEvent["kind"], number>> = {
  deal: T.cardFlight,
  action: T.chipFlight,
  sweep: T.sweep,
  board: T.flip,
  reveal: T.flip,
  payout: T.payout,
};

export const EMPTY_TIMELINE: Timeline = { events: [], duration: 0 };

export function buildTimeline(prev: GameState | null, next: GameState | null): Timeline {
  if (!next) return EMPTY_TIMELINE;
  const events: TimelineEvent[] = [];
  const seatOf = new Map(next.players.map((p, i) => [p.id, i]));
  const newHand = !prev || prev.handNumber !== next.handNumber;
  const firstNew = newHand ? 0 : prev.history.length;
  let t = 0;

  if (newHand) {
    // Same order the engine deals: one card each starting at the small blind, then the second.
    const n = next.players.length;
    const rounds = Math.max(0, ...next.players.map((p) => p.hole.length));
    let k = 0;
    for (let index = 0; index < rounds; index++) {
      for (let j = 0; j < n; j++) {
        const seat = (next.smallBlindSeat + j) % n;
        if (next.players[seat].hole.length > index) events.push({ kind: "deal", at: k++ * T.dealGap, seat, index });
      }
    }
    t = k * T.dealGap;
  }

  // Replay the whole hand to know what is in front of each player, but only
  // emit events for the part that is new.
  let bets = new Map<number, number>();
  const sweep = () => {
    const list = [...bets].filter(([, amount]) => amount > 0).map(([seat, amount]) => ({ seat, amount }));
    bets = new Map();
    return list;
  };
  let blinds = false;
  next.history.forEach((e, i) => {
    const fresh = i >= firstNew;
    switch (e.kind) {
      case "blind": {
        const seat = seatOf.get(e.playerId)!;
        bets.set(seat, (bets.get(seat) ?? 0) + e.amount);
        if (fresh && !blinds) events.push({ kind: "blinds", at: t });
        blinds = true;
        break;
      }
      case "action": {
        const seat = seatOf.get(e.playerId)!;
        bets.set(seat, (bets.get(seat) ?? 0) + e.amount);
        if (fresh) {
          events.push({ kind: "action", at: t, seat, type: e.type, allIn: e.allIn });
          t += T.actionGap;
        }
        break;
      }
      case "refund": {
        const seat = seatOf.get(e.playerId)!;
        bets.set(seat, (bets.get(seat) ?? 0) - e.amount);
        break;
      }
      case "deal": {
        const swept = sweep();
        if (!fresh) break;
        if (swept.length) events.push({ kind: "sweep", at: t, bets: swept });
        t += T.sweep;
        e.cards.forEach((card, j) => events.push({ kind: "board", at: t + j * T.flipGap, card }));
        t += e.cards.length * T.flipGap;
        break;
      }
      case "win":
        break;
    }
  });

  const human = next.players.find((p) => p.isHuman);
  if (next.phase === "complete" && prev?.phase !== "complete" && next.outcome) {
    const swept = sweep();
    if (swept.length) {
      events.push({ kind: "sweep", at: t, bets: swept });
      t += T.sweep;
    }
    if (next.outcome.showdown) {
      events.push({ kind: "reveal", at: t });
      t += T.flip;
    }
    const at = t + T.resultDelay;
    for (const [id, amount] of Object.entries(next.outcome.payouts)) {
      if (amount > 0) events.push({ kind: "payout", at, seat: seatOf.get(id)!, amount });
    }
    const won = !!human && (next.outcome.payouts[human.id] ?? 0) > 0;
    const lost = !!human && !human.folded && human.handBet > 0;
    events.push({ kind: "result", at, outcome: won ? "win" : lost ? "lose" : "neutral" });
  } else {
    const isHuman = (s: GameState) => s.phase === "betting" && !!s.players[s.toAct]?.isHuman;
    if (isHuman(next) && (newHand || !isHuman(prev!))) events.push({ kind: "yourTurn", at: t + T.turnDelay });
  }

  const duration = events.reduce((end, e) => Math.max(end, e.at + (LENGTH[e.kind] ?? 0)), 0);
  return { events, duration };
}
