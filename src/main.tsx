import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initGameSounds } from "./audio/gameSounds";
import { useGameStore } from "./store/gameStore";
import { isDesktopApp, useUpdateStore } from "./store/updateStore";
// Fonts are bundled (latin subset only): the desktop app works offline and its CSP blocks font CDNs.
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/playfair-display/latin-700-italic.css";
import "@fontsource/playfair-display/latin-900.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-600.css";
import "@fontsource/source-sans-3/latin-700.css";
import "./styles.css";

// Dev conveniences: ?autoplay skips the lobby; ?autoplay=showdown also checks/calls
// for you so the hand runs to the end (handy for screenshots).
const autoplay = import.meta.env.DEV ? new URLSearchParams(location.search).get("autoplay") : null;
if (autoplay !== null) {
  // Fast bots for this session only (not saved to your settings).
  useGameStore.setState((s) => ({ settings: { ...s.settings, botSpeed: "fast" } }));
  useGameStore.getState().sitDown();
  if (autoplay === "showdown") {
    useGameStore.subscribe(({ game, humanAct }) => {
      if (game?.phase === "betting" && game.players[game.toAct].isHuman) {
        setTimeout(() => humanAct({ type: game.currentBet > game.players[game.toAct].streetBet ? "call" : "check" }));
      }
    });
  }
}

initGameSounds();

// Desktop app: look for a new version shortly after launch (quietly; offline is fine).
if (isDesktopApp()) setTimeout(() => void useUpdateStore.getState().check(true), 2000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
