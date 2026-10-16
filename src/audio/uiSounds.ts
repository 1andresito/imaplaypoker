import { play, playSliderTick } from "./sound";

const INTERACTIVE = 'button, [role="tab"], select, input[type="range"]';

/**
 * Interface sounds via event delegation, so every control gets feedback without
 * per-component wiring:
 *  - hover:   soft tick when the pointer reaches a new control
 *  - click:   a sound that matches the kind of control (tab, toggle, choice, primary…)
 *  - sliders: a tick that rises in pitch as the value goes up
 * The big Fold / Call / Raise buttons are skipped: the game plays its own sounds for those.
 */
export function initUiSounds(): void {
  let hovered: Element | null = null;
  let lastHover = 0;

  document.addEventListener("pointerover", (e) => {
    const el = (e.target as Element).closest?.(INTERACTIVE) ?? null;
    if (el === hovered) return;
    hovered = el;
    if (!el || (el as HTMLButtonElement).disabled) return;
    // Throttle so sweeping across a grid of buttons doesn't rattle.
    const now = performance.now();
    if (now - lastHover < 45) return;
    lastHover = now;
    play("hover");
  });

  // Disabled buttons don't fire click events, so catch their presses here.
  document.addEventListener("pointerdown", (e) => {
    const el = (e.target as Element).closest?.("button");
    if (el && (el as HTMLButtonElement).disabled) play("deny");
  });

  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as Element).closest?.('button, [role="tab"]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (el.classList.contains("act")) return; // game sounds handle Fold/Call/Raise
      if (el.hasAttribute("data-silent")) return; // the control plays its own sound
      if (el.getAttribute("role") === "switch") {
        // aria-checked is still the old value while the click is being handled.
        play(el.getAttribute("aria-checked") === "true" ? "toggleOff" : "toggleOn");
      } else if (el.getAttribute("role") === "tab") play("tab");
      else if (el.classList.contains("btn-primary")) play("confirm");
      else if (el.classList.contains("choice") || el.hasAttribute("aria-pressed")) play("select");
      else play("click");
    },
    true,
  );

  document.addEventListener("change", (e) => {
    if ((e.target as Element).matches?.("select")) play("select");
  });

  let lastTick = 0;
  document.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type !== "range") return;
    const now = performance.now();
    if (now - lastTick < 40) return;
    lastTick = now;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    playSliderTick(max > min ? (Number(el.value) - min) / (max - min) : 0);
  });

  // Keyboard users get the same feedback when moving focus between controls.
  document.addEventListener("focusin", (e) => {
    const el = e.target as Element;
    if (el.matches?.(":focus-visible") && el.matches(INTERACTIVE)) play("hover");
  });
}
