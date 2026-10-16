import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../store/gameStore";

/** Shows `value`, ticking smoothly to each new value instead of jumping. */
export function useCountUp(value: number, ms = 450): number {
  const reduceMotion = useGameStore((s) => s.settings.reduceMotion);
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduceMotion || typeof requestAnimationFrame !== "function") {
      from.current = value;
      setShown(value);
      return;
    }
    const begin = from.current;
    // Time from the frame clock only: performance.now() and rAF timestamps can disagree.
    let start: number | null = null;
    let frame = requestAnimationFrame(function tick(now) {
      start ??= now;
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - (1 - t) ** 3;
      const v = Math.round(begin + (value - begin) * eased);
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, ms, reduceMotion]);

  return shown;
}
