// Sound effects are synthesized with the Web Audio API (no files to ship).
// Background music is a single CC0 track in public/music, looped by musicLoop.ts.

import { findLoopPoints, MusicLoop } from "./musicLoop";

export type SoundName =
  // game
  | "deal"
  | "flip"
  | "chips"
  | "bigChips"
  | "check"
  | "fold"
  | "yourTurn"
  | "win"
  | "lose"
  | "allIn"
  // interface
  | "hover"
  | "click"
  | "confirm"
  | "select"
  | "tab"
  | "toggleOn"
  | "toggleOff"
  | "open"
  | "close"
  | "deny";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

let effectsVolume = 0.7;
let effectsOn = true;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null; // tests / very old webviews
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = effectsVolume;
  master.connect(ctx.destination);
  // 1 s of white noise, reused by every noisy effect.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this from any click or key press. */
export function unlockAudio(): void {
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().then(() => {
      if (musicWanted) void startMusic();
    });
  } else if (musicWanted) void startMusic();
}

export function configureEffects(opts: { on: boolean; volume: number }): void {
  effectsOn = opts.on;
  effectsVolume = opts.volume;
  if (master && ctx) master.gain.setTargetAtTime(effectsVolume, ctx.currentTime, 0.05);
}

// ---------------------------------------------------------------------------
// Building blocks

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", endFreq?: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

function noise(c: AudioContext, at: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, endFreq?: number, q = 1) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, at);
  if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.02);
}

/** One clay chip hitting another: a bright, quickly-decaying click. */
function clink(c: AudioContext, at: number, gain = 0.25) {
  const base = 2600 + Math.random() * 1800;
  tone(c, at, base, 0.05, gain, "triangle");
  tone(c, at, base * 1.52, 0.035, gain * 0.5, "sine");
  noise(c, at, 0.02, gain * 0.6, "highpass", 5000);
}

/** Slight random detune so repeated UI sounds don't feel robotic. */
const vary = (f: number, amount = 0.04) => f * (1 + (Math.random() * 2 - 1) * amount);

// ---------------------------------------------------------------------------

const EFFECTS: Record<SoundName, (c: AudioContext, t: number) => void> = {
  // ---- game ----
  deal: (c, t) => noise(c, t, 0.07, 0.35, "bandpass", 2400, 900, 0.8),
  flip: (c, t) => {
    noise(c, t, 0.05, 0.3, "bandpass", 3200, 1400, 1);
    tone(c, t + 0.03, 180, 0.05, 0.12, "sine");
  },
  chips: (c, t) => {
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) clink(c, t + i * (0.035 + Math.random() * 0.03), 0.2);
  },
  bigChips: (c, t) => {
    for (let i = 0; i < 9; i++) clink(c, t + i * (0.025 + Math.random() * 0.03), 0.18);
  },
  check: (c, t) => {
    // Two knuckle taps on the felt.
    for (const d of [0, 0.13]) {
      tone(c, t + d, 140, 0.09, 0.5, "sine", 70);
      noise(c, t + d, 0.03, 0.15, "lowpass", 900);
    }
  },
  fold: (c, t) => noise(c, t, 0.22, 0.22, "bandpass", 1800, 400, 0.7),
  yourTurn: (c, t) => {
    tone(c, t, 659, 0.35, 0.18, "sine");
    tone(c, t + 0.12, 988, 0.5, 0.16, "sine");
  },
  win: (c, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.09, f, 0.45, 0.16, "triangle"));
    for (let i = 0; i < 10; i++) clink(c, t + 0.35 + i * 0.04, 0.12);
  },
  lose: (c, t) => {
    tone(c, t, 392, 0.3, 0.1, "sine");
    tone(c, t + 0.15, 330, 0.45, 0.09, "sine");
  },
  allIn: (c, t) => {
    tone(c, t, 90, 0.4, 0.5, "sine", 45);
    for (let i = 0; i < 14; i++) clink(c, t + 0.05 + i * 0.022, 0.16);
  },

  // ---- interface: short, soft, and pitched so they sit under the game sounds ----
  hover: (c, t) => tone(c, t, vary(2200, 0.06), 0.03, 0.03, "sine"),
  click: (c, t) => {
    tone(c, t, vary(1100), 0.045, 0.11, "triangle", 700);
    noise(c, t, 0.015, 0.05, "highpass", 4000);
  },
  confirm: (c, t) => {
    tone(c, t, 784, 0.09, 0.13, "triangle");
    tone(c, t + 0.07, 1175, 0.16, 0.12, "triangle");
  },
  select: (c, t) => {
    clink(c, t, 0.12);
    tone(c, t, vary(880), 0.08, 0.07, "sine");
  },
  tab: (c, t) => tone(c, t, vary(1500), 0.04, 0.09, "triangle", 1250),
  toggleOn: (c, t) => {
    tone(c, t, 660, 0.06, 0.1, "triangle");
    tone(c, t + 0.05, 990, 0.08, 0.1, "triangle");
  },
  toggleOff: (c, t) => {
    tone(c, t, 990, 0.06, 0.09, "triangle");
    tone(c, t + 0.05, 620, 0.08, 0.09, "triangle");
  },
  open: (c, t) => {
    noise(c, t, 0.16, 0.08, "bandpass", 700, 2600, 1.2);
    tone(c, t + 0.04, 740, 0.12, 0.06, "sine", 1100);
  },
  close: (c, t) => {
    noise(c, t, 0.14, 0.07, "bandpass", 2400, 700, 1.2);
    tone(c, t, 1000, 0.1, 0.05, "sine", 650);
  },
  deny: (c, t) => {
    tone(c, t, 180, 0.08, 0.12, "square", 150);
    tone(c, t + 0.09, 150, 0.1, 0.1, "square", 120);
  },
};

