import { useEffect, useRef } from "react";

/**
 * WaveField — the supplied component's field, rebuilt as the page backdrop.
 *
 * The wave maths are kept exactly: 32 lines, 100 points each, the same two summed
 * sinusoids, and the same 250px pointer well that pushes the lines away from the cursor.
 * What changes is everything around it, because a full-viewport backdrop is a different
 * object to a 400px card:
 *
 *  - Fixed to the viewport and pointer-transparent, so it sits behind the whole page
 *    instead of being a bordered panel with a headline in it. The card's chrome - the
 *    freeze button, the mix-blend headline, the rounded border - has no meaning here.
 *  - The pointer is tracked on the window rather than on the element. A backdrop cannot
 *    receive mouse events without stealing them from the page, so it reads clientX/Y
 *    directly; the canvas is fixed at the viewport origin, so no rect offset is needed.
 *  - Colours come from the theme rather than a `dark` class. The lines are ink at low
 *    alpha on paper, and are re-read on resize so a token change reaches them.
 *
 * Cost control, since unlike a card this never scrolls out of view and would otherwise
 * run for the life of the page: the loop stops entirely when the tab is hidden, and
 * device pixel ratio is capped at 2 so a high-DPI screen does not quadruple the fill.
 */
export function WaveField() {
  const canvasRef = useRef(null);
  const pointerRef = useRef({ x: -2000, y: -2000, targetX: -2000, targetY: -2000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return undefined;

    // Reduced motion slows the field rather than freezing it. A frozen field would be a
    // static line drawing, which is a different design; and like the text shimmer, this
    // is a slow ambient drift rather than something travelling across the screen.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const STEP = reduced ? 0.004 : 0.015;

    let animId = 0;
    let time = 0;
    let width = 0;
    let height = 0;
    let paper = "#F7F4EE";
    let ink = "17, 15, 13";

    const readTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      paper = cs.getPropertyValue("--cf-bg").trim() || paper;
      const hex = (cs.getPropertyValue("--cf-ink").trim() || "#211E1A").replace("#", "");
      if (hex.length === 6) {
        ink = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
      }
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      readTheme();
    };
    resize();

    const render = () => {
      time += STEP;
      const pointer = pointerRef.current;
      pointer.x += (pointer.targetX - pointer.x) * 0.1;
      pointer.y += (pointer.targetY - pointer.y) * 0.1;

      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, width, height);

      const lines = 32;
      const stepY = height / (lines + 1);
      const points = 100;
      const stepX = width / points;

      for (let i = 0; i < lines; i++) {
        const yBase = stepY * (i + 1);
        ctx.beginPath();
        for (let p = 0; p <= points; p++) {
          const x = p * stepX;
          const dx = x - pointer.x;
          const dy = yBase - pointer.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const influence = dist < 250 ? (1 - dist / 250) * 35 : 0;

          const wave = Math.sin(p * 0.1 + time + i * 0.2) * 18
            + Math.cos(p * 0.05 - time * 0.8) * 12;
          const y = yBase + wave - influence;

          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        // Faint at the top, firmer toward the floor, so the page has a horizon.
        // Scaled well down from the card's values: as a backdrop this sits under body
        // copy, and the original's 0.47 top alpha would compete with the text.
        const alpha = 0.07 + (i / lines) * 0.21;
        ctx.strokeStyle = `rgba(${ink}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    const start = () => { if (!animId) animId = requestAnimationFrame(render); };
    const stop = () => { cancelAnimationFrame(animId); animId = 0; };
    const onVisibility = () => (document.hidden ? stop() : start());

    const onMove = (e) => {
      pointerRef.current.targetX = e.clientX;
      pointerRef.current.targetY = e.clientY;
    };
    const onLeave = () => {
      pointerRef.current.targetX = -2000;
      pointerRef.current.targetY = -2000;
    };

    start();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="cf-wavefield" aria-hidden="true" />;
}

export default WaveField;
