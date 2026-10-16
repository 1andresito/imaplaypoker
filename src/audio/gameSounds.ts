import type { GameState } from "../engine/types";
import { useGameStore } from "../store/gameStore";
import { configureEffects, configureMusic, play, unlockAudio } from "./sound";
import { initUiSounds } from "./uiSounds";

/** Plays sounds for whatever happened between two game states. */
function soundsFor(prev: GameState | null, next: GameState | null, myId: string) {
  if (!next) return;
  const newHand = !prev || prev.handNumber !== next.handNumber;
  const events = next.history.slice(newHand ? 0 : prev!.history.length);
  let t = 0;

  if (newHand) {
    // Hole cards fly out one at a time.
    const dealt = next.players.reduce((n, p) => n + p.hole.length, 0);
    for (let i = 0; i < dealt; i++) play("deal", i * 0.07);
    t = dealt * 0.07;
  }

  let blinds = false;
  for (const e of events) {
    switch (e.kind) {
      case "blind":
        if (!blinds) play("chips", t);
        blinds = true;
        break;
      case "action":
        if (e.allIn && e.type !== "fold") play("allIn", t);
        else if (e.type === "fold") play("fold", t);
        else if (e.type === "check") play("check", t);
        else play(e.type === "call" ? "chips" : "bigChips", t);
        t += 0.15;
        break;
      case "deal":
        t += 0.25;
        e.cards.forEach((_, i) => play("flip", t + i * 0.14));
        t += e.cards.length * 0.14;
        break;
      case "win":
        break;
    }
  }

  if (next.phase === "complete" && prev?.phase !== "complete" && next.outcome) {
    const me = next.players.find((p) => p.id === myId);
    const iWon = (next.outcome.payouts[myId] ?? 0) > 0;
    if (iWon) play("win", t + 0.3);
    else if (me && !me.folded && me.handBet > 0) play("lose", t + 0.3);
    else play("chips", t + 0.3);
    return;
  }

  const myTurn = next.phase === "betting" && next.players[next.toAct]?.id === myId;
  const wasMyTurn = !newHand && prev!.phase === "betting" && prev!.players[prev!.toAct]?.id === myId;
  if (myTurn && !wasMyTurn) play("yourTurn", t + 0.2);
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
    if (state.game !== prev.game) soundsFor(prev.game, state.game, state.myId);
  });

  initUiSounds();

  // Audio can only start after the player interacts with the page.
  const unlock = () => unlockAudio();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}
