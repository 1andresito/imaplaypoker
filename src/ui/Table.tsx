import { type CSSProperties, useState } from "react";
import { buildTimeline, EMPTY_TIMELINE, T, type Timeline, type TimelineEvent } from "../animation/timeline";
import { BOT_PROFILES } from "../ai/profiles";
import type { Card } from "../engine/cards";
import { collectedPot, potTotal } from "../engine/gameState";
import { categoryName } from "../engine/handRanks";
import type { GameState, HandEvent, PlayerState } from "../engine/types";
import { HUMAN_ID, useGameStore } from "../store/gameStore";
import { ChipStack, PotChips } from "./Chip";
import { STYLE_COLORS } from "./constants";
import { chips } from "./format";
import { Icon } from "./icons";
import { PlayingCard } from "./PlayingCard";
import { useCountUp } from "./useCountUp";

interface Props {
  game: GameState;
  /** Cards to highlight (your best five), when the Hand Helper is on. */
  highlight: readonly Card[];
}

const STREET_NAMES = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" } as const;

interface Point {
  x: number;
  y: number;
}
const CENTER: Point = { x: 50, y: 50 };
/** Where the pot sits on the felt (percent of the table area). */
const POT: Point = { x: 50, y: 57 };
const lerp = (a: Point, b: Point, f: number): Point => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
const pct = (p: Point) => ({ left: `${p.x}%`, top: `${p.y}%` });
/** CSS variables for an element that flies in from `from` to wherever it is placed. */
const flyFrom = (from: Point, delay = 0): CSSProperties =>
  ({ "--x0": `${from.x}%`, "--y0": `${from.y}%`, animationDelay: `${delay}s` }) as CSSProperties;

/** Seat positions around the oval: you sit at the bottom center, bots go clockwise. */
function seatPosition(index: number, count: number): Point {
  const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
  return { x: 50 + 43 * Math.cos(angle), y: 50 + 42 * Math.sin(angle) };
}

type BubbleKind = "fold" | "check" | "call" | "raise" | "allin" | "blind" | "win" | "thinking";

/** The player's most recent action on this street, as a speech bubble. */
function lastAction(history: HandEvent[], player: PlayerState): { text: string; kind: BubbleKind } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.kind === "deal") return null;
    if (e.kind === "blind" && e.playerId === player.id) {
      return { text: `${e.blind === "small" ? "Small" : "Big"} blind ${chips(e.amount)}`, kind: "blind" };
    }
    if (e.kind === "action" && e.playerId === player.id) {
      if (e.allIn && e.type !== "fold") return { text: `All-in ${chips(e.to)}`, kind: "allin" };
      switch (e.type) {
        case "fold": return { text: "Fold", kind: "fold" };
        case "check": return { text: "Check", kind: "check" };
        case "call": return { text: `Call ${chips(e.amount)}`, kind: "call" };
        case "bet": return { text: `Bet ${chips(e.to)}`, kind: "raise" };
        case "raise": return { text: `Raise to ${chips(e.to)}`, kind: "raise" };
      }
    }
  }
  return null;
}

interface Motion {
  /** What changed in the last update. */
  now: Timeline;
  /** The current hand's opening deal (hole-card timings last all hand). */
  deal: Timeline;
  /** Increments with every update, to re-key one-shot effects. */
  id: number;
}

/** Keeps the previous game state so each update can be animated as a timeline. */
function useMotion(game: GameState, enabled: boolean): Motion {
  const [state, setState] = useState(() => {
    const now = buildTimeline(null, game);
    return { game, now, deal: now, id: 0 };
  });
  let current = state;
  if (state.game !== game) {
    const now = buildTimeline(state.game, game);
    current = { game, now, deal: now.events.some((e) => e.kind === "deal") ? now : state.deal, id: state.id + 1 };
    setState(current);
  }
  return enabled ? current : { now: EMPTY_TIMELINE, deal: EMPTY_TIMELINE, id: current.id };
}

