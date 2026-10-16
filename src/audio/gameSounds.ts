import { buildTimeline, type TimelineEvent } from "../animation/timeline";
import { useGameStore } from "../store/gameStore";
import { configureEffects, configureMusic, play, type SoundName, unlockAudio } from "./sound";
import { initUiSounds } from "./uiSounds";

function soundFor(e: TimelineEvent): SoundName | null {
  switch (e.kind) {
    case "deal":
      return "deal";
    case "blinds":
      return "chips";
    case "action":
      if (e.allIn && e.type !== "fold") return "allIn";
      if (e.type === "fold" || e.type === "check") return e.type;
      return e.type === "call" ? "chips" : "bigChips";
    case "board":
    case "reveal":
      return "flip";
    case "sweep":
      return "chips";
    case "result":
      return e.outcome === "win" ? "win" : e.outcome === "lose" ? "lose" : "chips";
    case "yourTurn":
      return "yourTurn";
    case "payout":
      return null; // the result sound covers it
  }
}

/** Wires game sounds, interface sounds and music to the store. Call once at startup. */
export function initGameSounds(): void {
  const apply = () => {
    const { soundEffects, volume, music, musicVolume } = useGameStore.getState().settings;
    configureEffects({ on: soundEffects, volume });
    configureMusic({ on: music, volume: musicVolume });
  };
  apply();

  useGameStore.subscribe((state, prev) => {
    if (state.settings !== prev.settings) apply();
    if (state.game !== prev.game) {
      for (const e of buildTimeline(prev.game, state.game, state.myId).events) {
        const sound = soundFor(e);
        if (sound) play(sound, e.at);
      }
    }
  });

  initUiSounds();

  // Audio can only start after the player interacts with the page.
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
