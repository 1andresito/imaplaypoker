// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { gameHotkey } from "../hotkeys";

const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  gameHotkey({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: document.body, ...extra });

afterEach(() => (document.body.innerHTML = ""));

describe("game hotkeys", () => {
  it("maps F / C / R in either case", () => {
    expect(press("f")).toBe("fold");
    expect(press("C")).toBe("call");
    expect(press("r")).toBe("raise");
    expect(press("x")).toBeNull();
  });

  it("ignores shortcuts with modifiers and key repeat", () => {
    expect(press("c", { ctrlKey: true })).toBeNull();
    expect(press("r", { metaKey: true })).toBeNull();
    expect(press("f", { altKey: true })).toBeNull();
    expect(press("c", { repeat: true })).toBeNull();
  });

  it("ignores typing in fields and presses behind a dialog", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(press("c", { target: input })).toBeNull();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(press("c")).toBeNull();
  });
});
