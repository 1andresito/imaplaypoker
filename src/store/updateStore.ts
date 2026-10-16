import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

/** True when running inside the Tauri desktop app (not the browser dev build). */
export const isDesktopApp = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const APP_VERSION: string = __APP_VERSION__;

type Status = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";

interface UpdateStore {
  status: Status;
  version: string | null;
  notes: string;
  /** Download progress 0–1, or null when the size is unknown. */
  progress: number | null;
  error: string | null;
  /** Whether the "update available" dialog is open. */
  dialogOpen: boolean;

  /** Checks the release feed. `quiet` = don't show errors (used on startup). */
  check(quiet?: boolean): Promise<void>;
  install(): Promise<void>;
  openDialog(open: boolean): void;
}

let pending: Update | null = null;

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: "idle",
  version: null,
  notes: "",
  progress: null,
  error: null,
  dialogOpen: false,

  async check(quiet = false) {
    if (!isDesktopApp() || get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", error: null });
    try {
      // Loaded lazily so the browser build never touches the desktop-only APIs.
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        pending = update;
        set({ status: "available", version: update.version, notes: update.body ?? "" });
      } else {
        set({ status: "none" });
      }
    } catch (e) {
      set({ status: quiet ? "idle" : "error", error: String(e) });
    }
  },

  async install() {
    if (!pending) return;
    set({ status: "downloading", progress: 0, error: null });
    let total = 0;
    let received = 0;
    try {
      await pending.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          received += e.data.chunkLength;
          set({ progress: total ? received / total : null });
        }
      });
      set({ status: "ready", progress: 1 });
      // On Windows the installer takes over and closes the app; elsewhere restart into the new version.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  openDialog(open) {
    set({ dialogOpen: open });
  },
}));