const find = <K extends TimelineEvent["kind"]>(tl: Timeline, kind: K, pred: (e: Extract<TimelineEvent, { kind: K }>) => boolean = () => true) =>
  tl.events.find((e): e is Extract<TimelineEvent, { kind: K }> => e.kind === kind && pred(e as Extract<TimelineEvent, { kind: K }>));

export function Table({ game, highlight }: Props) {
  const reduceMotion = useGameStore((s) => s.settings.reduceMotion);
  const { now, deal, id } = useMotion(game, !reduceMotion);
  const { players, outcome } = game;
  const humanIndex = players.findIndex((p) => p.id === HUMAN_ID);
  const done = game.phase === "complete";
  const n = players.length;

  const seatPos = (i: number) => seatPosition((i - humanIndex + n) % n, n);
  // Bets sit between the seat and the center of the table; yours sits beside your cards.
  const betPos = (i: number) => (i === humanIndex ? { x: 34, y: 82 } : lerp(seatPos(i), CENTER, 0.62));
  // The dealer button sits just off the seat, toward the middle; seats at the top move it aside.
  const dealerPos = (i: number) => {
    if (i === humanIndex) return { x: 63, y: 80 };
    const p = lerp(seatPos(i), CENTER, 0.3);
    return Math.abs(seatPos(i).x - 50) < 15 ? { x: p.x + 8, y: p.y } : p;
  };
  // Cards come off the deck in front of the dealer.
  const deck = lerp(seatPos(game.dealer), CENTER, 0.55);
  // Where hole cards land: a little above the seat's name plate.
  const holePos = (i: number) => ({ x: seatPos(i).x, y: seatPos(i).y - (i === humanIndex ? 9 : 6) });

  const reveal = find(now, "reveal");
  const result = find(now, "result");
  const humanWin = find(now, "payout", (e) => e.seat === humanIndex);

  return (
    <div className="felt-wrap">
      <div className="rail" />
      <div className="felt">
        <div className="felt-line" />
        <div className="felt-mark">imaplaypoker</div>
      </div>

      <div className="felt-center">
        <div className="board">
          {game.board.map((c) => {
            const flip = find(now, "board", (e) => e.card === c);
            return (
              <PlayingCard
                key={c}
                card={c}
                flipDelay={flip?.at}
                highlight={highlight.includes(c)}
                dim={highlight.length > 0 && !highlight.includes(c)}
              />
            );
          })}
          {Array.from({ length: 5 - game.board.length }, (_, i) => (
            <div key={i} className="slot" />
          ))}
        </div>
        {done && outcome ? (
          <FeltResult game={game} delay={result?.at ?? 0} />
        ) : (
          <Pot game={game} />
        )}
      </div>

      <div className="dealer-btn" style={pct(dealerPos(game.dealer))} title="Dealer button">
        D
      </div>

      {players.map((p, i) => (
        <Seat
          key={p.id}
          game={game}
          index={i}
          pos={seatPos(i)}
          highlight={highlight}
          dealAt={(index) => {
            const e = find(deal, "deal", (d) => d.seat === i && d.index === index);
            return e ? e.at + T.cardFlight * 0.85 : undefined;
          }}
          foldAt={find(now, "action", (e) => e.seat === i && e.type === "fold")?.at}
          revealAt={reveal?.at}
          winAt={(() => {
            const e = find(now, "payout", (x) => x.seat === i);
            return e ? e.at + T.payout * 0.8 : undefined;
          })()}
          muckDir={{ x: CENTER.x - seatPos(i).x, y: CENTER.y - seatPos(i).y }}
        />
      ))}

      {/* Bets in front of each player; each new bet slides out from the seat. */}
      {!done &&
        players.map((p, i) => {
          if (p.streetBet <= 0) return null;
          const placed = find(now, "action", (e) => e.seat === i) ?? (game.street === "preflop" ? find(now, "blinds") : undefined);
          return (
            <div key={`${p.id}-${game.street}-${p.streetBet}`} className="bet-chip num" style={{ ...pct(betPos(i)), ...flyFrom(seatPos(i), placed?.at ?? 0) }}>
              <ChipStack amount={p.streetBet} max={5} size="1.35rem" />
              {chips(p.streetBet)}
            </div>
          );
        })}

      {/* One-shot effects for this update, re-keyed so they replay. */}
      <div key={id} className="fx-layer" aria-hidden>
        {now.events.map((e, k) => {
          switch (e.kind) {
            case "deal":
              return (
                <div
                  key={k}
                  className="flyer deal-flyer"
                  style={{ ...pct(holePos(e.seat)), ...flyFrom(deck, e.at), ["--spin" as string]: `${(e.seat % 2 ? -1 : 1) * (8 + e.index * 6)}deg` }}
                >
                  <PlayingCard faceDown size="sm" />
                </div>
              );
            case "sweep":
              return e.bets.map((b) => (
                <div key={`${k}-${b.seat}`} className="flyer sweep-flyer" style={{ ...pct(POT), ...flyFrom(betPos(b.seat), e.at) }}>
                  <ChipStack amount={b.amount} max={5} size="1.35rem" />
                </div>
              ));
            case "payout":
              return (
                <div key={k} className="flyer payout-flyer" style={{ ...pct(seatPos(e.seat)), ...flyFrom(POT, e.at) }}>
                  <PotChips amount={e.amount} />
                </div>
              );
            default:
              return null;
          }
        })}
        {humanWin && <ChipBurst at={seatPos(humanIndex)} delay={humanWin.at + T.payout * 0.7} big={humanWin.amount >= game.config.bigBlind * 20} />}
      </div>
    </div>
  );
}

