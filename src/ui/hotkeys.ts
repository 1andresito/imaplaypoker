export type GameHotkey = "fold" | "call" | "raise";

const KEYS: Record<string, GameHotkey> = { f: "fold", c: "call", r: "raise" };

/**
 * Maps a key press to a Fold / Check-Call / Raise shortcut, or null when it
 * shouldn't count: modifier combos (Ctrl+C copies, Ctrl+R reloads), held-down
 * repeats, typing in a field, or a dialog open on top of the table.
 */
export function gameHotkey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "target">): GameHotkey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.closest("input, select, textarea"))) return null;
  if (document.querySelector('[role="dialog"]')) return null;
  return KEYS[e.key.toLowerCase()] ?? null;
}
