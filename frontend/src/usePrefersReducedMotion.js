/** Tracks the OS reduced-motion preference, and keeps tracking it if the user
 * changes it while the page is open. */
import { useEffect, useState } from "react";

export function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(mq.matches);
    const on = (e) => setR(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return r;
}
