// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { APP_VERSION, useUpdateStore } from "../../store/updateStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const relaunch = vi.fn(async () => {});
const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
  onEvent({ event: "Started", data: { contentLength: 100 } });
  onEvent({ event: "Progress", data: { chunkLength: 60 } });
  onEvent({ event: "Progress", data: { chunkLength: 40 } });
  onEvent({ event: "Finished" });
});
let available = true;

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => (available ? { version: "9.9.9", body: "Faster bots.\nNew felt.", downloadAndInstall } : null),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useUpdateStore.setState({ status: "idle", version: null, notes: "", progress: null, error: null, dialogOpen: false });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  relaunch.mockClear();
  downloadAndInstall.mockClear();
});

describe("auto-update", () => {
  it("knows the app version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("does nothing in the browser build", async () => {
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("finds an update, shows the banner, downloads with progress, and restarts", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    act(() => root.render(<App />));
    expect(container.querySelector(".update-banner")).toBeNull();

    await act(() => useUpdateStore.getState().check(true));
    const banner = container.querySelector(".update-banner") as HTMLButtonElement;
    expect(banner.textContent).toContain("9.9.9");

    act(() => banner.click());
    expect(container.textContent).toContain("Faster bots.");
    const installBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Install & restart")!;
    await act(async () => installBtn.click());

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState().progress).toBe(1);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("reports when already up to date", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    available = false;
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("none");
    available = true;
  });
});
