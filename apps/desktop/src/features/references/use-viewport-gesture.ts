import { useCallback, useEffect, useRef, useState } from "react";

/** Release the compositor hint after the final zoom paint, including interrupted gestures. */
export function useViewportGesture() {
  const [moving, setMoving] = useState(false);
  const active = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useCallback(() => {
    clearTimeout(settle.current);
    if (!active.current) {
      active.current = true;
      setMoving(true);
    }
  }, []);
  const end = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (active.current) {
        active.current = false;
        setMoving(false);
      }
    }, 150);
  }, []);
  useEffect(() => {
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("blur", end);
      clearTimeout(settle.current);
    };
  }, [end]);
  return { moving, start, end };
}