function Pot({ game }: { game: GameState }) {
  const total = useCountUp(potTotal(game));
  const collected = collectedPot(game);
  return (
    <div className="pot-row">
      {collected > 0 && <PotChips amount={collected} />}
      <div className="pot num">
        <span className="lbl">Pot</span> {chips(total)}
      </div>
      <span className="street-label">{STREET_NAMES[game.street]}</span>
    </div>
  );
}

interface SeatProps {
  game: GameState;
  index: number;
  pos: Point;
  highlight: readonly Card[];
  /** When hole card `index` lands, in seconds (undefined: already there). */
  dealAt: (index: number) => number | undefined;
  foldAt?: number;
  revealAt?: number;
  /** When this seat's winnings land. */
  winAt?: number;
  muckDir: Point;
}

function Seat({ game, index: i, pos, highlight, dealAt, foldAt, revealAt, winAt, muckDir }: SeatProps) {
  const p = game.players[i];
  const { outcome } = game;
  const done = game.phase === "complete";
  const isHuman = p.id === HUMAN_ID;
  const shownHand = done && outcome?.showdown && !p.folded ? outcome.hands[p.id] : undefined;
  const won = outcome?.payouts[p.id];
  const toAct = game.phase === "betting" && game.toAct === i;
  const profile = p.botProfile ? BOT_PROFILES[p.botProfile] : undefined;
  const stack = useCountUp(p.stack);

  let bubble: { text: string; kind: BubbleKind } | null;
  if (p.busted) bubble = null;
  else if (toAct && !isHuman) bubble = { text: "", kind: "thinking" };
  else if (done && won) bubble = { text: `Wins ${chips(won)}${shownHand ? ` · ${categoryName(shownHand.category)}` : ""}`, kind: "win" };
  else if (shownHand) bubble = { text: categoryName(shownHand.category), kind: "check" };
  else if (p.folded) bubble = { text: "Folded", kind: "fold" };
  else bubble = done ? null : lastAction(game.history, p);

  const cls = ["seat", isHuman && "human", p.folded && "folded", p.busted && "busted", toAct && "to-act", won && "winner"]
    .filter(Boolean)
    .join(" ");
  // Folded cards slide toward the middle of the table and vanish.
  const len = Math.hypot(muckDir.x, muckDir.y) || 1;
  const muck = {
    "--mx": `${(muckDir.x / len) * 5}rem`,
    "--my": `${(muckDir.y / len) * 4}rem`,
    animationDelay: `${foldAt ?? 0}s`,
  } as CSSProperties;

  return (
    <div className={cls} style={{ ...pct(pos), ["--win-delay" as string]: `${winAt ?? 0}s` }}>
      <div className="hole">
        {!p.busted &&
          p.hole.map((c, k) => {
            const arrive = dealAt(k);
            const dealt = arrive !== undefined ? ({ "--arrive": `${arrive}s` } as CSSProperties) : undefined;
            if (isHuman) {
              return (
                <PlayingCard
                  key={c}
                  card={c}
                  size="lg"
                  highlight={highlight.includes(c)}
                  dim={p.folded}
                  flipDelay={arrive !== undefined ? arrive + 0.15 + k * 0.08 : undefined}
                  className={arrive !== undefined ? "dealt" : undefined}
                  style={dealt}
                />
              );
            }
            if (shownHand) {
              return <PlayingCard key={c} card={c} size="sm" flipDelay={revealAt !== undefined ? revealAt + k * 0.08 : undefined} />;
            }
            return (
              <PlayingCard
                key={c}
                faceDown
                size="sm"
                className={p.folded ? "muck" : arrive !== undefined ? "dealt" : undefined}
                style={p.folded ? muck : dealt}
              />
            );
          })}
      </div>
      <div className="seat-plate" title={profile?.description}>
        {bubble && (
          <div key={`${bubble.kind}-${bubble.text}`} className={`bubble ${bubble.kind}`}>
            {bubble.kind === "thinking" ? (
              <span className="think" aria-label="Thinking"><i /><i /><i /></span>
            ) : (
              bubble.text
            )}
          </div>
        )}
        <div className="avatar" style={{ background: isHuman ? "var(--brass)" : STYLE_COLORS[p.botProfile ?? "tag"] }} aria-hidden>
          {isHuman ? <Icon name="spade" size="1.2rem" /> : p.name[0]}
        </div>
        <div className="seat-info">
          <span className="seat-name">{p.name}</span>
          <span className="seat-stack num">{p.busted ? "Out" : chips(stack)}</span>
        </div>
      </div>
      {profile && <div className="seat-style">{profile.name}</div>}
    </div>
  );
}

