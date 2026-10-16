// localStorage persists inside the Tauri webview (in the app's data directory),
// so the desktop build needs no extra plugin. Every access is guarded because
// storage can be unavailable (private mode, blocked site data).

const PREFIX = "imaplaypoker.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Loads a saved object, merged over `fallback`. Saved data is untrusted (old
 * versions, hand edits, corruption), so `sanitize` repairs or drops bad fields.
 */
export function load<T extends object>(key: string, fallback: T, sanitize?: (value: T, fallback: T) => T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;
    const merged = { ...fallback, ...parsed } as T;
    return sanitize ? sanitize(merged, fallback) : merged;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not fatal: stats just won't persist this session.
  }
}

// ---------------------------------------------------------------------------
// Field validators for sanitizers.

/** `value` if it is one of `options`, else `fallback`. */
export const oneOf = <T>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/** A finite number clamped to [min, max]; `fallback` if not a number. */
export const clampNum = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** A non-negative integer count; `fallback` if invalid. */
export const count = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
