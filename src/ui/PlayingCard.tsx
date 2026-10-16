import { type Card, rankLabel, rankOf, SUIT_NAMES, SUIT_SYMBOLS, suitOf } from "../engine/cards";
import { useGameStore } from "../store/gameStore";

const TWO_COLOR = ["var(--suit-black)", "var(--suit-red)", "var(--suit-red)", "var(--suit-black)"];
// Four-color deck: every suit gets its own color, which makes flushes easier to spot.
const FOUR_COLOR = ["var(--suit-black)", "var(--suit-red)", "var(--suit-blue)", "var(--suit-green)"];

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: "md" | "sm" | "xs";
  highlight?: boolean;
  dim?: boolean;
}

export function PlayingCard({ card, faceDown, size = "md", highlight, dim }: Props) {
  const fourColor = useGameStore((s) => s.settings.fourColorDeck);
  const sizeClass = size === "md" ? "" : size;
  if (faceDown || card === undefined) {
    return <div className={`card back ${sizeClass}`} aria-label="Face-down card" />;
  }
  const rank = rankOf(card);
  const suit = suitOf(card);
  const color = (fourColor ? FOUR_COLOR : TWO_COLOR)[suit];
  const label = rankLabel(rank);
  return (
    <div
      className={`card ${sizeClass} ${highlight ? "highlight" : ""} ${dim ? "dim" : ""}`}
      style={{ color }}
      aria-label={`${label} of ${SUIT_NAMES[suit]}`}
      title={`${label} of ${SUIT_NAMES[suit]}`}
    >
      <span className="corner">
        {label}
        {size === "xs" ? SUIT_SYMBOLS[suit] : ""}
      </span>
      {size !== "xs" && <span className="pip">{SUIT_SYMBOLS[suit]}</span>}
    </div>
  );
}

export function CardRow({ cards, size = "xs" }: { cards: readonly Card[]; size?: Props["size"] }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} />
      ))}
    </span>
  );
}
