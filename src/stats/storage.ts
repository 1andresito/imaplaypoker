// localStorage persists inside the Tauri webview (in the app's data directory),
// so the desktop build needs no extra plugin. Every access is guarded because
// storage can be unavailable (private mode, blocked site data).

const PREFIX = "imaplaypoker.";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
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
