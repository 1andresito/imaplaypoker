// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { applyAction, legalActions } from "../../engine/gameState";
import { type AssistLevel, HUMAN_ID, useGameStore } from "../../store/gameStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useGameStore.getState().leaveTable();
  vi.useRealTimers();
});

describe("UI renders", () => {
  it("renders the lobby and sits down", () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain("Texas Hold'em");
    const sit = [...container.querySelectorAll("button")].find((b) => b.textContent === "Sit down")!;
    vi.useFakeTimers();
    act(() => sit.click());
    expect(container.querySelector(".felt")).not.toBeNull();
    expect(container.querySelectorAll(".seat")).toHaveLength(useGameStore.getState().setup.bots + 1);
  });

  it("renders the table on every street at every assist level", () => {
    vi.useFakeTimers();
    const levels: AssistLevel[] = ["off", "hints", "coach", "guided"];
    act(() => root.render(<App />));
    for (const assist of levels) {
      act(() => {
        useGameStore.getState().updateSettings({ assist, showHandHelper: true });
        useGameStore.getState().sitDown();
      });
      vi.clearAllTimers(); // drive the hand manually instead of letting bots act
      let game = useGameStore.getState().game!;
      for (let guard = 0; game.phase === "betting" && guard < 100; guard++) {
        act(() => useGameStore.setState({ game }));
        const text = container.textContent!;
        expect(text).toContain("Royal Flush");
        if (game.players[game.toAct].id === HUMAN_ID) {
          expect(container.querySelector(".action-bar .act")).not.toBeNull();
          // Coach box only at coach/guided; recommended highlight only at guided.
          expect(!!container.querySelector(".coach-box")).toBe(assist === "coach" || assist === "guided");
          expect(!!container.querySelector(".act.recommended")).toBe(assist === "guided");
        }
        if (assist !== "off" && game.board.length >= 3) expect(text).toContain("What beats you right now");
        const legal = legalActions(game)!;
        game = applyAction(game, { type: legal.canCheck ? "check" : "call" });
      }
      act(() => useGameStore.setState({ game }));
      expect(container.querySelector(".result-banner")).not.toBeNull();
    }
  });

  it("switches side panel tabs", () => {
    vi.useFakeTimers();
    act(() => root.render(<App />));
    act(() => useGameStore.getState().sitDown());
    const tab = (name: string) => [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name) as HTMLElement;
    act(() => tab("Stats").click());
    expect(container.textContent).toContain("VPIP");
    act(() => tab("Hand log").click());
    expect(container.textContent).toContain("posts small blind");
  });
});
