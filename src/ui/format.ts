export const pct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`;

export const chips = (n: number): string => n.toLocaleString("en-US");

export const signed = (n: number): string => (n > 0 ? `+${chips(n)}` : chips(n));

