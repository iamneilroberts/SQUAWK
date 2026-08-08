/*
 * The one impure piece of the responsive layer: reads the live viewport size from the
 * browser and re-renders on resize/orientation change. All the DECISIONS live in the pure,
 * unit-tested helpers in viewport.ts; this hook only supplies the numbers. It is therefore
 * browser-verified, not unit-tested (the codebase avoids jsdom, spec §8).
 */
import { useEffect, useState } from "react";

export type ViewportSize = { width: number; height: number };

function currentSize(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useViewport(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(currentSize);
  useEffect(() => {
    const onChange = () => setSize(currentSize());
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);
  return size;
}
