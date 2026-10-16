/**
 * Seamless looping for a music track that has silence and a fade-out at its
 * edges (most "loop" MP3s do: encoder padding plus an ending fade).
 *
 * Instead of AudioBufferSourceNode.loop, which would play the fade and the
 * silence every time, we find where the music really starts and where its
 * ending fade begins, then start the next copy a little early and crossfade.
 */

export interface LoopPoints {
  /** Seconds: first audible sample. */
  start: number;
  /** Seconds: where the ending fade-out begins (or the last audible sample). */
  end: number;
  /** Seconds of overlap between one pass and the next. */
  crossfade: number;
}

/** Root-mean-square loudness of a window of samples. */
function rms(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function findLoopPoints(data: Float32Array, sampleRate: number, silence = 0.003): LoopPoints {
  let head = 0;
  while (head < data.length && Math.abs(data[head]) < silence) head++;
  let tail = data.length - 1;
  while (tail > head && Math.abs(data[tail]) < silence) tail--;

  // Loudness in half-second windows, to find where the ending fade starts:
  // the last point (scanning backwards) where the music is still at a quarter
  // of its typical (median) level.
  const win = Math.round(sampleRate / 2);
  const levels: number[] = [];
  for (let i = head; i + win <= tail; i += win) levels.push(rms(data, i, i + win));
  const median = [...levels].sort((a, b) => a - b)[levels.length >> 1] ?? 0;
  let endIdx = levels.length - 1;
  while (endIdx > 0 && levels[endIdx] < median * 0.25) endIdx--;

  const start = head / sampleRate;
  const end = Math.max(start + 1, (head + (endIdx + 1) * win) / sampleRate);
  const length = end - start;
  return { start, end, crossfade: Math.min(3, length / 4) };
}

/**
 * Seconds between the starts of consecutive passes: the next pass begins
 * `crossfade` seconds before the current one reaches `end`.
 */
export const loopPeriod = (p: LoopPoints): number => p.end - p.start - p.crossfade;

/** Plays a decoded buffer forever with crossfaded loops. */
export class MusicLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sources: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  /** Audio-clock start time of every pass so far (for verifying the loop). */
  readonly passStarts: number[] = [];
  get passes(): number {
    return this.passStarts.length;
  }

  constructor(
    private ctx: AudioContext,
    private buffer: AudioBuffer,
    private output: AudioNode,
    readonly points: LoopPoints,
    /** Playback speed; only changed for testing so a loop can be observed quickly. */
    private rate = 1,
  ) {}

  start(): void {
    this.stop();
    this.schedulePass(this.ctx.currentTime + 0.05, true);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    for (const { src, gain } of this.sources) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.05);
      src.stop(now + 0.3);
    }
    this.sources = [];
  }

  private schedulePass(at: number, first: boolean): void {
    const { start, end, crossfade } = this.points;
    const length = (end - start) / this.rate; // wall-clock seconds
    const fade = crossfade / this.rate;

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    const gain = this.ctx.createGain();
    // Fade in (the very first pass gets a quick fade so it doesn't click),
    // hold, then fade out over the crossfade window at the end.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + (first ? 0.05 : fade));
    gain.gain.setValueAtTime(1, at + length - fade);
    gain.gain.linearRampToValueAtTime(0, at + length);
    src.connect(gain).connect(this.output);
    src.start(at, start);
    src.stop(at + length + 0.05);
    this.passStarts.push(at);

    const entry = { src, gain };
    this.sources.push(entry);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== entry);
    };

    // Queue the next pass (to begin as this one starts fading out) as soon as
    // this one starts, so it's always booked ~2 minutes ahead on the audio
    // clock. Browsers throttle timers in background windows; this lead time
    // means a late timer can never cause a gap.
    const next = at + length - fade;
    const wait = Math.max(0, (at - this.ctx.currentTime) * 1000);
    this.timer = setTimeout(() => this.schedulePass(next, false), wait);
  }
}