/** A spray of chips over your seat when you take a pot. */
function ChipBurst({ at, delay, big }: { at: Point; delay: number; big: boolean }) {
  const count = big ? 18 : 9;
  const colors = ["#c9302c", "#2f6fc4", "#2b9a5a", "#e8c35a", "#1d1d1d", "#7a4cc2"];
  return (
    <div className={`burst ${big ? "big" : ""}`} style={pct(at)}>
      {Array.from({ length: count }, (_, k) => {
        const angle = (k / count) * 360 + (k % 2) * 11;
        const dist = (big ? 6 : 4) + (k % 3) * 1.4;
        return (
          <i
            key={k}
            style={
              {
                "--a": `${angle}deg`,
                "--d": `${dist}rem`,
                background: colors[k % colors.length],
                animationDelay: `${delay + (k % 4) * 0.03}s`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function FeltResult({ game, delay }: { game: GameState; delay: number }) {
  const outcome = game.outcome!;
  const name = (id: string) => (id === HUMAN_ID ? "You" : game.players.find((p) => p.id === id)!.name);
  const myWin = outcome.payouts[HUMAN_ID] ?? 0;
  const main = outcome.pots[0];
  const winners = main.winners.map(name).join(" & ");
  const big =
    myWin > 0
      ? main.winners.length > 1 && main.winners.includes(HUMAN_ID)
        ? `Split pot · you take ${chips(myWin)}`
        : `You take ${chips(myWin)}`
      : `${winners} win${main.winners.length > 1 ? "" : "s"} ${chips(main.amount)}`;
  return (
    <div className={`felt-result ${myWin > 0 ? "won" : ""}`} role="status" style={{ animationDelay: `${delay}s` }}>
      <div className="big">{big}</div>
      <div className="small">
        {main.handName ? `with ${main.handName}` : "Everyone else folded"}
        {outcome.pots.length > 1 && ` · ${outcome.pots.length - 1} side pot${outcome.pots.length > 2 ? "s" : ""}`}
      </div>
    </div>
  );
}
