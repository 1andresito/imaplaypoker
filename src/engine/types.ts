import type { Card } from "./cards";
import type { HandResult } from "./evaluator";
import type { Street } from "./variants";

export type { Street };

export interface TableConfig {
  variantId: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
}

export interface SeatSetup {
  id: string;
  name: string;
  isHuman: boolean;
  botProfile?: string;
}

export interface PlayerState extends SeatSetup {
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  /** Chips put in during the current street. */
  streetBet: number;
  /** Chips put in during the whole hand. */
  handBet: number;
  /** Has acted since the last full raise (or since the street started). */
  hasActed: boolean;
  /** Out of chips at the start of a hand; skipped until the game is reset. */
  busted: boolean;
}

export type ActionType = "fold" | "check" | "call" | "bet" | "raise";

export interface PlayerAction {
  type: ActionType;
  /** For bet/raise: the total the player's street bet becomes ("raise to"). */
  amount?: number;
}

export type HandEvent =
  | { kind: "blind"; playerId: string; blind: "small" | "big"; amount: number }
  | {
      kind: "action";
      street: Street;
      playerId: string;
      type: ActionType;
      /** Chips added to the pot by this action. */
      amount: number;
      /** The player's street bet after the action. */
      to: number;
      allIn: boolean;
      /** Pot size (all bets) just before the action — used for pot-odds stats. */
      potBefore: number;
      /** Amount the player had to call before acting. */
      toCall: number;
    }
  | { kind: "deal"; street: Street; cards: Card[] }
  | { kind: "refund"; playerId: string; amount: number }
  | { kind: "win"; playerId: string; amount: number; potIndex: number; handName?: string };

export interface PotResult {
  amount: number;
  eligible: string[];
  winners: string[];
  /** Winning hand description, when the pot went to showdown. */
  handName?: string;
}

export interface HandOutcome {
  pots: PotResult[];
  /** Net chips each player received from the pots. */
  payouts: Record<string, number>;
  /** True if two or more players reached showdown. */
  showdown: boolean;
  /** Best hands of every player who showed down. */
  hands: Record<string, HandResult>;
}

export type Phase = "idle" | "betting" | "complete";

export interface GameState {
  config: TableConfig;
  players: PlayerState[];
  /** Seat index of the dealer button. */
  dealer: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  handNumber: number;
  phase: Phase;
  street: Street;
  deck: Card[];
  board: Card[];
  /** Seat index whose turn it is, or -1. */
  toAct: number;
  /** Highest street bet that must be matched. */
  currentBet: number;
  /** Size of the last full bet/raise; a new raise must be at least this much more. */
  lastRaiseSize: number;
  history: HandEvent[];
  outcome: HandOutcome | null;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (capped at the player's stack). */
  toCall: number;
  canRaise: boolean;
  /** "bet" when nobody has bet this street, otherwise "raise". */
  raiseType: "bet" | "raise";
  minRaiseTo: number;
  maxRaiseTo: number;
}
