import { memo } from "react";
import { chipColumnSvg } from "./logo";

// Chip values by color, biggest first (a common home-game set).
const DENOMINATIONS: [number, string][] = [
  [1000, "gold"],
  [500, "purple"],
  [100, "black"],
  [25, "green"],
  [10, "blue"],
  [5, "red"],
  [1, "white"],
];

/** The chips that make up `amount`, bottom of the stack first, capped at `max` chips. */
export function chipColors(amount: number, max = 6): string[] {
  const out: string[] = [];
  let left = Math.max(0, Math.round(amount));
  for (const [value, color] of DENOMINATIONS) {
    while (left >= value && out.length < max) {
      out.push(color);
      left -= value;
    }
  }
  return out.length ? out : ["white"];
}

const cache = new Map<string, string>();
function columnSvg(colors: string[]): string {
  const key = colors.join(",");
  let svg = cache.get(key);
  if (!svg) cache.set(key, (svg = chipColumnSvg(colors)));
  return svg;
}

/** A stack of real-looking chips for a bet or pot amount. */
export const ChipStack = memo(function ChipStack({ amount, max = 6, size = "1.7rem" }: { amount: number; max?: number; size?: string }) {
  const colors = chipColors(amount, max);
  return (
    <span
      className="chip-stack"
      style={{ width: size }}
      aria-hidden
      // Built from our own numbers and colors only, never user text.
      dangerouslySetInnerHTML={{ __html: columnSvg(colors) }}
    />
  );
});

/** Several stacks side by side, for a big pot. */
export function PotChips({ amount }: { amount: number }) {
  const colors = chipColors(amount, 15);
  const columns: string[][] = [];
  for (let i = 0; i < colors.length; i += 5) columns.push(colors.slice(i, i + 5));
  return (
    <span className="pot-chips" aria-hidden>
      {columns.map((col, i) => (
        <span
          key={i}
          className="chip-stack"
          dangerouslySetInnerHTML={{ __html: columnSvg(col) }}
        />
      ))}
    </span>
  );
}
