import { useGameStore } from "../store/gameStore";
import { Icon } from "./icons";

/** Music and sound-effect switches, shared by the table's top bar and the menu corner. */
export function SoundToggles({ round = false }: { round?: boolean }) {
  const music = useGameStore((s) => s.settings.music);
  const soundEffects = useGameStore((s) => s.settings.soundEffects);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const cls = (on: boolean) => `${round ? "round-btn" : "btn btn-sm icon-btn"} ${on ? "on" : ""}`;
  return (
    <>
      <button
        className={cls(music)}
        role="switch"
        aria-checked={music}
        aria-label="Background music"
        title={music ? "Turn music off" : "Play background jazz"}
        onClick={() => updateSettings({ music: !music })}
      >
        <Icon name="music" />
      </button>
      <button
        className={cls(soundEffects)}
        role="switch"
        aria-checked={soundEffects}
        aria-label="Sound effects"
        title={soundEffects ? "Mute sound effects" : "Turn sound effects on"}
        onClick={() => updateSettings({ soundEffects: !soundEffects })}
      >
        <Icon name={soundEffects ? "soundOn" : "soundOff"} />
      </button>
    </>
  );
}
