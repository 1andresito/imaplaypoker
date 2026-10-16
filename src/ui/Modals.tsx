import { type ReactNode, useEffect } from "react";
import { play } from "../audio/sound";
import { chartGrid, GROUP_LABELS, groupOfClass, handClass } from "../analysis/preflopChart";
import type { Card } from "../engine/cards";
import { type AssistLevel, type BotSpeed, useGameStore } from "../store/gameStore";

let lastOpenSound = 0;

export function Modal({ title, onClose: onCloseProp, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const onClose = () => {
    play("close");
    onCloseProp();
  };
  useEffect(() => {
    // Throttled: React's dev mode mounts effects twice.
    if (performance.now() - lastOpenSound > 200) play("open");
    lastOpenSound = performance.now();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close" data-silent>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Sequential single-hue ramp (gold): darker/more saturated = stronger group.
const GROUP_COLORS = ["#f5c451", "#f0cf6e", "#ebd88a", "#e3dea4", "#d5dbb9", "#c2cfc4", "#a9bab3", "#8fa29b", "#5d6d67"];

/** 13×13 grid of every starting hand, colored by group, with yours outlined. */
export function PreflopGrid({ hole, legend = true }: { hole?: readonly Card[]; legend?: boolean }) {
  const mine = hole && hole.length === 2 ? handClass(hole) : null;
  return (
    <>
      <div className="chart-grid">
        {chartGrid().flat().map((cls) => {
          const g = groupOfClass(cls);
          return (
            <div
              key={cls}
              className={cls === mine ? "mine" : ""}
              style={{ background: GROUP_COLORS[g - 1] }}
              title={`${cls}: group ${g} (${GROUP_LABELS[g]})`}
            >
              {cls.slice(0, 2)}
            </div>
          );
        })}
      </div>
      {legend && (
        <div className="legend">
          {GROUP_COLORS.map((c, i) => (
            <span key={c}>
              <i style={{ background: c }} /> {i + 1} {GROUP_LABELS[i + 1]}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function PreflopChartModal({ hole, onClose }: { hole?: readonly Card[]; onClose: () => void }) {
  const mine = hole && hole.length === 2 ? handClass(hole) : null;
  return (
    <Modal title="Starting-hand chart" onClose={onClose}>
      <p className="text-2" style={{ margin: 0 }}>
        Every two-card starting hand, grouped by strength. Suited hands (both cards the same suit, marked “s”) are above the
        diagonal. Offsuit hands (“o”) are below it, and pairs run along the diagonal. Beginners do well playing only
        groups 1–4, plus groups 5–6 from late position.
      </p>
      <PreflopGrid hole={hole} />
      {mine && <div className="text-2">Your hand ({mine}) is outlined in white.</div>}
    </Modal>
  );
}

export const ASSIST_LEVELS: { id: AssistLevel; icon: string; name: string; short: string; description: string }[] = [
  { id: "off", icon: "🃏", name: "Off", short: "Just the cards", description: "Just the game. The Hand Helper shows only your hand and the rankings." },
  { id: "hints", icon: "💡", name: "Hints", short: "Odds & outs", description: "Win chance, pot odds, outs, and what beats you." },
  { id: "coach", icon: "🎓", name: "Coach", short: "Tips with reasons", description: "Hints, plus a suggested action with a plain-English reason." },
  { id: "guided", icon: "🧭", name: "Guided", short: "Shows the best move", description: "Coach, plus it highlights the suggested button and pre-fills the bet size." },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="toggle" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  return (
    <Modal title="Settings" onClose={onClose}>
      <div>
        <h4>Help while playing</h4>
        <div className="field" style={{ alignItems: "flex-start", flexDirection: "column" }}>
          <div>
            <div>Assistance level</div>
            <div className="desc">How much help you get while you play.</div>
          </div>
          <div className="tile-row compact" style={{ width: "100%" }}>
            {ASSIST_LEVELS.map((l) => (
              <button key={l.id} className="tile" aria-pressed={settings.assist === l.id} onClick={() => update({ assist: l.id })} title={l.description}>
                {settings.assist === l.id && <span className="tile-check" aria-hidden>✓</span>}
                <span className="tile-icon">{l.icon}</span>
                <span className="tile-name">{l.name}</span>
                <span className="tile-desc">{l.short}</span>
              </button>
            ))}
          </div>
          <div className="desc">{ASSIST_LEVELS.find((l) => l.id === settings.assist)?.description}</div>
        </div>
        <h4>Sound</h4>
        <div className="field">
          <div>
            <div>Sound effects</div>
            <div className="desc">Cards, chips, buttons, and a chime when it's your turn.</div>
          </div>
          <Toggle label="Sound effects" checked={settings.soundEffects} onChange={(v) => update({ soundEffects: v })} />
        </div>
        <div className="field">
          <div>Effects volume</div>
          <input type="range" min={0} max={1} step={0.05} value={settings.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })} aria-label="Effects volume" />
        </div>
        <div className="field">
          <div>
            <div>Background music</div>
            <div className="desc">Relaxed looping jazz.</div>
          </div>
          <Toggle label="Background music" checked={settings.music} onChange={(v) => update({ music: v })} />
        </div>
        <div className="field">
          <div>Music volume</div>
          <input type="range" min={0} max={1} step={0.05} value={settings.musicVolume}
            onChange={(e) => update({ musicVolume: Number(e.target.value) })} aria-label="Music volume" />
        </div>
        <div className="credit">
          Music: “Jazz Improvisation Looped” by Alex McCulloch (Pro Sensory), released into the public domain (CC0).
        </div>

        <h4>Display</h4>
        <div className="field">
          <div>
            <div>Large text</div>
            <div className="desc">Makes all text and cards bigger.</div>
          </div>
          <Toggle label="Large text" checked={settings.largeText} onChange={(v) => update({ largeText: v })} />
        </div>
        <div className="field">
          <div>
            <div>Show Hand Helper panel</div>
            <div className="desc">The side panel with your hand, odds, and hand rankings.</div>
          </div>
          <Toggle label="Show Hand Helper" checked={settings.showHandHelper} onChange={(v) => update({ showHandHelper: v })} />
        </div>
        <div className="field">
          <div>
            <div>Four-color deck</div>
            <div className="desc">Diamonds blue, clubs green. Makes flushes much easier to spot.</div>
          </div>
          <Toggle label="Four-color deck" checked={settings.fourColorDeck} onChange={(v) => update({ fourColorDeck: v })} />
        </div>

        <h4>Game</h4>
        <div className="field">
          <div>
            <div>Deal next hand automatically</div>
            <div className="desc">Starts the next hand a few seconds after one ends.</div>
          </div>
          <Toggle label="Auto deal" checked={settings.autoDeal} onChange={(v) => update({ autoDeal: v })} />
        </div>
        <div className="field">
          <div>
            <div>Opponent speed</div>
            <div className="desc">How long the computer players take to act.</div>
          </div>
          <div className="segmented">
            {(["slow", "normal", "fast"] as BotSpeed[]).map((s) => (
              <button key={s} aria-pressed={settings.botSpeed === s} onClick={() => update({ botSpeed: s })}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