/** Plays a sound, optionally delayed (seconds) so sequences don't pile up. */
export function play(name: SoundName, delay = 0): void {
  if (!effectsOn) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  EFFECTS[name](c, c.currentTime + delay);
}

/** A tick whose pitch follows a slider's position (0–1), for bet sizing. */
export function playSliderTick(position: number): void {
  if (!effectsOn) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  tone(c, c.currentTime, 500 + position * 900, 0.03, 0.06, "triangle");
}

// ---------------------------------------------------------------------------
// Music: one track, decoded once and looped seamlessly (see musicLoop.ts).

const MUSIC_URL = `${import.meta.env.BASE_URL}music/jazz-lounge.mp3`;
let musicWanted = false;
let musicVolume = 0.35;
let musicGain: GainNode | null = null;
let musicLoop: MusicLoop | null = null;
let musicBuffer: Promise<AudioBuffer | null> | null = null;

function loadMusic(c: AudioContext): Promise<AudioBuffer | null> {
  musicBuffer ??= fetch(MUSIC_URL)
    .then((r) => r.arrayBuffer())
    .then((data) => c.decodeAudioData(data))
    .catch(() => null);
  return musicBuffer;
}

/** Dev/testing only: ?musicrate=10 plays music 10× faster so a loop can be heard quickly. */
const musicRate = (() => {
  if (!import.meta.env.DEV || typeof location === "undefined") return 1;
  return Number(new URLSearchParams(location.search).get("musicrate")) || 1;
})();

async function startMusic() {
  const c = audio();
  if (!c || c.state !== "running" || musicLoop) return;
  if (!musicGain) {
    // Music has its own volume, separate from sound effects.
    musicGain = c.createGain();
    musicGain.connect(c.destination);
  }
  const buffer = await loadMusic(c);
  if (!buffer || !musicWanted || musicLoop) return;
  musicGain.gain.cancelScheduledValues(c.currentTime);
  musicGain.gain.setValueAtTime(0, c.currentTime);
  musicGain.gain.linearRampToValueAtTime(musicVolume, c.currentTime + 1.5);
  musicLoop = new MusicLoop(c, buffer, musicGain, findLoopPoints(buffer.getChannelData(0), buffer.sampleRate), musicRate);
  musicLoop.start();
  if (import.meta.env.DEV) (globalThis as { __music?: MusicLoop }).__music = musicLoop;
}

function stopMusic() {
  if (!ctx || !musicGain || !musicLoop) return;
  const loop = musicLoop;
  musicLoop = null;
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  setTimeout(() => loop.stop(), 900);
}

export function configureMusic(opts: { on: boolean; volume: number }): void {
  musicVolume = opts.volume;
  musicWanted = opts.on;
  if (musicWanted) {
    if (musicLoop && ctx && musicGain) musicGain.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.1);
    else {
      // Turning music on is a click, so the audio context may be allowed to start now.
      const c = audio();
      if (c && c.state === "suspended") void c.resume().then(startMusic);
      else void startMusic();
    }
  } else stopMusic();
}
