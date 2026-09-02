import { useEffect, useRef } from "react";

import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js";

/**
 * A blurred spectrum that rises out of the floor of the footer as the page ends.
 *
 * Absolutely positioned inside the footer, so it occupies the footer's own space and
 * is genuinely off screen until the reader scrolls there - nothing is pinned to the
 * viewport.
 *
 * Its height tracks scroll continuously rather than switching on at a threshold: the
 * band is scaled by how much of its own box has entered the viewport, so it is a
 * sliver when the footer first appears and reaches full height exactly at the last
 * pixel of scroll. A threshold reveal looks wrong here because the band is taller than
 * half the viewport, so the trigger fires while the reader is still well short of the
 * bottom and the spectrum is already fully bloomed.
 */
export function GradientGlow({ height = "42vh", bars = 15, blur = 18, peak = 0.99, valley = 0.66 }) {
  const boxRef = useRef(null);     // measured, never transformed
  const bandRef = useRef(null);    // transformed, never measured
  const reduced = usePrefersReducedMotion();

  const VBW = 1271, VBH = 599;
  const uid = "cf-glow";

  useEffect(() => {
    const box = boxRef.current;
    const band = bandRef.current;
    if (!box || !band) return undefined;

    // A spectrum that grows as you scroll is exactly what the preference is about,
    // so reduced motion simply gets the finished state.
    if (reduced) {
      band.style.transform = "scaleY(1)";
      return undefined;
    }

    const win = box.ownerDocument.defaultView ?? window;
    let queued = false;

    // Written straight to the node. This runs on every scroll frame, and putting one
    // transform through React state would re-render the page tree sixty times a second.
    const measure = () => {
      queued = false;
      const rect = box.getBoundingClientRect();
      const h = rect.height || 1;
      const entered = win.innerHeight - rect.top;   // how much of the band is above the fold
      const t = Math.max(0, Math.min(1, entered / h));
      band.style.transform = `scaleY(${t.toFixed(4)})`;
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      win.requestAnimationFrame(measure);
    };

    measure();
    win.addEventListener("scroll", onScroll, { passive: true });
    win.addEventListener("resize", onScroll, { passive: true });
    return () => {
      win.removeEventListener("scroll", onScroll);
      win.removeEventListener("resize", onScroll);
    };
  }, [reduced]);

  // Short at the edges, tallest in the middle, so the band reads as one soft mass
  // rather than as nine separate columns.
  const mid = (bars - 1) / 2;
  const heights = Array.from({ length: bars }, (_, i) => {
    const t = mid === 0 ? 0 : Math.abs(i - mid) / mid;
    return peak * VBH * (valley + (1 - valley) * (1 - Math.pow(t, 1.7)));
  });
  const colW = VBW / bars;

  // The reference's structure exactly - deep colour at the floor, a pale band through
  // the middle, hot at the top, fading out - in the page's own palette instead of a
  // stock spectrum. The pale band at 0.42 is what makes it read as light rather than as
  // paint: without a near-white step the whole thing muddies into one brown.
  // Each colour is emitted at BOTH ends of its band, so the ramp is a step function and
  // the boundaries are hard. A single stop per colour gives a smooth blend across the
  // whole height, which is what was reading as blur - the filter was never the problem.
  const BANDS = [
    "#1E2A35", "#4E6B87", "#9CBBD6", "#F4F0E6",
    "#E8BC6A", "#96661F", "#C9613F", "#8A3A26",
  ];
  const STOPS = [];
  BANDS.forEach((color, i) => {
    STOPS.push({ offset: +(i / BANDS.length).toFixed(4), color, k: `${i}a` });
    STOPS.push({ offset: +((i + 1) / BANDS.length).toFixed(4), color, k: `${i}b` });
  });
  // The top band fades out rather than ending on a line.
  STOPS.push({ offset: 1, color: "#8A3A2600", k: "end" });

  return (
    <div ref={boxRef} aria-hidden="true"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height, pointerEvents: "none" }}>
      <div ref={bandRef}
        style={{
          height: "100%", transformOrigin: "bottom",
          transform: "scaleY(0)", willChange: "transform",
        }}>
        <svg style={{ height: "100%", width: "100%", display: "block" }}
          viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="none" fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id={`grad-${uid}`} x1="0" y1="1" x2="0" y2="0">
              {STOPS.map((st) => <stop key={st.k} offset={st.offset} stopColor={st.color} />)}
            </linearGradient>
            <filter id={`blur-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={blur} />
            </filter>
          </defs>
          {/* Overwidth on purpose: under the blur the columns merge into one soft mass
              rather than reading as nine separate bars. */}
          {heights.map((barH, i) => (
            <g key={i} filter={`url(#blur-${uid})`}>
              <rect x={i * colW} y={VBH - barH} width={colW * 1.23} height={barH}
                fill={`url(#grad-${uid})`} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/** Height of the glow band, and therefore the room the footer reserves for it. */
export const GLOW_HEIGHT = "42vh";

