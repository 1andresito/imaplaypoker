import type { CSSProperties } from "react";
import { type Card, rankLabel, rankOf, SUIT_NAMES, SUIT_SYMBOLS, suitOf } from "../engine/cards";
import { useGameStore } from "../store/gameStore";

const TWO_COLOR = ["var(--suit-black)", "var(--suit-red)", "var(--suit-red)", "var(--suit-black)"];
// Four-color deck: every suit gets its own color, which makes flushes easier to spot.
const FOUR_COLOR = ["var(--suit-black)", "var(--suit-red)", "var(--suit-blue)", "var(--suit-green)"];

type Size = "lg" | "md" | "sm" | "xs";

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: Size;
  highlight?: boolean;
  dim?: boolean;
  /** Turn the card over (back to face) after this many seconds. */
  flipDelay?: number;
  className?: string;
  style?: CSSProperties;
}

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export function PlayingCard({ card, faceDown, size = "md", highlight, dim, flipDelay, className, style }: Props) {
  const fourColor = useGameStore((s) => s.settings.fourColorDeck);
  const sizeClass = `size-${size}`;
  if (faceDown || card === undefined) {
    return <div className={cx("card", "back", sizeClass, className)} style={style} aria-label="Face-down card" />;
  }
  const rank = rankOf(card);
  const suit = suitOf(card);
  const label = rankLabel(rank);
  const name = `${label} of ${SUIT_NAMES[suit]}`;
  const face = (
    <div
      className={cx("card", "front", sizeClass, highlight && "highlight", dim && "dim", flipDelay === undefined && className)}
      style={{ color: (fourColor ? FOUR_COLOR : TWO_COLOR)[suit], ...(flipDelay === undefined ? style : null) }}
      aria-label={name}
      title={name}
    >
      <span className="idx">
        {label}
        <small>{SUIT_SYMBOLS[suit]}</small>
      </span>
      {size !== "xs" && (
        <>
          {rank >= 11 && rank <= 13 ? (
            <span className="court">
              <b>{label}</b>
              <small>{SUIT_SYMBOLS[suit]}</small>
            </span>
          ) : (
            <span className={cx("pip", rank === 14 && "ace")}>{SUIT_SYMBOLS[suit]}</span>
          )}
          <span className="idx idx-br" aria-hidden>
            {label}
            <small>{SUIT_SYMBOLS[suit]}</small>
          </span>
        </>
      )}
    </div>
  );
  if (flipDelay === undefined) return face;
  return (
    <div className={cx("card-flip", sizeClass, className)} style={{ ...style, ["--flip-delay" as string]: `${flipDelay}s` }}>
      <div className={cx("card", "back", sizeClass)} aria-hidden />
      {face}
    </div>
  );
}

export function CardRow({ cards, size = "xs" }: { cards: readonly Card[]; size?: Size }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} />
      ))}
    </span>
  );
}
