import { useEffect, useRef } from "react";

/**
 * ReadingReveal — the supplied scroll-reveal, carrying the argument for the product.
 *
 * Words dim until you scroll to them, so the reader is paced through a paragraph one
 * clause at a time. That only earns its scroll cost if the words are worth pacing, so
 * this holds the stakes - the thing the site otherwise states in a single line and
 * moves past.
 *
 * Two changes from the original, both about cost:
 *
 *  - It does not run through React. The supplied version calls setState on every frame
 *    of every scroll, re-rendering the whole paragraph sixty times a second to change
 *    the colour of one word. Here the loop writes to the spans directly, and only to
 *    the ones that actually crossed the threshold since the last frame - typically one
 *    or two, often none.
 *  - 5 segments over 260vh rather than 13 over 400vh plus a 100vh spacer. The original
 *    is a standalone page; this is one section of a site, and four screens of scrolling
 *    for a paragraph is a toll, not an effect.
 *
 * The 0.12 lerp toward the scroll target is kept as supplied - it is what stops words
 * snapping on and off when a trackpad reports a jittery delta.
 */
const SEGMENTS = [
  "A venue does not fail all at once.",
  "It fails at one doorway, about three minutes before anybody standing in it notices.",
  "By the time a counter reads full, the crowd behind it has nowhere left to go.",
  "Concourse watches every zone at once and names the one that is about to break.",
  "Then it moves people around it, while there is still room to move.",
];

export function ReadingReveal() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const words = Array.from(container.querySelectorAll("[data-word]"));
    const total = words.length;

    let raf = 0;
    let target = 0;
    let current = 0;
    let shown = -1;

    // Only the words that changed state get touched. Repainting all of them every frame
    // is what makes this kind of effect stutter on a laptop.
    //
    // The range is inclusive of `shown` at BOTH ends, which matters: on the previous
    // frame index `shown` was painted as the not-yet-revealed boundary word. Starting
    // the next range at shown+1 skipped it forever, so one word was stranded dim every
    // time the count advanced - and because the lerp decelerates, the stranded words got
    // closer together as the reveal slowed, which is what produced a line of alternating
    // dim and dark instead of a clean prefix.
    const paint = (count) => {
      if (count === shown) return;
      const from = Math.min(shown, count);
      const to = Math.max(shown, count);
      for (let i = Math.max(0, from); i <= Math.min(total - 1, to); i++) {
        const on = i < count;
        const el = words[i];
        if (!el) continue;
        el.style.color = on ? "var(--cf-ink)" : "var(--cf-line2)";
        el.style.opacity = on ? "1" : "0.55";
      }
      shown = count;
    };

    const tick = () => {
      current += (target - current) * 0.12;
      paint(Math.floor(current * total));
      if (Math.abs(target - current) > 0.001) {
        raf = requestAnimationFrame(tick);
      } else {
        current = target;
        paint(Math.floor(target * total));
        raf = 0;
      }
    };

    const onScroll = () => {
      const rect = container.getBoundingClientRect();
      // Reading happens a little above centre, so the reveal lands where the eye is
      // rather than at the bottom of the window.
      const eye = window.innerHeight * 0.62;
      const start = rect.top + window.scrollY - eye;
      const distance = rect.height || 1;
      target = Math.max(0, Math.min(1, (window.scrollY - start) / distance));
      if (!raf) raf = requestAnimationFrame(tick);
    };

    // One full pass before the range optimisation takes over, so every span is in a
    // known state regardless of what the refs were doing during mount.
    for (let i = 0; i < total; i++) {
      const el = words[i];
      if (el) { el.style.color = "var(--cf-line2)"; el.style.opacity = "0.55"; }
    }
    shown = 0;
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Indices are computed during render, not by a counter inside the ref callback.
  // A callback that increments shared state runs at commit time, so StrictMode's
  // double-invoke (detach with null, then reattach) would count every word twice.
  let offset = 0;
  const paragraphs = SEGMENTS.map((segment) => {
    const words = segment.split(" ").map((word, i) => ({ word, index: offset + i }));
    offset += words.length;
    return { segment, words };
  });

  // The paragraphs are pinned, not spread. Distributing five short lines down 150vh of
  // scroll put a screen of nothing between each one. The outer element supplies the
  // scroll runway and the inner one sticks in place, so the five lines stay together as
  // a single block that you read while the page moves under it.
  return (
    <div ref={containerRef} style={{ position: "relative", minHeight: "230vh" }}>
      <div className="max-w-4xl mx-auto px-6"
        style={{ position: "sticky", top: "20vh", display: "flex",
                 flexDirection: "column", gap: "var(--cf-s05)" }}>
        {paragraphs.map(({ segment, words }) => (
          <p key={segment} className="cf-display"
            style={{ fontSize: "clamp(var(--cf-t-h04), 2.9vw, var(--cf-t-h05))",
                     lineHeight: 1.1, fontWeight: 700 }}>
            {words.map(({ word, index }) => (
              <span key={index} data-word=""
                style={{ color: "var(--cf-line2)", opacity: 0.55,
                         transition: "color 300ms ease-out, opacity 300ms ease-out" }}>
                {word}{" "}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}

export default ReadingReveal;
