import { describe, expect, it } from "vitest";
import { findLoopPoints, loopPeriod } from "../musicLoop";

const SR = 1000; // low sample rate keeps synthetic buffers small

/** Builds a fake track: silence, steady "music", a linear fade-out, silence. */
function track({ lead = 0.2, body = 60, fade = 4, trail = 2 }) {
  const n = Math.round((lead + body + fade + trail) * SR);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let amp = 0;
    if (t >= lead && t < lead + body) amp = 0.1;
    else if (t >= lead + body && t < lead + body + fade) amp = 0.1 * (1 - (t - lead - body) / fade);
    d[i] = amp * Math.sin(i * 0.9);
  }
  return d;
}

describe("findLoopPoints", () => {
  it("skips leading silence and cuts before the ending fade and silence", () => {
    const p = findLoopPoints(track({}), SR);
    expect(p.start).toBeCloseTo(0.2, 1);
    // The fade starts at 60.2 s; the loop should end near there, well before the 66.2 s file end.
    expect(p.end).toBeGreaterThan(59.5);
    expect(p.end).toBeLessThan(63.5);
    expect(p.crossfade).toBe(3);
    expect(loopPeriod(p)).toBeCloseTo(p.end - p.start - 3, 6);
  });

  it("handles a track with no silence or fade", () => {
    const d = new Float32Array(30 * SR).map((_, i) => 0.1 * Math.sin(i * 0.9) + 0.05);
    const p = findLoopPoints(d, SR);
    expect(p.start).toBe(0);
    expect(p.end).toBeGreaterThan(29);
  });

  it("keeps the crossfade shorter than a quarter of a short loop", () => {
    const p = findLoopPoints(track({ body: 6, fade: 1, trail: 0.5 }), SR);
    expect(p.crossfade).toBeLessThanOrEqual((p.end - p.start) / 4 + 1e-9);
  });
});
