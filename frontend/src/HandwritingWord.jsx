import { useEffect, useRef, useState } from "react";
import * as opentype from "opentype.js";

/**
 * A word that writes itself, in the same hand it already appears in.
 *
 * The font is Shadows Into Light — the same face the page loads for its annotation voice
 * — but parsed from the raw TTF rather than used as a web font. That matters: a web font
 * renders as filled shapes with no outline to animate, so the only way to draw a letter
 * is to convert its glyphs to a path first. Same letterforms, same colour; only the way
 * it arrives is different.
 *
 * The word is split into one <path> per contour, and each is drawn on its own staggered
 * delay. That split is the whole trick: an SVG dash pattern RESTARTS at every subpath, so
 * a single path holding every letter cannot be drawn progressively - one long dash across
 * the lot simply makes each letter fully visible or fully absent, which is why both
 * earlier attempts produced a word that appeared complete at every moment. opentype emits
 * contours left to right, so staggering them by index reads as a pen moving across the
 * word.
 *
 * Each contour uses a measured dash rather than motion's `pathLength`: the normalised
 * values come out small relative to the real geometry and the pattern tiles along it,
 * giving a uniform faint outline instead of a stroke.
 *
 * The stroke only traces the shape; the weight comes from a filled copy of the whole word
 * underneath, faded in as the pen finishes. The fill has to be ONE path containing every
 * contour, because a glyph's counter - the hole in an e or an a - is a separate contour
 * whose emptiness depends on the fill rule seeing it and the outer contour together. Fill
 * the split paths individually and every letter comes out as a solid blob.
 */
const FONT_URL = "/fonts/ShadowsIntoLight.ttf";

// Parsed once for the life of the page and shared. Every word after the first draws with
// no fetch and no parse.
let fontPromise = null;
const loadFont = () => {
  if (!fontPromise) {
    fontPromise = fetch(FONT_URL)
      .then((r) => r.arrayBuffer())
      .then((buf) => opentype.parse(buf));
  }
  return fontPromise;
};

export function HandwritingWord({ text, duration = 1.5, delay = 0.05, strokeWidth = 1.6 }) {
  const [font, setFont] = useState(null);
  const [geom, setGeom] = useState(null);
  const [drawn, setDrawn] = useState(false);
  const pathRefs = useRef([]);
  const [lens, setLens] = useState([]);

  useEffect(() => {
    let cancelled = false;
    loadFont().then((f) => { if (!cancelled) setFont(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!font) return;
    const SIZE = 100;                     // arbitrary; the viewBox normalises it
    const p = font.getPath(text, 0, SIZE, SIZE);
    const b = p.getBoundingBox();
    const pad = SIZE * 0.12;              // room for the stroke and the descenders
    // Split on the moveto that begins each contour, keeping the M with its own segment.
    const full = p.toPathData(2);
    const contours = full.split(/(?=M)/).filter((d) => d.trim().length > 1);
    setGeom({
      full, contours,
      x: b.x1 - pad, y: b.y1 - pad,
      w: (b.x2 - b.x1) + pad * 2, h: (b.y2 - b.y1) + pad * 2,
    });
    setDrawn(false);
    setLens([]);
  }, [font, text]);

  useEffect(() => {
    if (!geom) return undefined;
    setLens(pathRefs.current.slice(0, geom.contours.length).map((el) => (el ? el.getTotalLength() : 0)));
    // Two frames: one to commit the full-length offsets with no transition, the next to
    // enable it and move to zero. Doing both in one commit gives nothing to animate from.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [geom]);

  // Until the font arrives, the word is set in the same face by CSS, so nothing pops in
  // or reflows when the drawn version replaces it.
  if (!geom) return <span className="cf-hand">{text}</span>;

  return (
    <svg viewBox={`${geom.x} ${geom.y} ${geom.w} ${geom.h}`} aria-hidden="true"
      style={{ height: "1.15em", width: `${(geom.w / geom.h) * 1.15}em`, overflow: "visible" }}>
      {/* The weight. One path, so the fill rule can hollow out the counters, held back
          until the pen has been across the word. */}
      <path d={geom.full} fill="currentColor" stroke="none"
        style={{
          opacity: drawn ? 1 : 0,
          transition: drawn
            ? `opacity 0.45s ease-out ${(delay + duration * 0.72).toFixed(3)}s`
            : "none",
        }} />
      {geom.contours.map((d, i) => {
        const len = lens[i] || 0;
        // The contours share the total duration between them, overlapping slightly so the
        // stroke reads as continuous rather than as letters switching on in turn.
        const each = duration / Math.max(1, geom.contours.length) * 2.4;
        const start = delay + (i / Math.max(1, geom.contours.length)) * duration;
        return (
          <path key={i} ref={(el) => { pathRefs.current[i] = el; }} d={d}
            fill="none" stroke="currentColor" strokeWidth={strokeWidth}
            strokeLinecap="round" strokeLinejoin="round"
            style={{
              strokeDasharray: len || 1,
              strokeDashoffset: drawn ? 0 : (len || 1),
              transition: drawn ? `stroke-dashoffset ${each.toFixed(3)}s ease-out ${start.toFixed(3)}s` : "none",
            }} />
        );
      })}
    </svg>
  );
}

export default HandwritingWord;
