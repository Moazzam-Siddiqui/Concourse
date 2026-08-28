import React, {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { api } from "./src/api.js";
import {
  emailError, passwordChecks, passwordError, passwordAcceptable, passwordStrength,
} from "./src/credentials.js";
import { useConcourse } from "./src/useConcourse.js";
import { toMapVenue } from "./src/venueAdapter.js";
import sampleVenue from "./src/sampleVenue.json";
import LayoutStudio from "./src/LayoutStudio.jsx";
import {
  TRAFFIC_BANDS, planRoute, rankHazards, hazardWarning, trafficBand,
} from "./src/crowdRouting.js";
import {
  normaliseCode, codeError, suggestCode, resolveSessionForCode,
} from "./src/venueCode.js";
import {
  DoorOpen, Footprints, UtensilsCrossed, Armchair, LogOut, TrendingUp,
  TrendingDown, Minus, Radio, Zap, AlertTriangle, ChevronLeft,
  ChevronRight, ChevronDown, MoveRight, Menu, X, Users, Activity, Cpu,
  Network, Gauge, Layers, ShieldCheck, Boxes, GitBranch, Check, Plus,
  MapPin, Map, Route, Navigation, Crosshair, Upload, Building2, UserCog, Ticket,
  Plus as PlusIcon, Minus as MinusIcon, Locate, Search, Bell, Trash2,
  Eye, Lock, Mail, ArrowRight, Wifi, WifiOff, Droplets, Coffee, Smartphone,
  CircleCheck, CircleX,
} from "lucide-react";

/* ============================================================================
   GradientShimmer — supplied component, ported TSX → JS, logic unchanged.
   ========================================================================== */

export const gradientPresets = {
  sunrise: [
    { color: "#B6D3EF", position: 0 }, { color: "#CAD1D7", position: 0.153 },
    { color: "#D7CFC8", position: 0.252 }, { color: "#E1CDB9", position: 0.341 },
    { color: "#EAC6A5", position: 0.424 }, { color: "#EDB185", position: 0.505 },
    { color: "#EF9B62", position: 0.586 }, { color: "#F18F60", position: 0.669 },
    { color: "#F48D7A", position: 0.758 }, { color: "#F78A94", position: 0.857 },
    { color: "#F888A0", position: 1 },
  ],
  ember: [
    { color: "#FFD9A0", position: 0 }, { color: "#FFAE4D", position: 0.28 },
    { color: "#FF6A00", position: 0.55 }, { color: "#E10600", position: 0.8 },
    { color: "#8E1B4A", position: 1 },
  ],
  bay: [
    { color: "#DBE3D0", position: 0 }, { color: "#8DB8A7", position: 0.23 },
    { color: "#2D8E9A", position: 0.42 }, { color: "#076492", position: 0.59 },
    { color: "#154288", position: 0.79 }, { color: "#262C81", position: 1 },
  ],
};

export const easingPresets = {
  smooth: "cubic-bezier(0.45, 0, 0.55, 1)",
  gentle: "cubic-bezier(0.76, 0, 0.24, 1)",
  snappy: "cubic-bezier(0.3, 0, 0.2, 1)",
};

const BAND_CORE_RATIO = 0.44;

export function buildBandGradient(stops, angle) {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const first = sorted[0]?.color ?? "white";
  const last = sorted[sorted.length - 1]?.color ?? "white";
  const core = sorted.map((s) => {
    const f = (s.position - 0.5) * 2 * BAND_CORE_RATIO;
    return `${s.color} calc(50% + var(--gs-spread-mid) * ${f.toFixed(4)})`;
  }).join(", ");
  return [
    `linear-gradient(${angle}deg`,
    `var(--gs-base) calc(50% - var(--gs-spread))`,
    `color-mix(in oklab, var(--gs-base) 42%, ${first}) calc(50% - var(--gs-spread-mid))`,
    core,
    `color-mix(in oklab, var(--gs-base) 42%, ${last}) calc(50% + var(--gs-spread-mid))`,
    `var(--gs-base) calc(50% + var(--gs-spread)))`,
  ].join(", ");
}

const supportsClip = () => typeof window === "undefined" ? true :
  typeof window.CSS?.supports === "function" &&
  (window.CSS.supports("background-clip", "text") || window.CSS.supports("-webkit-background-clip", "text"));

const reducedNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function observeShimmerActive(el, { pauseOnScroll, pauseWhenOffscreen }, onChange) {
  if (typeof window === "undefined") return () => {};
  let inViewport = !pauseWhenOffscreen || typeof IntersectionObserver === "undefined";
  let pageVisible = typeof document === "undefined" ? true : !document.hidden;
  let notScrolling = true;
  const compute = () => onChange(inViewport && pageVisible && notScrolling);
  let io;
  if (pauseWhenOffscreen && typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((es) => {
      const e = es[es.length - 1]; if (!e) return;
      inViewport = e.isIntersecting; compute();
    }, { rootMargin: "160px" });
    io.observe(el);
  }
  const onVis = () => { pageVisible = !document.hidden; compute(); };
  document.addEventListener("visibilitychange", onVis);
  let timer;
  const onScroll = () => {
    notScrolling = false; compute();
    clearTimeout(timer);
    timer = setTimeout(() => { notScrolling = true; compute(); }, 120);
  };
  if (pauseOnScroll) window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  compute();
  return () => {
    io?.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    if (pauseOnScroll) window.removeEventListener("scroll", onScroll, { capture: true });
    clearTimeout(timer);
  };
}

const MAX_SPREAD_PX = 48, SPREAD_MID_RATIO = 0.72, BASE_FONT_PX = 14;

export function GradientShimmer({
  children, gradient, easing = "smooth", duration = 1.45, spread = 3, angle = 105,
  pauseBetween = 1000, baseColor = "currentColor", pauseOnScroll = true,
  pauseWhenOffscreen = true, respectReducedMotion = true, as = "span", className, style, ...rest
}) {
  const ref = useRef(null);
  const stops = useMemo(() => (typeof gradient === "string" ? gradientPresets[gradient] ?? gradientPresets.sunrise : gradient ?? gradientPresets.sunrise), [gradient]);
  const backgroundImage = useMemo(() => buildBandGradient(stops, angle), [stops, angle]);
  const easingValue = easingPresets[easing] ?? easingPresets.smooth;
  const initialSpread = Math.min(children.length * spread, MAX_SPREAD_PX);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width || 96;
      const fs = Number.parseFloat(getComputedStyle(el).fontSize) || BASE_FONT_PX;
      const scale = fs / BASE_FONT_PX;
      const spreadPx = Math.min(children.length * spread * scale, MAX_SPREAD_PX * scale);
      const layerW = Math.max(1, w + spreadPx * 2);
      el.style.setProperty("--gs-spread", `${spreadPx}px`);
      el.style.setProperty("--gs-spread-mid", `${spreadPx * SPREAD_MID_RATIO}px`);
      el.style.backgroundSize = `${layerW}px 100%`;
      return { start: -spreadPx - layerW / 2, end: w + spreadPx - layerW / 2, durationMs: duration * 1000 };
    };
    if (!supportsClip()) {
      el.style.removeProperty("background-image");
      el.style.removeProperty("-webkit-text-fill-color");
      return;
    }
    measure();
    if (respectReducedMotion && reducedNow()) return;
    if (typeof el.animate !== "function") return;

    let anim = null, timer, active = true, cancelled = false;
    const run = () => {
      if (cancelled) return;
      const { start, end, durationMs } = measure();
      const next = el.animate(
        [{ backgroundPosition: `${start}px center` }, { backgroundPosition: `${end}px center` }],
        { duration: durationMs, easing: easingValue, fill: "forwards" });
      if (!active) next.pause();
      anim?.cancel(); anim = next;
      next.onfinish = () => { timer = setTimeout(run, Math.max(0, pauseBetween)); };
    };
    const stop = observeShimmerActive(el, { pauseOnScroll, pauseWhenOffscreen }, (n) => {
      active = n; if (anim) { if (active) anim.play(); else anim.pause(); }
    });
    run();
    return () => { cancelled = true; anim?.cancel(); clearTimeout(timer); stop(); };
  }, [children, spread, duration, easingValue, pauseBetween, pauseOnScroll, pauseWhenOffscreen, respectReducedMotion]);

  return createElement(as, {
    ...rest, ref, className,
    style: {
      position: "relative", display: "inline-block", backgroundImage,
      backgroundRepeat: "no-repeat", backgroundSize: "100% 100%",
      backgroundColor: "var(--gs-base)", WebkitBackgroundClip: "text",
      backgroundClip: "text", WebkitTextFillColor: "transparent",
      "--gs-base": baseColor, "--gs-spread": `${initialSpread}px`,
      "--gs-spread-mid": `${initialSpread * SPREAD_MID_RATIO}px`, ...style,
    },
  }, children);
}

/* ============================================================================
   Design tokens — red / orange / deep blue on near-black, with the soft
   mesh-gradient field the modern SaaS sites use.
   ========================================================================== */

const STYLE = `
  :root{
    --cf-bg:#05070B; --cf-panel:#0B1018; --cf-card:#111826; --cf-card-hi:#182234;
    --cf-line:#1E2A3D; --cf-line2:#2A3852;
    --cf-ink:#EEF2F8; --cf-dim:#A8A39F; --cf-dim2:#8D8884;
    --cf-red:#E10600;
  /* Brand red is a fill colour. On a dark ground it only reaches 4.06:1 as text, so red
     type uses this lifted tint (4.50:1) while every fill, gradient and glow keeps the brand. */
  --cf-red-text:#FF3B35; --cf-orange:#FF6A00; --cf-amber:#FFB020;
    --cf-blue:#1B4FA8; --cf-blue-lo:#0C1B33; --cf-blue-hi:#4D8DF0;
    --cf-green:#00C853;
    /* Entrance/exit signage. Green in, violet out — the pairing reads at a glance and does not
       collide with the density ramp, which owns green→amber→orange→red. */
    --cf-violet:#A855F7;

    /* Elevation ramp. Shadows are tuned dark and wide rather than black and tight: on a
       near-black ground a tight shadow is invisible, so lift has to come from spread. */
    --cf-shadow-sm:0 2px 8px -2px rgba(0,0,0,.6);
    --cf-shadow-md:0 18px 46px -22px rgba(0,0,0,.78);
    --cf-shadow-lg:0 40px 90px -40px rgba(0,0,0,.9);
    --cf-glow-ember:0 0 0 1px rgba(255,106,0,.22), 0 18px 50px -24px rgba(225,6,0,.55);

    /* One easing for everything that moves, so the whole UI decelerates with the same hand. */
    --cf-ease:cubic-bezier(0.16,1,0.3,1);
  }
  .cf-root{ background:var(--cf-bg); color:var(--cf-ink); font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif; position:relative; min-height:100vh; }
  .cf-display{ font-family:'Big Shoulders Display','Arial Narrow',sans-serif; }
  .cf-accent{ font-family:'Rajdhani','JetBrains Mono',sans-serif; font-weight:600; letter-spacing:0.16em; }
  .cf-mono{ font-family:'JetBrains Mono','SFMono-Regular',Menlo,monospace; }

  .cf-panel{ background:var(--cf-panel); }
  .cf-card{ background:
      linear-gradient(160deg, rgba(255,244,236,.05) 0%, rgba(255,244,236,0) 42%),
      linear-gradient(168deg, rgba(30,26,24,.68), rgba(17,15,14,.76));
    border:1px solid rgba(255,238,228,.09); border-top-color:rgba(255,240,230,.15);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.06);
    backdrop-filter:blur(18px) saturate(130%); transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
  .cf-card-solid{ background:var(--cf-card); border:1px solid var(--cf-line); }
  .cf-lift:hover{ transform:translateY(-3px); border-color:var(--cf-line2); box-shadow:0 18px 46px -22px rgba(0,0,0,0.75); }
  .cf-hairline{ border-color:var(--cf-line); }
  .cf-dim{ color:var(--cf-dim); } .cf-dim2{ color:var(--cf-dim2); }
  .cf-red{ color:var(--cf-red-text); } .cf-orange{ color:var(--cf-orange); }
  .cf-amber{ color:var(--cf-amber); } .cf-green{ color:var(--cf-green); }
  .cf-blue-hi{ color:var(--cf-blue-hi); }
  .cf-bg-red{ background:var(--cf-red); }

  /* Mesh gradient field — fixed, soft, slow. The "lovable-style" backdrop. */
  .cf-mesh{ position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }
  .cf-mesh span{ position:absolute; border-radius:9999px; filter:blur(90px); opacity:.5; will-change:transform; }
  .cf-mesh .m1{ width:52vw; height:52vw; left:-12vw; top:-14vw; background:radial-gradient(circle, rgba(225,6,0,0.55), transparent 68%); animation:cf-drift1 26s ease-in-out infinite alternate; }
  .cf-mesh .m2{ width:46vw; height:46vw; right:-10vw; top:4vh; background:radial-gradient(circle, rgba(255,106,0,0.42), transparent 68%); animation:cf-drift2 32s ease-in-out infinite alternate; }
  .cf-mesh .m3{ width:60vw; height:60vw; left:10vw; top:38vh; background:radial-gradient(circle, rgba(27,79,168,0.55), transparent 70%); animation:cf-drift3 38s ease-in-out infinite alternate; }
  .cf-mesh .m4{ width:38vw; height:38vw; right:6vw; top:62vh; background:radial-gradient(circle, rgba(77,141,240,0.28), transparent 70%); animation:cf-drift1 30s ease-in-out infinite alternate-reverse; }
  /* Paper Shaders grain gradient. Sits directly above the CSS mesh and below the veil, so it
     replaces the mesh visually once it loads without either layer having to know about the
     other. Fades in because the shader chunk arrives after first paint and a hard swap of the
     whole page backdrop reads as a flash. */
  .cf-shader{ position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden;
    opacity:0; animation:cf-shader-in 1.2s var(--cf-ease) forwards; }
  @keyframes cf-shader-in{ to{ opacity:1; } }

  /* The veil that keeps body copy readable over the backdrop.
     Tuned against the shader, not the old CSS mesh: at the previous 0.55→0.94 ramp it was
     near-opaque black by mid-page and the gradient underneath simply could not be seen. It
     now stays light enough for the field to read through, and the pages that need the most
     protection get it from their own card surfaces instead. */
  .cf-mesh-veil{ position:fixed; inset:0; z-index:0; pointer-events:none;
    background:linear-gradient(180deg, rgba(5,7,11,0.46) 0%, rgba(5,7,11,0.62) 45%, rgba(5,7,11,0.74) 100%); }

  /* With the veil lightened, long-form text needs its own local protection so it never sits
     directly on a bright band of the gradient. Applied to page roots that are mostly prose. */
  .cf-readable{ position:relative; }
  .cf-readable::before{ content:''; position:absolute; inset:0; z-index:-1; pointer-events:none;
    background:radial-gradient(120% 60% at 50% 0%, rgba(5,7,11,.55), rgba(5,7,11,.82) 70%); }

  @keyframes cf-drift1{ from{ transform:translate3d(0,0,0) scale(1); } to{ transform:translate3d(6vw,7vh,0) scale(1.12); } }
  @keyframes cf-drift2{ from{ transform:translate3d(0,0,0) scale(1.05); } to{ transform:translate3d(-7vw,5vh,0) scale(.92); } }
  @keyframes cf-drift3{ from{ transform:translate3d(0,0,0) scale(.95); } to{ transform:translate3d(5vw,-8vh,0) scale(1.1); } }

  .cf-grain{ position:fixed; inset:0; z-index:1; pointer-events:none; opacity:.045; mix-blend-mode:overlay; }

  .cf-btn-primary{ background:linear-gradient(100deg, var(--cf-red), var(--cf-orange)); color:#fff; transition:filter .2s ease, transform .2s ease; box-shadow:0 8px 24px -12px rgba(225,6,0,.9); }
  .cf-btn-primary:hover{ filter:brightness(1.1); transform:translateY(-1px); }
  .cf-btn-outline{ border:1px solid var(--cf-line2); color:var(--cf-ink); background:rgba(17,24,38,0.5); transition:all .2s ease; }
  .cf-btn-outline:hover{ border-color:var(--cf-dim); background:var(--cf-card-hi); }
  .cf-btn-ghost{ color:var(--cf-dim); transition:color .2s ease; }
  .cf-btn-ghost:hover{ color:var(--cf-ink); }
  .cf-focus:focus-visible{ outline:2px solid var(--cf-orange); outline-offset:2px; }

  .cf-input{ background:rgba(5,7,11,0.6); border:1px solid var(--cf-line); color:var(--cf-ink); transition:border-color .2s ease, box-shadow .2s ease; }
  .cf-input:focus{ outline:none; border-color:var(--cf-orange); box-shadow:0 0 0 3px rgba(255,106,0,.14); }

  /* --- Portal identity ------------------------------------------------------
     The three portals are one product but not one job: an attendee stuck in a
     queue, an organiser running the event from a desk, and platform operations
     watching every venue at once. Marketing already gives each a colour; inside
     the portal that colour only reached a badge in the corner, so all three read
     as the same screen with different words on it.

     Declaring the accent once per portal and having the shared controls read it
     from a variable moves the whole surface instead: primary action, focus ring,
     field focus and rails all shift together. One mechanism, three rooms — and
     the focus ring now matches the portal a keyboard user is actually in. */
     --portal-accent is the identity: focus rings, field focus, rails. It stays vivid,
     because none of those carry text on top of them.

     --portal-cta is the lit end of the primary button's gradient, and it is a shade deeper
     on purpose. The button's label is white, and white on the vivid accent lands at
     2.9-3.5:1 — under AA on the one control the whole portal is pointing at. These values
     are the least darkening that clears 4.5:1, so the button stays the portal's colour and
     the label stays readable. Scoped to portals only: the marketing CTA is the brand's own
     racing orange and is not this file's call to dull. */
  [data-portal]{ --portal-accent:var(--cf-orange); --portal-accent-deep:var(--cf-red);
    --portal-cta:#C75300; --portal-glow:rgba(255,106,0,.85); --portal-ring:rgba(255,106,0,.16); }
  [data-portal="walker"]{ --portal-accent:var(--cf-blue-hi); --portal-accent-deep:var(--cf-blue);
    --portal-cta:#2271EC; --portal-glow:rgba(77,141,240,.85); --portal-ring:rgba(77,141,240,.20); }
  [data-portal="client"]{ --portal-accent:var(--cf-orange); --portal-accent-deep:var(--cf-red);
    --portal-cta:#C75300; --portal-glow:rgba(255,106,0,.85); --portal-ring:rgba(255,106,0,.16); }
  [data-portal="admin"]{ --portal-accent:var(--cf-red-text); --portal-accent-deep:#8E1512;
    --portal-cta:#EE0700; --portal-glow:rgba(255,59,53,.8); --portal-ring:rgba(255,59,53,.18); }

  [data-portal] .cf-btn-primary{
    background:linear-gradient(100deg, var(--portal-accent-deep), var(--portal-cta));
    box-shadow:0 8px 24px -12px var(--portal-glow); }
  [data-portal] .cf-focus:focus-visible{ outline-color:var(--portal-accent); }
  [data-portal] .cf-input:focus{ border-color:var(--portal-accent); box-shadow:0 0 0 3px var(--portal-ring); }
  .cf-input::placeholder{ color:var(--cf-dim2); }

  .cf-chip{ background:rgba(255,255,255,0.04); border:1px solid var(--cf-line); }

  @keyframes cf-marquee{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
  .cf-marquee-track{ animation:cf-marquee 30s linear infinite; }
  @keyframes cf-dash{ to{ stroke-dashoffset:-40; } }
  .cf-dash{ stroke-dasharray:6 6; animation:cf-dash 1.1s linear infinite; }
  @keyframes cf-flow{ to{ stroke-dashoffset:-24; } }
  .cf-flow{ stroke-dasharray:4 8; animation:cf-flow 1.4s linear infinite; }
  @keyframes cf-bounce{ 0%,100%{ transform:translateY(0); opacity:.6; } 50%{ transform:translateY(6px); opacity:1; } }
  .cf-bounce{ animation:cf-bounce 2s ease-in-out infinite; }
  @keyframes cf-ping{ 0%{ transform:scale(.5); opacity:.85; } 100%{ transform:scale(2.8); opacity:0; } }
  .cf-ping{ animation:cf-ping 2.4s cubic-bezier(0,0,.2,1) infinite; transform-origin:center; }
  @keyframes cf-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:.35; } }
  .cf-pulse{ animation:cf-pulse 1.8s ease-in-out infinite; }

  .cf-reveal{ opacity:0; transform:translateY(22px); transition:opacity .7s cubic-bezier(0.16,1,0.3,1), transform .7s cubic-bezier(0.16,1,0.3,1); }
  .cf-reveal.cf-in{ opacity:1; transform:translateY(0); }

  /* Page entrance is owned by the <AnimatePresence> around <main>, not by CSS.
     This rule used to run its own opacity+translateY keyframe on each page root; with
     both animating the same two properties on nested elements, a route change played
     the fade twice and the second one started before the first had finished, which read
     as a stutter. The class is left defined — it is still on every page root — so it
     stays a valid hook without competing for the same properties. */
  .cf-page-in{ animation:none; }

  .cf-nav-link{ position:relative; }
  .cf-nav-link::after{ content:''; position:absolute; left:0; right:0; bottom:-7px; height:2px; border-radius:2px;
    background:linear-gradient(90deg, var(--cf-red), var(--cf-orange)); transform:scaleX(0); transform-origin:left;
    transition:transform .3s cubic-bezier(0.16,1,0.3,1); }
  .cf-nav-link:hover::after, .cf-nav-link[data-active="true"]::after{ transform:scaleX(1); }

  .cf-map-grab{ cursor:grab; } .cf-map-grab:active{ cursor:grabbing; }

  /* ------------------------------------------------------------------ *
   * Spotlight surfaces
   *
   * The cursor position is written to --mx/--my as percentages by JS (see <Spotlight>),
   * and every layer below reads them. Keeping the values on the element as custom
   * properties means the pointer handler only ever touches style properties that are
   * composited — no React re-render per mousemove.
   * ------------------------------------------------------------------ */
  .cf-spot{ position:relative; isolation:isolate; }
  .cf-spot::before{
    content:''; position:absolute; inset:-1px; border-radius:inherit; z-index:0; pointer-events:none;
    opacity:0; transition:opacity .4s var(--cf-ease);
    background:radial-gradient(340px circle at var(--mx,50%) var(--my,50%),
      color-mix(in oklab, var(--cf-spot-color, var(--cf-orange)) 20%, transparent), transparent 62%);
  }
  .cf-spot:hover::before, .cf-spot:focus-within::before{ opacity:1; }
  .cf-spot > *{ position:relative; z-index:1; }

  /* The hairline that lights up on hover. A masked gradient border: the ::after paints a
     radial highlight and the mask punches out everything but a 1px rim. */
  .cf-spot-edge::after{
    content:''; position:absolute; inset:0; border-radius:inherit; z-index:0; pointer-events:none;
    padding:1px; opacity:0; transition:opacity .4s var(--cf-ease);
    background:radial-gradient(260px circle at var(--mx,50%) var(--my,50%),
      var(--cf-spot-color, var(--cf-orange)), transparent 60%);
    -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite:xor; mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite:exclude;
  }
  .cf-spot-edge:hover::after, .cf-spot-edge:focus-within::after{ opacity:.85; }

  /* Bento tiles: same card material, but lift is scale-free so tall and short tiles in the
     same grid rise by the same number of pixels and the row does not visually shear. */
  /* Opacity is deliberately high: these sit over the shader backdrop, and at the ~0.75 that
     suited the old CSS mesh a bright band of the gradient showed straight through and the
     card stopped reading as a surface at all. */
  /* Card material.
   *
   * Three things do the work here, and they are the pattern every dark-first product UI
   * (Linear, Vercel, and most current Awwwards dark sites) converges on:
   *
   *  1. a directional fill — lighter at the top-left, darker at the bottom-right — which
   *     implies a light source instead of reading as a flat swatch;
   *  2. a 1px edge that is brighter along the top than the bottom, so the card has an
   *     apparent thickness rather than a drawn outline;
   *  3. an inset top highlight, the specular line real glass catches at its lip.
   *
   * Depth comes from luminance, not from a drop shadow — a shadow on a near-black ground is
   * invisible anyway, which is why the old flat-fill-plus-outline version looked like a box.
   */
  .cf-bento{ position:relative; isolation:isolate; border-radius:1rem;
    background:
      linear-gradient(160deg, rgba(255,244,236,.055) 0%, rgba(255,244,236,0) 42%),
      linear-gradient(168deg, rgba(34,29,27,.66), rgba(17,15,14,.76));
    border:1px solid rgba(255,238,228,.09);
    border-top-color:rgba(255,240,230,.16);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.07), 0 10px 30px -18px rgba(0,0,0,.9);
    backdrop-filter:blur(18px) saturate(130%);
    transition:transform .35s var(--cf-ease), border-color .35s var(--cf-ease), box-shadow .35s var(--cf-ease); }
  .cf-bento:hover{ transform:translateY(-4px);
    border-color:rgba(255,224,206,.18); border-top-color:rgba(255,232,216,.28);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.12), var(--cf-shadow-lg); }

  /* Conic aurora used behind hero art and feature tiles. */
  @keyframes cf-spin{ to{ transform:rotate(1turn); } }
  .cf-aurora{ position:absolute; inset:-40%; pointer-events:none; opacity:.5; filter:blur(52px);
    background:conic-gradient(from 0deg, transparent 0deg, rgba(225,6,0,.5) 60deg,
      transparent 140deg, rgba(77,141,240,.45) 220deg, transparent 300deg, rgba(255,106,0,.5) 350deg, transparent 360deg);
    animation:cf-spin 22s linear infinite; }

  /* Ticker/edge fades — a marquee that hard-cuts at the container edge reads as clipped;
     fading it to the page ground makes it read as continuing past the viewport. The fade
     needs real width (15%) to land: at a few percent of a wide track the ramp is only a
     handful of pixels and still reads as a hard cut. */
  .cf-edge-fade{
    -webkit-mask-image:linear-gradient(90deg, transparent 0%, #000 15%, #000 85%, transparent 100%);
    mask-image:linear-gradient(90deg, transparent 0%, #000 15%, #000 85%, transparent 100%);
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-size:100% 100%; mask-size:100% 100%; }

  /* Sweep of light across a surface on hover — used on primary CTAs. */
  .cf-shine{ position:relative; overflow:hidden; }
  .cf-shine::after{ content:''; position:absolute; top:0; bottom:0; left:-60%; width:40%;
    background:linear-gradient(100deg, transparent, rgba(255,255,255,.28), transparent);
    /* Travels on transform, not on the 'left' property.
       Animating 'left' relayouts the button on every frame of the sweep, off the compositor
       and on the main thread — the same thread ticking the simulation and painting the live
       map. translateX runs on the compositor and cannot touch layout at all.
       450% because the sweep must cross 180% of the button while the element is 40% of it. */
    transform:translateX(0) skewX(-18deg); transition:transform .65s var(--cf-ease);
    will-change:transform; pointer-events:none; }
  .cf-shine:hover::after{ transform:translateX(450%) skewX(-18deg); }

  /* Scroll progress rail under the header. */
  .cf-progress{ position:fixed; top:0; left:0; height:2px; z-index:60; transform-origin:0 50%;
    background:linear-gradient(90deg, var(--cf-red), var(--cf-orange), var(--cf-blue-hi)); }

  /* Tubelight nav indicator: a bar above the active item plus stacked blurs for the bloom. */
  .cf-lamp{ position:absolute; left:50%; transform:translateX(-50%); top:-11px; width:26px; height:3px;
    border-radius:0 0 3px 3px; background:linear-gradient(90deg, var(--cf-red), var(--cf-orange)); }
  .cf-lamp span{ position:absolute; border-radius:9999px; background:rgba(255,106,0,.32); }
  .cf-lamp .l1{ inset:-9px -12px auto -12px; height:22px; filter:blur(11px); }
  .cf-lamp .l2{ inset:-5px -4px auto -4px; height:16px; filter:blur(7px); }

  /* ------------------------------------------------------------------ *
   * Core header treatment
   *
   * The diagonal grid-fade signature: a 32px rule grid masked to a radial ellipse anchored
   * at the top-left, so it is crisp at the wordmark and gone by the middle of the bar. The
   * source used --muted; here the lines are drawn in the app's own hairline colour.
   * ------------------------------------------------------------------ */
  .cf-gridfade{ position:absolute; inset:0; z-index:0; pointer-events:none;
    background-image:linear-gradient(to right, var(--cf-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--cf-line) 1px, transparent 1px);
    background-size:32px 32px;
    -webkit-mask-image:radial-gradient(ellipse 80% 80% at 0% 0%, #000 50%, transparent 90%);
    mask-image:radial-gradient(ellipse 80% 80% at 0% 0%, #000 50%, transparent 90%); }

  /* Filter strip. Hard-bordered cells rather than pills — the divider between items is what
     makes it read as a strip of segments instead of a row of buttons. */
  .cf-strip{ display:flex; flex:1; overflow-x:auto; scroll-behavior:smooth;
    scrollbar-width:none; -ms-overflow-style:none; }
  .cf-strip::-webkit-scrollbar{ display:none; }
  .cf-strip-item{ position:relative; display:flex; align-items:center; justify-content:center;
    flex-shrink:0; min-width:fit-content; cursor:pointer; white-space:nowrap;
    padding:0.75rem 1.75rem; font-size:0.65rem; font-weight:800; text-transform:uppercase;
    letter-spacing:0.16em; border-right:1px solid var(--cf-line); color:var(--cf-dim2);
    transition:background-color .25s var(--cf-ease), color .25s var(--cf-ease); }
  @media (min-width:768px){ .cf-strip-item{ font-size:0.72rem; } }
  /* No divider after the final segment — a trailing rule reads as a cell with nothing in it. */
  .cf-strip-item:last-child{ border-right:0; }
  .cf-strip-item:hover{ background:rgba(255,255,255,0.04); color:var(--cf-ink); }
  .cf-strip-item[data-active="true"]{ color:var(--cf-ink); background:rgba(255,255,255,0.05); }

  /* Role card: art bay on top, copy in the middle, action bar pinned to the floor. */
  .cf-rolecard{ position:relative; isolation:isolate; overflow:hidden; border-radius:1rem;
    background:
      linear-gradient(160deg, rgba(255,244,236,.055) 0%, rgba(255,244,236,0) 42%),
      linear-gradient(168deg, rgba(34,29,27,.66), rgba(17,15,14,.76));
    border:1px solid rgba(255,238,228,.09); border-top-color:rgba(255,240,230,.16);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.07), 0 10px 30px -18px rgba(0,0,0,.9);
    backdrop-filter:blur(18px) saturate(130%);
    transition:transform .35s var(--cf-ease), border-color .35s var(--cf-ease), box-shadow .35s var(--cf-ease); }
  .cf-rolecard:hover{ transform:translateY(-5px);
    border-color:rgba(255,224,206,.18); border-top-color:rgba(255,232,216,.30);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.12), var(--cf-shadow-lg); }

  .cf-rolecard-art{ position:relative; display:block; height:8.5rem; padding:1rem 1.25rem 0;
    border-bottom:1px solid rgba(255,238,228,.07); overflow:hidden; }
  /* Accent bleeds up from the floor of the bay, so colour arrives as light. */
  .cf-rolecard-glow{ position:absolute; inset:auto -20% -60% -20%; height:130%;
    background:radial-gradient(60% 100% at 50% 100%, color-mix(in oklab, var(--accent) 30%, transparent), transparent 72%);
    opacity:.5; transition:opacity .4s var(--cf-ease); pointer-events:none; }
  .cf-rolecard:hover .cf-rolecard-glow{ opacity:.85; }
  .cf-rolecard-art svg{ position:relative; z-index:1; }

  .cf-rolecard-index{ position:absolute; top:.35rem; right:.85rem; z-index:2;
    font-weight:900; font-size:2.75rem; line-height:1; letter-spacing:-.02em;
    color:transparent; -webkit-text-stroke:1px rgba(255,240,230,.16); user-select:none; }
  .cf-rolecard:hover .cf-rolecard-index{ -webkit-text-stroke-color:color-mix(in oklab, var(--accent) 45%, transparent); }

  .cf-rolecard-foot{ display:flex; align-items:center; justify-content:space-between;
    padding:.85rem 1.5rem; border-top:1px solid rgba(255,238,228,.07);
    background:linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 7%, transparent));
    transition:background .35s var(--cf-ease); }
  .cf-rolecard:hover .cf-rolecard-foot{
    background:linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 16%, transparent)); }

  /* Stat band. Shares the card material so it belongs to the same system, with 1px inner
     rules between cells rather than an opaque plate behind them. */
  .cf-statband{
    background:
      linear-gradient(160deg, rgba(255,244,236,.045) 0%, rgba(255,244,236,0) 45%),
      linear-gradient(168deg, rgba(30,26,24,.55), rgba(17,15,14,.66));
    border:1px solid rgba(255,238,228,.08); border-top-color:rgba(255,240,230,.14);
    box-shadow:inset 0 1px 0 rgba(255,246,240,.06);
    backdrop-filter:blur(18px) saturate(130%); }
  .cf-statcell{ border-right:1px solid rgba(255,238,228,.07); }
  .cf-statcell:last-child{ border-right:0; }
  @media (max-width:767px){
    .cf-statcell:nth-child(2n){ border-right:0; }
    .cf-statcell:nth-child(-n+2){ border-bottom:1px solid rgba(255,238,228,.07); }
  }

  /* Section divider that fades out at both ends instead of butting into the gutter. */
  .cf-rule{ height:1px; border:0;
    background:linear-gradient(90deg, transparent, var(--cf-line2), transparent); }

  /* Numeric labels that should not reflow as digits change (counters, clocks). */
  .cf-tnum{ font-variant-numeric:tabular-nums; }

  @keyframes cf-float{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-9px); } }
  .cf-float{ animation:cf-float 6s ease-in-out infinite; }

  @keyframes cf-sweep{ 0%{ transform:translateX(-100%); } 100%{ transform:translateX(300%); } }
  .cf-sweep{ animation:cf-sweep 3.2s var(--cf-ease) infinite; }

  @media (prefers-reduced-motion: reduce){
    .cf-mesh span{ animation:none !important; }
    .cf-marquee-track,.cf-dash,.cf-flow,.cf-bounce,.cf-ping,.cf-pulse{ animation:none !important; }
    .cf-reveal{ opacity:1 !important; transform:none !important; transition:none !important; }
    .cf-aurora,.cf-float,.cf-sweep{ animation:none !important; }
    .cf-shader{ animation:none !important; opacity:1; }
    .cf-shine::after{ display:none; }
    .cf-bento:hover{ transform:none; }
  }
`;

/* ============================================================================
   Venue model + geometry
   ========================================================================== */

/**
 * Everything drawn on a map now comes from the backend — see src/venueAdapter.js, which turns
 * the venue *graph* the API serves into the polygons this file draws. There is deliberately no
 * fallback venue here: a map with invented crowd on it is worse than an empty state, because
 * nothing on screen tells you which one you are looking at.
 */

const POI_ICON = { water: Droplets, wc: DoorOpen, cafe: Coffee };

/** Backend Session.Status -> the wording and colour used across the portals. */
const SESSION_STATUS_META = {
  RUNNING: { c: "var(--cf-green)", l: "LIVE" },
  PAUSED: { c: "var(--cf-amber)", l: "PAUSED" },
  CREATED: { c: "var(--cf-dim)", l: "READY" },
  STOPPED: { c: "var(--cf-dim2)", l: "STOPPED" },
  COMPLETED: { c: "var(--cf-blue-hi)", l: "COMPLETE" },
};

/** A small live/offline pill. Every portal shows one, so the socket state is never a mystery. */
function ConnectionPill({ connected, status }) {
  const meta = SESSION_STATUS_META[status] ?? SESSION_STATUS_META.CREATED;
  return (
    <span className="inline-flex items-center gap-1.5 cf-mono text-[10px] px-2 py-1 rounded cf-chip">
      {connected ? (
        <Wifi className="w-3 h-3" style={{ color: meta.c }} />
      ) : (
        <WifiOff className="w-3 h-3 cf-dim2" />
      )}
      <span style={{ color: connected ? meta.c : "var(--cf-dim2)" }}>
        {connected ? meta.l : "OFFLINE"}
      </span>
    </span>
  );
}

/** Shown wherever a portal needs a session and does not have one yet. */
function NeedsSession({ title, lede, children }) {
  return (
    <div className="cf-card rounded-2xl p-8 max-w-lg">
      <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: "rgba(77,141,240,0.16)" }}>
        <Radio className="w-6 h-6 cf-blue-hi" strokeWidth={2} />
      </span>
      <h2 className="cf-display font-black uppercase text-2xl tracking-tight mb-2">{title}</h2>
      <p className="text-sm cf-dim leading-relaxed mb-6">{lede}</p>
      {children}
    </div>
  );
}

/** Surfaces an API/socket failure without pretending the data is fine. */
function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="cf-card rounded-xl px-4 py-3 flex items-start gap-2.5" style={{ borderColor: "rgba(225,6,0,.4)" }}>
      <AlertTriangle className="w-4 h-4 cf-red shrink-0 mt-0.5" strokeWidth={2} />
      <p className="text-sm cf-dim leading-relaxed">{error}</p>
    </div>
  );
}

const HALL_STYLE = {
  GATE: { fill: "rgba(225,6,0,0.16)", stroke: "rgba(225,6,0,0.5)" },
  WALKWAY: { fill: "rgba(77,141,240,0.12)", stroke: "rgba(77,141,240,0.4)" },
  SEATING: { fill: "rgba(255,255,255,0.05)", stroke: "rgba(120,140,175,0.35)" },
  CONCESSION: { fill: "rgba(255,176,32,0.13)", stroke: "rgba(255,176,32,0.42)" },
  EXIT: { fill: "rgba(0,200,83,0.14)", stroke: "rgba(0,200,83,0.45)" },
};

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const centroid = (pts) => {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
};

const densityColor = (d) =>
  d > 0.85 ? "var(--cf-red)" : d > 0.7 ? "var(--cf-orange)" : d > 0.5 ? "var(--cf-amber)" : "var(--cf-green)";

/**
 * The heatmap ramp, as literal rgb rather than CSS variables.
 *
 * SVG gradient stops cannot read `var(--cf-red)` reliably across browsers, so these repeat the
 * palette's values. Same four thresholds as `densityColor` above, and the two must agree — the
 * blob under a zone and the percentage printed on it are describing the same number.
 */
const HEAT_TIERS = [
  { id: "cf-heat-low", rgb: "rgb(0,200,83)", max: 0.5 },
  { id: "cf-heat-mid", rgb: "rgb(255,176,32)", max: 0.7 },
  { id: "cf-heat-high", rgb: "rgb(255,106,0)", max: 0.85 },
  { id: "cf-heat-crit", rgb: "rgb(225,6,0)", max: Infinity },
];

const heatTier = (d) => HEAT_TIERS.find((tier) => d <= tier.max) ?? HEAT_TIERS[HEAT_TIERS.length - 1];

/**
 * Pixel art per zone type, generated with PixelLab and served from `public/sprites`.
 *
 * WALKWAY and the concourse deliberately have none: they are the spaces *between* the things
 * worth drawing, and a prop in the middle of a corridor reads as an obstruction that the
 * simulation does not actually model.
 */
const ZONE_SPRITE = {
  GATE: "/sprites/gate-entrance.png",
  EXIT: "/sprites/exit-gateway.png",
  SEATING: "/sprites/seating-block.png",
  CONCESSION: "/sprites/concession-food.png",
};

/** Merch and food are both CONCESSION to the backend; the name is the only thing separating them. */
const spriteFor = (hall) =>
  hall.type === "CONCESSION" && /merch/i.test(`${hall.id} ${hall.name}`)
    ? "/sprites/concession-merch.png"
    : ZONE_SPRITE[hall.type] ?? null;

/**
 * Zoom at which agents become sprites instead of dots.
 *
 * ponytail: a flat threshold, not a size curve. Below it a 48px sprite would render into about
 * five screen pixels — unreadable, and 600 <image> nodes redrawn five times a second for the
 * privilege. Dots are both faster and clearer when zoomed out, so the map simply uses the one
 * that works at the current scale.
 */
/**
 * The crowd scale: how many people one drawn figure stands for. Fixed, for the whole run.
 *
 * It used to switch from 1:1 to 1:20 as a venue filled past a threshold, which meant every
 * figure on screen changed meaning mid-run — the crowd appeared to collapse at the moment the
 * venue got busiest, which is precisely when an operator is reading the map hardest. A constant
 * ratio costs a little fidelity in an empty venue and keeps the map honest all the way through.
 */
const CROWD_UNIT = 10;

/**
 * Absolute ceiling on drawn figures, for events far past the threshold.
 *
 * Matched to StateBroadcaster's own `max-people-in-frame` cap, because the server never sends
 * more than that many positions anyway — asking for more would only be asking for agents that
 * are not in the frame. At 1:20 that ceiling is reached around 12,000 people, past which the
 * ratio has to rise to stay drawable; the legend reports whatever it actually worked out to,
 * so the number on screen stays true even when it is no longer 20.
 */
const CROWD_FIGURES_HARD_MAX = 600;

/**
 * Stable 16-bit hash of an agent id, used to decide which agents are drawn as figures.
 *
 * Any cheap avalanche would do; this is FNV-1a's mixing step. What matters is that the same id
 * always lands on the same number, so an agent's membership never depends on how many other
 * agents happen to exist that frame.
 */
function hashId(id) {
  let hash = 0x811c9dc5;
  const text = String(id);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}



/**
 * Crops out of `floor-tileset.png` (128px sheet, 32px cells), by their position on the sheet.
 *
 * `size` is how large one tile is drawn in map units. 6 puts roughly 17 tiles across a 100-unit
 * venue — small enough to read as texture, large enough that the pixel grid is still visible
 * rather than dissolving into noise.
 */
const FLOOR_TILES = [
  { id: "cf-floor-concrete", x: 64, y: 32, size: 6 },  // wang_0  — all-lower, dark concourse
  { id: "cf-floor-paved", x: 0, y: 96, size: 6 },      // wang_15 — all-upper, paved walkway
];

/**
 * Blob opacity for a zone's density.
 *
 * The gamma is the point. A straight `base + d` ramp put a 6%-full zone at 0.17 opacity, which
 * is invisible on a dark map — so a quiet venue rendered as an unreadable black plan and the
 * heat layer only appeared once things were already going wrong. `d ** 0.55` lifts the bottom
 * of the range without touching the top, so low densities are legible and a critical zone still
 * reads as clearly worse than a busy one.
 */
const heatOpacity = (d) => 0.18 + Math.min(1, Math.max(0, d)) ** 0.55 * 0.72;

/* ============================================================================
   Crowd positions arrive from the backend, not from here.

   The simulation integrates every agent under a social force model on the server
   and broadcasts sampled positions ~5 times a second over the session WebSocket;
   src/useConcourse.js receives them and src/venueAdapter.js projects them into
   this map's coordinate box. The client draws dots, it does not invent them.
   ========================================================================== */

/* ============================================================================
   VenueMap — the Google-Maps-style canvas. Pan, zoom, halls as polygons,
   corridors as road casings, POI pins, live dots, blue "you" puck, and an
   optional directions polyline.
   ========================================================================== */

export function VenueMap({
  venue, people = [], crowdTotal = 0, me = null, route = null, showDensity = true,
  showPeople = true, showPois = true, showSprites = true,
  underlay = null, underlayOpacity = 0.25,
  height = 460, onSelectHall = null, selectedHall = null,
  /**
   * A `planRoute` result. Draws the walking route as per-hop coloured segments —
   * red through a jam, blue through clear ground — the way a traffic layer does.
   * `route` (a bare point list) is still honoured for callers that only have one.
   */
  trafficRoute = null,
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const wrapRef = useRef(null);

  // Width/height of the panel, so the viewBox below can match its shape. Tracked rather than
  // read once: the panel reflows with the sidebar at narrow widths, and a stale aspect would
  // stretch the venue until something else forced a re-render.
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clampZoom = (z) => Math.max(0.7, Math.min(3.2, z));

  const onPointerDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    // User-space units per pixel. Both axes share one figure because the viewBox is kept at
    // the container's aspect. Dividing by zoom is what makes the map track the cursor exactly
    // rather than sliding faster the further you have zoomed in.
    const scale = rect && rect.height > 0 ? frame.h / zoom / rect.height : 0.2;
    setPan({
      x: drag.current.px + (e.clientX - drag.current.sx) * scale,
      y: drag.current.py + (e.clientY - drag.current.sy) * scale,
    });
  };
  const onPointerUp = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const recenter = () => { setPan({ x: 0, y: 0 }); setZoom(1); };

  /**
   * The default view: the venue's own bounding box, grown to the panel's shape.
   *
   * The adapter projects a venue into a square 0-100 space preserving its real proportions, so
   * a wide arena occupies a wide, short band of that square and leaves the rest empty. Framing
   * the whole square therefore spent most of the panel on nothing — a 620x270 layout rendered
   * into roughly a seventh of the available pixels. Framing the venue instead fills the panel
   * whatever shape the venue is.
   *
   * Growing the *shorter* side to reach the panel's aspect is what keeps this from distorting:
   * the frame only ever gets bigger than the venue, never squashed to fit.
   */
  const frame = useMemo(() => {
    const points = venue.outline?.length ? venue.outline : [[0, 0], [100, 100]];
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    // Breathing room for what hangs off the venue: labels under edge zones, and the
    // entrance/exit badges pushed outward with three chevrons trailing behind them. At 4 the
    // badges on the outermost gates were sliced in half by the panel edge.
    const padding = 15;
    const width = Math.max(maxX - minX + padding * 2, 1);
    const height = Math.max(maxY - minY + padding * 2, 1);

    const boxWidth = Math.max(width, height * aspect);
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      w: boxWidth,
      h: boxWidth / aspect,
    };
  }, [venue.outline, aspect]);

  /**
   * The venue's own centre, used to push entrance/exit badges outward.
   *
   * Taken from the halls rather than from `frame`, which is grown to the panel's aspect — a
   * frame centre would sit off the venue on a wide layout and throw every badge to one side.
   */
  const venueCentre = useMemo(() => {
    const halls = venue.halls ?? [];
    if (!halls.length) return [50, 50];
    return [
      halls.reduce((sum, h) => sum + h.center[0], 0) / halls.length,
      halls.reduce((sum, h) => sum + h.center[1], 0) / halls.length,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is fixed per venue
  }, [venue.id]);

  /**
   * Mask geometry, which depends only on the venue.
   *
   * Keyed on `venue.id`, deliberately, not on `venue.halls`. `applyFrame` returns a fresh
   * halls *array* every frame — the hall objects are spread to carry new density — so a
   * dependency on it invalidates five times a second and rebuilds this whole mask to describe
   * a building that has not moved. The polygons themselves are reused by reference and never
   * change once a layout is loaded, so the venue's identity is the honest dependency.
   */
  const walkableMask = useMemo(() => (
    <>
      <rect x="-400" y="-400" width="900" height="900" fill="black" />
      {venue.corridors.map((c, i) => (
        <line key={`m-${i}`} x1={c[0][0]} y1={c[0][1]} x2={c[1][0]} y2={c[1][1]}
          stroke="white" strokeWidth="4.2" strokeLinecap="round" />
      ))}
      {venue.halls.map((h) => (
        <polygon key={`m-${h.id}`} points={h.pts.map((p) => p.join(",")).join(" ")} fill="white" />
      ))}
    </>
  ), [venue.corridors, venue.halls]);

  /**
   * The crowd, thinned to a readable number of figures, and what one figure is worth.
   *
   * `people` is already a server-side sample — StateBroadcaster sends every nth agent, capped
   * at 600 — so this is a second thinning on top of that, and the ratio has to be worked out
   * against `crowdTotal` (everyone actually inside) rather than against the sample, or the
   * figure count would claim to be the crowd.
   *
   * Every nth again rather than the first n: a prefix would empty out whichever part of the
   * venue happened to sort last, and the shape of the crowd is the entire point of the map.
   */
  const crowd = useMemo(() => {
    // Chosen by a hash of each agent's id, not by position in the array.
    //
    // Selecting every nth *index* is what made figures teleport: as agents enter and leave,
    // `people.length` moves, the stride moves with it, and the entire set of chosen indices
    // changes at once — every figure on screen jumps to an unrelated agent's position in a
    // single frame. Worst at the end of a run, when the crowd drains fastest.
    //
    // Hashing the id instead means an agent's membership depends only on that agent. Changing
    // the ratio admits or drops a few figures at the margin; everyone already on screen stays
    // exactly where they were, and moves the way the simulation moved them.
    const total = Math.max(crowdTotal, people.length);

    // `people` is already a server-side sample capped at 600, so on a large event the target is
    // drawn from that sample rather than from every agent. Both selections hash the same ids,
    // so an agent the server keeps is an agent this can keep too.
    const wanted = Math.min(Math.ceil(total / CROWD_UNIT), people.length, CROWD_FIGURES_HARD_MAX);

    // The `wanted` agents with the lowest id hash. Exact count — a probability cutoff landed
    // near the target but not on it, so a 1,000-person event drew 58 figures and the legend
    // had to admit "1 ≈ 17" when the whole point was 20. Membership is just as stable: an
    // agent stays in for as long as fewer than `wanted` agents with lower hashes exist, so
    // the set changes at the margin rather than all at once.
    const figures = wanted >= people.length
      ? people
      : [...people].sort((a, b) => hashId(a.id) - hashId(b.id)).slice(0, wanted);
    return {
      figures,
      // Rounded to something an operator can hold in their head: "1 ≈ 20 people", not 1 ≈ 17.4.
      each: figures.length ? Math.max(1, Math.round(total / figures.length)) : 1,
    };
  }, [people, crowdTotal]);

  /** The venue's real extent in map space, grown a little so floor art reaches past the halls. */
  const venueBounds = useMemo(() => {
    const halls = venue.halls ?? [];
    if (!halls.length) return { x: 0, y: 0, w: 100, h: 100 };
    const minX = Math.min(...halls.map((h) => h.center[0] - h.radius));
    const maxX = Math.max(...halls.map((h) => h.center[0] + h.radius));
    const minY = Math.min(...halls.map((h) => h.center[1] - h.radius));
    const maxY = Math.max(...halls.map((h) => h.center[1] + h.radius));
    const bleed = 3;
    return {
      x: minX - bleed, y: minY - bleed,
      w: maxX - minX + bleed * 2, h: maxY - minY + bleed * 2,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is fixed per venue
  }, [venue.id]);

  /** POI ids whose zone already draws a sprite, so the marker would only cover the art. */
  const poisHiddenBySprites = useMemo(() => {
    if (!showSprites) return new Set();
    return new Set(
      (venue.halls ?? []).filter(spriteFor).map((hall) => `poi-${hall.id}`),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry is fixed per venue
  }, [venue.id, showSprites]);

  const vbW = frame.w / zoom;
  const vbH = frame.h / zoom;
  const cx = frame.cx - pan.x, cy = frame.cy - pan.y;
  const viewBox = `${cx - vbW / 2} ${cy - vbH / 2} ${vbW} ${vbH}`;
  const outlinePath = venue.outline.map((p) => p.join(",")).join(" ");

  return (
    <div ref={wrapRef} className="relative rounded-2xl overflow-hidden cf-card-solid" style={{ height }}>
      <svg
        viewBox={viewBox} className="w-full h-full cf-map-grab touch-none"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        role="img" aria-label={`Live map of ${venue.name}`}
      >
        <defs>
          <pattern id="cf-map-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(120,150,200,0.07)" strokeWidth="0.25" />
          </pattern>
          <clipPath id="cf-venue-clip"><polygon points={outlinePath} /></clipPath>
          <radialGradient id="cf-me-halo">
            <stop offset="0%" stopColor="rgba(77,141,240,0.45)" />
            <stop offset="100%" stopColor="rgba(77,141,240,0)" />
          </radialGradient>

          {/* Heat blobs. One gradient per density tier, each fading to fully transparent so
              neighbouring zones bleed into one another instead of ending at a hard polygon
              edge — crowding does not stop at a room boundary, and the map should not either. */}
          {HEAT_TIERS.map((tier) => (
            <radialGradient key={tier.id} id={tier.id}>
              <stop offset="0%" stopColor={tier.rgb} stopOpacity="0.95" />
              <stop offset="45%" stopColor={tier.rgb} stopOpacity="0.45" />
              <stop offset="100%" stopColor={tier.rgb} stopOpacity="0" />
            </radialGradient>
          ))}
          {/* Crowd figures as one reusable symbol each.
              A <use> is a single DOM node; the <g> of disc + sprite + marker it replaces was
              three, times ~120 figures, rebuilt five times a second. That was the largest part
              of the render cost, and none of the three ever differ between figures. */}
          <symbol id="cf-figure" overflow="visible">
            <circle cx="0" cy="0" r="1.6" fill="rgba(150,190,255,0.16)" />
            <image href="/sprites/people/attendee-blue-south.png"
              x="-1.15" y="-1.9" width="2.3" height="2.3" style={{ imageRendering: "pixelated" }} />
          </symbol>
          <symbol id="cf-figure-hot" overflow="visible">
            <circle cx="0" cy="0" r="1.6" fill="rgba(255,106,0,0.32)" />
            <image href="/sprites/people/attendee-blue-south.png"
              x="-1.15" y="-1.9" width="2.3" height="2.3" style={{ imageRendering: "pixelated" }} />
            <circle cx="0" cy="-2.2" r="0.45" fill="var(--cf-orange)" />
          </symbol>

          {/* Floor texture, cropped straight out of the Wang sheet.
              A nested <svg> with a viewBox is the crop: it maps one 32px cell of the 128px
              sheet onto the pattern's own box, so no tile has to be sliced out to its own file.
              ponytail: one solid tile tiled flat, not full corner-based autotiling. Autotiling
              buys seam-correct transitions between two terrains; this map has one floor and
              octagonal zones that never share a tile edge, so it would buy nothing here. */}
          {FLOOR_TILES.map((tile) => (
            <pattern key={tile.id} id={tile.id} width={tile.size} height={tile.size}
              patternUnits="userSpaceOnUse">
              <svg viewBox={`${tile.x} ${tile.y} 32 32`} width={tile.size} height={tile.size}>
                <image href="/sprites/floor-tileset.png" x="0" y="0" width="128" height="128"
                  style={{ imageRendering: "pixelated" }} />
              </svg>
            </pattern>
          ))}

          {/* Where a person can legitimately be: inside a zone, or in a corridor between two.
              Used as a mask on the crowd layer.

              The venue outline cannot do this job — it is a convex hull, so on any venue that
              is not roughly circular it spans wide empty pockets the simulation never routes
              anyone through. Agents rendered against that hull appeared to stand in the void
              outside the building. A mask rather than a clipPath because clipPaths ignore
              stroke, and the corridors only exist as stroked lines. */}
          <mask id="cf-walkable">{walkableMask}</mask>

          {/* Arrowhead for the flow markers. */}
          <marker id="cf-flow-head" viewBox="0 0 8 8" refX="6" refY="4"
            markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--cf-blue-hi)" />
          </marker>
        </defs>

        {/* Base. Sized well past the 0-100 projection space so the ground still covers the
            frame when a wide venue or a zoomed-out view widens the viewBox past it. */}
        <rect x="-400" y="-400" width="900" height="900" fill="#070B12" />
        <rect x="-400" y="-400" width="900" height="900" fill="url(#cf-map-grid)" />

        {/* venue landmass — tinted base first, then the floor texture over it, so the tiles
            sit on the map's own colour instead of replacing it with the tileset's grey */}
        <polygon points={outlinePath} fill="#0D1524" stroke="var(--cf-line2)" strokeWidth="0.5" />
        {showSprites && (
          <polygon points={outlinePath} fill="url(#cf-floor-concrete)" opacity="0.5"
            stroke="var(--cf-line2)" strokeWidth="0.5" />
        )}

        {/* Floor art, fitted to the venue's own bounding box rather than the whole 0-100
            projection square.
            The square is padded — the adapter insets the layout by 12% a side — so drawing
            here at 0,0,100,100 with `slice` cropped the ends off a wide image and pushed what
            survived out of register with the zones. `meet` inside the real bounds keeps the
            whole picture and lines its gates up with the gate nodes. */}
        {underlay && (
          <image href={underlay}
            x={venueBounds.x} y={venueBounds.y}
            width={venueBounds.w} height={venueBounds.h}
            preserveAspectRatio="xMidYMid meet" opacity={underlayOpacity}
            clipPath="url(#cf-venue-clip)" style={{ imageRendering: "pixelated" }} />
        )}

        {/* Corridors — casing then fill, the way map roads are drawn. These are also exactly
            what the crowd mask allows, so what you see is where people can be. */}
        <g clipPath="url(#cf-venue-clip)">
          {venue.corridors.map((c, i) => (
            <line key={`c-${i}`} x1={c[0][0]} y1={c[0][1]} x2={c[1][0]} y2={c[1][1]}
              stroke="#16233A" strokeWidth="3.6" strokeLinecap="round" />
          ))}
          {venue.corridors.map((c, i) => (
            <line key={`cf-${i}`} x1={c[0][0]} y1={c[0][1]} x2={c[1][0]} y2={c[1][1]}
              stroke="#22334F" strokeWidth="2.2" strokeLinecap="round" />
          ))}
        </g>

        {/* Heat. Drawn over the corridors and under the halls, so a zone's own label and
            percentage stay readable on top of its blob.

            `screen` blending is what makes two adjacent busy zones read as one hot region
            rather than two discs with a visible seam — the same reason a real heatmap adds
            light rather than painting over it.

            No blur filter here any more. An SVG feGaussianBlur re-runs on every repaint — five
            times a second over the whole heat layer — and it was buying nothing: the gradients
            already fade to fully transparent, which is the same softness by construction and
            free. */}
        {showDensity && (
          <g clipPath="url(#cf-venue-clip)"
            style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
            {venue.halls.map((h) => (
              <circle key={`heat-${h.id}`} cx={h.center[0]} cy={h.center[1]}
                // 2.1 -> 1.5. Area goes as the square, so this is roughly half the pixels, and
                // these are the most expensive pixels on the map: `screen` blending composites
                // every one of them against what is underneath, on every frame. The gradients
                // still fade to nothing, so the blobs read the same, just tighter to the zone
                // they describe.
                r={h.radius * 1.5} fill={`url(#${heatTier(h.density).id})`}
                opacity={heatOpacity(h.density)} />
            ))}
          </g>
        )}

        {/* halls */}
        {venue.halls.map((h) => {
          const style = HALL_STYLE[h.type] || HALL_STYLE.SEATING;
          const [hx, hy] = centroid(h.pts);
          const isSel = selectedHall === h.id;
          const sprite = showSprites ? spriteFor(h) : null;
          return (
            <g key={h.id} onClick={() => onSelectHall?.(h.id)} style={{ cursor: onSelectHall ? "pointer" : "default" }}>
              {/* With the heat layer on, the blob already carries the colour — filling the
                  polygon again on top of it stacks two washes of the same hue and turns a busy
                  zone into a flat slab. The polygon keeps only its edge, so you can still see
                  where one zone ends and the next begins. */}
              {/* Paved floor inside the zone, so a hall reads as a room rather than a hole in
                  the concourse. Under the density tint, which is kept faint because the heat
                  blob already carries the colour. */}
              {showSprites && (
                <polygon points={h.pts.map((p) => p.join(",")).join(" ")}
                  fill="url(#cf-floor-paved)" opacity="0.55" />
              )}
              <polygon points={h.pts.map((p) => p.join(",")).join(" ")}
                fill={showDensity ? densityColor(h.density) : style.fill}
                fillOpacity={showDensity ? 0.06 : 1}
                stroke={isSel ? "var(--cf-orange)" : style.stroke}
                strokeWidth={isSel ? 0.8 : 0.4} />

              {/* Pixel art for the zone, centred on it and scaled to its radius, so a bigger
                  hall gets a bigger prop without a second size table to keep in step.
                  `pixelated` is the whole point — the browser's default smoothing turns 96px
                  art into mush the moment it is drawn at any size but its own. */}
              {sprite && (
                <image href={sprite}
                  x={hx - h.radius * 1.1} y={hy - h.radius * 1.15}
                  width={h.radius * 2.2} height={h.radius * 2.2}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ imageRendering: "pixelated", pointerEvents: "none" }} />
              )}
              {/* Outlined text. A busy zone is exactly where the label matters most and also
                  exactly where hundreds of agent dots are drawn, so without a knockout the
                  name of the zone you are trying to read disappears into the crowd. */}
              {/* Label below the zone, not across its middle.
                  Centred text ran straight over the sprite, and on neighbouring zones the two
                  names overprinted each other — "LOWER STAND" and "EAST CONCOURSE" arrived as
                  one unreadable line. Hanging both off the bottom edge puts them in the gap
                  between zones, where there is room, and leaves the artwork clear. */}
              <text x={hx} y={hy + h.radius + 2.2} textAnchor="middle" fill="rgba(238,242,248,0.92)"
                stroke="#070B12" strokeWidth={0.7} paintOrder="stroke"
                style={{ fontSize: 1.9, fontFamily: "Rajdhani, sans-serif", fontWeight: 600, letterSpacing: "0.08em", pointerEvents: "none" }}>
                {h.name.toUpperCase()}
              </text>
              {showDensity && (
                <text x={hx} y={hy + h.radius + 4.4} textAnchor="middle" fill={densityColor(h.density)}
                  stroke="#070B12" strokeWidth={0.7} paintOrder="stroke"
                  style={{ fontSize: 1.8, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, pointerEvents: "none" }}>
                  {Math.round(h.density * 100)}%
                </text>
              )}
            </g>
          );
        })}

        {/* Critical zones, ringed and pulsing.
            The heat blob already colours them, but colour alone loses on a map with
            several busy areas — an expanding ring is the one thing on a static plan that
            catches an eye that is looking somewhere else. Only for zones actually past
            the critical line, so it never becomes ambient decoration.
            `cf-ping` is the existing keyframe, and it is already disabled under
            prefers-reduced-motion along with everything else. */}
        {showDensity && venue.halls
          .filter((h) => (h.density ?? 0) > 0.85)
          .map((h) => (
            <g key={`crit-${h.id}`} style={{ pointerEvents: "none" }}>
              <circle cx={h.center[0]} cy={h.center[1]} r={h.radius} fill="none"
                stroke="var(--cf-red)" strokeWidth="0.5" opacity="0.9" />
              <circle cx={h.center[0]} cy={h.center[1]} r={h.radius} fill="none"
                stroke="var(--cf-red)" strokeWidth="0.4" className="cf-ping"
                style={{ transformOrigin: `${h.center[0]}px ${h.center[1]}px` }} />
            </g>
          ))}

        {/* Entrance and exit signage.

            Pushed radially outward from the venue's own centre so a badge never lands on top
            of the zone it labels, and the chevrons point the way people actually travel:
            inward at a gate, outward at an exit. */}
        {venue.halls
          .filter((h) => h.type === "GATE" || h.type === "EXIT")
          .map((h) => {
            const isExit = h.type === "EXIT";
            const [vx, vy] = venueCentre;
            const dx = h.center[0] - vx;
            const dy = h.center[1] - vy;
            // A zone sitting exactly on the centroid has no outward direction; push it right
            // rather than dividing by zero and collapsing the badge onto the hall.
            const length = Math.hypot(dx, dy) || 1;
            const ux = dx / length;
            const uy = dy / length;
            const bx = h.center[0] + ux * (h.radius + 5);
            const by = h.center[1] + uy * (h.radius + 5);
            const colour = isExit ? "var(--cf-violet)" : "var(--cf-green)";
            const label = isExit ? "EXIT" : "ENTRANCE";
            const width = label.length * 1.15 + 2;
            // Chevrons travel with the crowd: away from the venue at an exit, into it at a gate.
            const sign = isExit ? 1 : -1;
            return (
              <g key={`sign-${h.id}`} style={{ pointerEvents: "none" }}>
                <rect x={bx - width / 2} y={by - 1.9} width={width} height={3.8} rx="0.9"
                  fill="#0B1018" stroke={colour} strokeWidth="0.35" opacity="0.95" />
                <text x={bx} y={by + 0.7} textAnchor="middle" fill={colour}
                  style={{ fontSize: 1.7, fontFamily: "Rajdhani, sans-serif", fontWeight: 700, letterSpacing: "0.14em" }}>
                  {label}
                </text>
                {[0, 1, 2].map((i) => (
                  <path key={i}
                    d={`M ${bx + ux * (width / 2 + 1.4 + i * 1.5) - uy * 0.9} ${by + uy * (width / 2 + 1.4 + i * 1.5) + ux * 0.9}
                        L ${bx + ux * (width / 2 + 2.2 + i * 1.5)} ${by + uy * (width / 2 + 2.2 + i * 1.5)}
                        L ${bx + ux * (width / 2 + 1.4 + i * 1.5) + uy * 0.9} ${by + uy * (width / 2 + 1.4 + i * 1.5) - ux * 0.9}`}
                    fill="none" stroke={colour} strokeWidth="0.45" strokeLinecap="round"
                    opacity={0.35 + i * 0.22}
                    transform={sign < 0 ? `rotate(180 ${bx} ${by})` : undefined} />
                ))}
              </g>
            );
          })}

        {/* Directions.
            Casing first as one continuous dark stroke, then each hop drawn over it in
            its own traffic colour. Two passes rather than one stroke per segment with
            its own casing, because per-segment casings overlap at every junction and
            leave a dark notch through the middle of the line. */}
        {trafficRoute?.segments?.length > 0 ? (
          <g style={{ pointerEvents: "none" }}>
            <polyline
              points={trafficRoute.points.map((p) => p.join(",")).join(" ")}
              fill="none" stroke="#05070B" strokeWidth="3.4"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
            {trafficRoute.segments.map((seg) => (
              <line key={seg.id} x1={seg.from[0]} y1={seg.from[1]}
                x2={seg.to[0]} y2={seg.to[1]}
                stroke={seg.band.color} strokeWidth="1.9"
                strokeLinecap="round" />
            ))}
            {/* Flow direction, over the colour rather than replacing it: the dashes
                say which way to walk, the colour underneath says how bad it is. */}
            <polyline
              points={trafficRoute.points.map((p) => p.join(",")).join(" ")}
              fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.55"
              strokeLinecap="round" strokeLinejoin="round" className="cf-flow" />
            <circle
              cx={trafficRoute.points[trafficRoute.points.length - 1][0]}
              cy={trafficRoute.points[trafficRoute.points.length - 1][1]}
              r="1.8" fill="var(--cf-violet)" stroke="#05070B" strokeWidth="0.5" />
          </g>
        ) : route && route.length > 1 && (
          <>
            <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none"
              stroke="#0A2A5E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none"
              stroke="var(--cf-blue-hi)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="cf-flow" />
            <circle cx={route[route.length - 1][0]} cy={route[route.length - 1][1]} r="1.6"
              fill="var(--cf-green)" stroke="#05070B" strokeWidth="0.5" />
          </>
        )}

        {/* The crowd, as figures rather than one dot per agent. */}
        {/* pointerEvents off for the whole layer. Nothing here is clickable, but without it the
            browser hit-tests every figure on every mouse move — and because each <use> expands
            the symbol into its own shadow tree, that is several hundred elements tested per
            move. It made panning the map cost far more than drawing it. */}
        {showPeople && (
          <g mask="url(#cf-walkable)" style={{ pointerEvents: "none" }}
            shapeRendering="optimizeSpeed">
            {/* ponytail: one south-facing sprite for everyone. PersonState carries no heading,
                so choosing among the eight rotations would mean tracking each agent's previous
                position across frames — real bookkeeping for a detail nobody can resolve at
                this size. Wire the other seven in if headings ever ship. */}
            {crowd.figures.map((p) => (
              <use key={p.id} href={p.hot ? "#cf-figure-hot" : "#cf-figure"} x={p.x} y={p.y} />
            ))}
          </g>
        )}

        {/* POIs.
            Skipped wherever a sprite already stands: every POI is derived from a CONCESSION
            zone, and those now draw a food stall or a merch kiosk. The marker was landing on
            top of the artwork and hiding it — the blue dots that covered both stalls. */}
        {showPois && venue.pois.filter((poi) => !poisHiddenBySprites.has(poi.id)).map((poi) => (
          <g key={poi.id}>
            <circle cx={poi.x} cy={poi.y} r="1.5" fill="#0B1018" stroke="var(--cf-blue-hi)" strokeWidth="0.4" />
            <circle cx={poi.x} cy={poi.y} r="0.55" fill="var(--cf-blue-hi)" />
          </g>
        ))}

        {/* you */}
        {me && (
          <g>
            <circle cx={me.x} cy={me.y} r={me.accuracy} fill="url(#cf-me-halo)" />
            <circle cx={me.x} cy={me.y} r="1.9" fill="rgba(77,141,240,0.35)" className="cf-ping"
              style={{ transformOrigin: `${me.x}px ${me.y}px` }} />
            <circle cx={me.x} cy={me.y} r="1.5" fill="var(--cf-blue-hi)" stroke="#fff" strokeWidth="0.5" />
          </g>
        )}
      </svg>

      {/* map controls */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        {[
          { icon: PlusIcon, label: "Zoom in", fn: () => setZoom((z) => clampZoom(z + 0.35)) },
          { icon: MinusIcon, label: "Zoom out", fn: () => setZoom((z) => clampZoom(z - 0.35)) },
          { icon: Locate, label: "Recenter", fn: recenter },
        ].map(({ icon: Icon, label, fn }) => (
          <button key={label} onClick={fn} aria-label={label}
            className="cf-focus w-9 h-9 rounded-lg cf-card-solid flex items-center justify-center hover:cf-card-hi transition-colors">
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>

      {/* Density key. Without it the colours are decoration — this is what makes them a scale.
          Hidden with the heat layer itself, so it never explains something that is not on screen. */}
      {showDensity && (
        <div className="absolute left-3 top-3 cf-card-solid rounded-lg px-3 py-2.5 pointer-events-none">
          <div className="cf-accent text-[9px] cf-dim2 mb-1.5">DENSITY</div>
          <div className="h-1.5 w-32 rounded-full"
            style={{ background: "linear-gradient(90deg, rgb(0,200,83) 0%, rgb(255,176,32) 45%, rgb(255,106,0) 72%, rgb(225,6,0) 100%)" }} />
          <div className="flex justify-between cf-mono text-[9px] cf-dim2 mt-1">
            <span>LOW</span><span>CRITICAL</span>
          </div>
          <div className="flex items-center gap-3 mt-2.5">
            <span className="flex items-center gap-1 cf-mono text-[9px] cf-dim2">
              <span className="w-2 h-2 rounded-sm" style={{ background: "var(--cf-green)" }} />ENTRY
            </span>
            <span className="flex items-center gap-1 cf-mono text-[9px] cf-dim2">
              <span className="w-2 h-2 rounded-sm" style={{ background: "var(--cf-violet)" }} />EXIT
            </span>
          </div>
          {/* Route colours, shown only when a route is on screen. The density ramp above
              and this are two different scales — one paints zones, one paints the line
              you walk — so labelling them separately stops the line being read as
              another heat blob. */}
          {trafficRoute?.segments?.length > 0 && (
            <div className="mt-2.5 pt-2 flex flex-col gap-1"
              style={{ borderTop: "1px solid var(--cf-line)" }}>
              <div className="cf-accent text-[9px] cf-dim2">YOUR ROUTE</div>
              {TRAFFIC_BANDS.map((band) => (
                <span key={band.id} className="flex items-center gap-1.5 cf-mono text-[9px] cf-dim2">
                  <span className="w-3 h-[3px] rounded-full" style={{ background: band.color }} />
                  {band.label}
                </span>
              ))}
            </div>
          )}

          {/* The ratio, stated rather than implied. A map that draws 140 figures for 2,000
              people is lying unless it says so. */}
          {showPeople && crowd.each > 1 && (
            <div className="flex items-center gap-1.5 cf-mono text-[9px] cf-dim2 mt-1.5 pt-1.5"
              style={{ borderTop: "1px solid var(--cf-line)" }}>
              <img src="/sprites/people/attendee-blue-south.png" alt="" width="10" height="10"
                style={{ imageRendering: "pixelated" }} />
              <span>1 FIGURE ≈ {crowd.each} PEOPLE</span>
            </div>
          )}
        </div>
      )}

      <div className="absolute left-3 bottom-3 cf-mono text-[10px] cf-dim2 flex items-center gap-2">
        <span className="px-2 py-1 rounded cf-card-solid">{venue.id}</span>
        <span className="px-2 py-1 rounded cf-card-solid">{(zoom * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ============================================================================
   Primitives
   ========================================================================== */

function usePrefersReducedMotion() {
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

/**
 * Scroll-reveal wrapper.
 *
 * `className` matters when a Reveal is a direct grid child: this element, not the content
 * inside it, is what the grid lays out, so column/row spans have to land here.
 */
function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: "0px 0px -50px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`cf-reveal ${inView ? "cf-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/**
 * The page backdrop.
 *
 * A Paper Shaders grain gradient (WebGL) drifting behind the whole site, with the original
 * CSS mesh kept underneath it as the fallback. The shader is loaded lazily and mounted only
 * in the browser, for three reasons that all have to hold at once:
 *
 *  - the render smoke test runs this file through react-dom/server against a hand-written DOM
 *    shim with no canvas and no WebGL, so a shader mounting during render would break it;
 *  - the shader bundle is ~430KB and nothing above the fold needs it to paint, so keeping it
 *    out of the main chunk is what stops the backdrop delaying first contentful paint;
 *  - a machine with WebGL disabled or blocked must still get a backdrop rather than a void.
 *
 * Under `prefers-reduced-motion` the shader is never loaded at all — it is a continuously
 * animating full-viewport surface, which is exactly what that setting is asking us not to run.
 * The CSS mesh underneath is already static in that mode, so the page keeps its depth.
 */
function MeshField() {
  const reduced = usePrefersReducedMotion();
  const [Shader, setShader] = useState(null);

  useEffect(() => {
    // A cheap capability probe: importing the shader bundle on a machine that cannot run it
    // would be pure download cost for a canvas that never paints.
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) return;
    } catch { return; }

    let alive = true;
    import("@paper-design/shaders-react")
      .then((m) => { if (alive && m?.GrainGradient) setShader(() => m.GrainGradient); })
      .catch(() => { /* stay on the CSS mesh */ });
    return () => { alive = false; };
  }, []);

  return (
    <>
      {/* Fallback / underlay. Always rendered: it is what shows before the shader chunk
          arrives, and what remains if WebGL is unavailable or reduced-motion is set. Once
          the shader is up the mesh fades out — two full-viewport colour fields stacked on
          each other muddy both, and the shader is the better of the two. */}
      <div className="cf-mesh" aria-hidden="true"
        style={{ opacity: Shader ? 0 : 1, transition: "opacity 1.2s var(--cf-ease)" }}>
        <span className="m1" /><span className="m2" /><span className="m3" /><span className="m4" />
      </div>

      {Shader && (
        <div className="cf-shader" aria-hidden="true">
          <Shader
            style={{ width: "100%", height: "100%" }}
            colorBack="#05070B"
            /* The brand ramp: deep blue for the calm ground, then the ember pair, so the
               field reads as the density scale the product is built on rather than as
               arbitrary decoration. Brightened well past the token colours on purpose —
               these are seen through the veil above, which knocks them back. */
            colors={["#1B4FA8", "#4D8DF0", "#E10600", "#FF6A00"]}
            shape="corners"
            softness={0.62}
            intensity={0.55}
            noise={0.32}
            /* Reduced motion freezes the field rather than removing it. Windows in particular
               reports `reduce` whenever "show animations" is off, which is a common default —
               dropping the backdrop entirely there cost those users the whole design for a
               setting that only ever asked us to stop moving things. speed:0 renders one
               static frame, which is exactly what the preference is asking for. */
            speed={reduced ? 0 : 0.9}
          />
        </div>
      )}

      {/* The veil sits above both layers. At full strength the shader would compete with the
          UI for attention and wreck contrast on body copy; this is what keeps it a backdrop. */}
      <div className="cf-mesh-veil" aria-hidden="true" />
      <svg className="cf-grain" aria-hidden="true">
        <filter id="cf-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#cf-noise)" />
      </svg>
    </>
  );
}

function Eyebrow({ children }) {
  return (
    <div className="inline-flex items-center gap-2 cf-accent text-[11px] cf-chip rounded-full px-3 py-1 cf-dim">
      {children}
    </div>
  );
}

/**
 * The product mark.
 *
 * Three swept channels narrowing into a gate, coloured with the density ramp the rest of the
 * app uses — clear blue on top, warming through orange, jammed red at the bottom — with the
 * apex dot standing for the bottleneck being predicted. Inline rather than an <img> so the
 * strokes can inherit currentColor when it is placed on a coloured surface, and so it costs
 * no extra request. `public/favicon.svg` is the same drawing, tuned for 16px.
 */
function LogoMark({ size = 32, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cf-logo-ember" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cf-red)" />
          <stop offset="1" stopColor="var(--cf-orange)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="var(--cf-panel)" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.25" fill="none"
        stroke="url(#cf-logo-ember)" strokeOpacity="0.55" strokeWidth="1.5" />
      <g fill="none" strokeWidth="9" strokeLinecap="round">
        <path d="M13 17 H35" stroke="var(--cf-blue-hi)" />
        <path d="M13 32 H44" stroke="var(--cf-orange)" />
        <path d="M13 47 H29" stroke="var(--cf-red)" />
      </g>
      <circle cx="50" cy="32" r="5.5" fill="var(--cf-ink)" />
    </svg>
  );
}

/** Wordmark + mark, so the header and footer cannot drift apart. */
function Wordmark({ size = 32, className = "" }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className="cf-display font-bold uppercase tracking-wide text-base leading-none">
        Concourse
      </span>
    </span>
  );
}

/**
 * Cursor-following spotlight on a surface.
 *
 * Writes the pointer position to --mx/--my as percentages and lets CSS do the painting, so
 * a mousemove never triggers a React render — at 60Hz over a grid of these, setState would
 * be the single most expensive thing on the page. Pointer events are ignored on coarse
 * pointers, where there is no cursor to follow and the listener would only cost battery.
 */
function Spotlight({ as: Tag = "div", color, className = "", style, children, ...rest }) {
  const ref = useRef(null);

  const onMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  return (
    <Tag
      ref={ref}
      onPointerMove={(e) => { if (e.pointerType !== "touch") onMove(e); }}
      className={`cf-spot cf-spot-edge ${className}`}
      style={color ? { ...style, "--cf-spot-color": color } : style}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Thin reading-progress rail pinned under the header. */
function ScrollProgress() {
  const ref = useRef(null);
  useEffect(() => {
    // Written straight to the node on scroll for the same reason as <Spotlight>: this fires
    // on every frame of a scroll and must not go through React.
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  return <div ref={ref} className="cf-progress w-full" style={{ transform: "scaleX(0)" }} aria-hidden="true" />;
}

/**
 * A button that leans toward the cursor.
 *
 * Capped at a few pixels — enough to feel responsive, small enough that the button never
 * slides out from under the pointer that is chasing it.
 */
function Magnetic({ children, strength = 6, className = "", ...rest }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();

  const onMove = (e) => {
    const el = ref.current;
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = "translate(0,0)"; };

  return (
    <span ref={ref} onPointerMove={onMove} onPointerLeave={reset}
      className={`inline-block will-change-transform ${className}`}
      style={{ transition: "transform .35s var(--cf-ease)" }} {...rest}>
      {children}
    </span>
  );
}

/** Seamless marquee. The track is duplicated so the -50% keyframe lands on an identical frame. */
function Ticker({ items, className = "" }) {
  return (
    <div className={`overflow-hidden cf-edge-fade ${className}`} aria-hidden="true">
      <div className="cf-marquee-track flex w-max items-center gap-10">
        {[0, 1].map((copy) => (
          <React.Fragment key={copy}>
            {items.map((t, i) => (
              <span key={`${copy}-${i}`} className="flex items-center gap-10 shrink-0">
                <span className="cf-accent text-[11px] cf-dim2 whitespace-nowrap">{t}</span>
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: "var(--cf-line2)" }} />
              </span>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * A headline figure that counts up the first time it is scrolled into view.
 *
 * Distinct from <CountUp>, which tracks a value that keeps changing on a live feed. This one
 * animates once, from zero, as a reveal — so it is driven by an IntersectionObserver rather
 * than by prop changes, and it deliberately never replays on scroll-back.
 */
function CountOnView({ value, prefix = "", suffix = "", duration = 1400 }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) { setShown(value); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(value); return; }

    let raf = 0, start = 0;
    const io = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting) return;
      io.disconnect();
      const step = (t) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / duration);
        // Same deceleration curve as --cf-ease, so the number settles like everything else.
        setShown(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });

    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, duration, reduced]);

  return <span ref={ref}>{prefix}{Math.round(shown).toLocaleString()}{suffix}</span>;
}

/* ----------------------------------------------------------------------------
   Dot-matrix reveal — supplied component's shader, ported to this project's WebGL engine.

   The GLSL below is the author's fragment shader essentially unchanged: the same dot grid,
   the same `random`/PHI hash, the same intro timing that fans out from the centre and outro
   timing that collapses in from the edges via `u_reverse`.

   What changed is the engine underneath it. The original mounts the shader through
   @react-three/fiber, which pulls in Three.js — about 25MB for one screen's backdrop. This
   app already ships @paper-design/shaders-react (~430KB), whose <ShaderMount> takes an
   arbitrary fragment shader and supplies u_time/u_resolution on the same GLSL 3.00 ES
   target. Two edits were needed to retarget it:

     - the R3F version declares `in vec2 fragCoord` from its own vertex shader; here the
       built-in gl_FragCoord is used instead, so no custom vertex stage is required;
     - uniforms are passed as plain values rather than the {value,type} descriptors that
       version hand-marshals into THREE.Vector3 objects.
   -------------------------------------------------------------------------- */

const DOT_MATRIX_FRAGMENT = `#version 300 es
precision mediump float;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform float u_reverse;
uniform float u_speed;

out vec4 fragColor;

float PHI = 1.61803398874989484820459;
float random(vec2 xy) {
  return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}

void main() {
  vec2 st = gl_FragCoord.xy;
  st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
  st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

  float opacity = step(0.0, st.x);
  opacity *= step(0.0, st.y);

  vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

  float frequency = 5.0;
  float show_offset = random(st2);
  float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
  opacity *= u_opacities[int(rand * 10.0)];
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

  vec3 color = u_colors[int(show_offset * 6.0)];

  vec2 center_grid = u_resolution / 2.0 / u_total_size;
  float dist_from_center = distance(center_grid, st2);

  float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);
  float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
  float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

  float t = u_time * u_speed;
  if (u_reverse > 0.5) {
    opacity *= 1.0 - step(timing_offset_outro, t);
    opacity *= clamp((step(timing_offset_outro + 0.1, t)) * 1.25, 1.0, 1.25);
  } else {
    opacity *= step(timing_offset_intro, t);
    opacity *= clamp((1.0 - step(timing_offset_intro + 0.1, t)) * 1.25, 1.0, 1.25);
  }

  fragColor = vec4(color, opacity);
  fragColor.rgb *= fragColor.a;
}`;

/**
 * The dot grid itself. Lazy-loads the shader engine for the same reasons <MeshField> does:
 * it must not run during the server-render smoke test, and the bundle should not block paint.
 * If WebGL is unavailable the component simply renders nothing — it is pure decoration, and
 * the sign-in panel above it stands on its own.
 */
function CanvasRevealEffect({ colors = [[255, 255, 255]], dotSize = 6, speed = 3, reverse = false, opacity = 1 }) {
  const [Mount, setMount] = useState(null);

  useEffect(() => {
    try {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
    } catch { return; }
    let alive = true;
    import("@paper-design/shaders-react")
      .then((m) => { if (alive && m?.ShaderMount) setMount(() => m.ShaderMount); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // The author's DotMatrix widens 1–3 supplied colours into the 6 the shader indexes into.
  const uniforms = useMemo(() => {
    const c = colors.length >= 3
      ? [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]]
      : colors.length === 2
        ? [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]]
        : Array(6).fill(colors[0]);
    return {
      u_colors: c.map(([r, g, b]) => [r / 255, g / 255, b / 255]),
      u_opacities: [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1],
      u_total_size: 20,
      u_dot_size: dotSize,
      u_reverse: reverse ? 1 : 0,
      u_speed: speed * 0.1,
    };
  }, [colors, dotSize, reverse, speed]);

  if (!Mount) return null;
  return (
    <div className="absolute inset-0" style={{ opacity }} aria-hidden="true">
      <Mount fragmentShader={DOT_MATRIX_FRAGMENT} uniforms={uniforms}
        style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Core header — supplied component, ported TSX → JS.

   Two changes from the source, both forced by this codebase rather than taste:

   - the shadcn semantic tokens it was written against (--muted, --primary, --accent,
     bg-background) do not exist here, so every colour is re-pointed at the --cf-* palette;
   - the avatar is optional. The original always renders a face and the words "Active Now",
     which on a marketing page would tell a logged-out visitor they are signed in.
   -------------------------------------------------------------------------- */

/**
 * The bar itself: a title on the left, an optional signed-in identity on the right, and the
 * diagonal grid-fade behind both. `children` is the slot the marketing header fills with its
 * nav, so both surfaces share one chrome.
 */
/**
 * `userAvatar` replaces the built-in circle, and `onUserClick` makes the whole identity block
 * the control that opens the account. Both optional: the public header still uses the plain
 * initial below, because signed-out and marketing pages have no profile to open.
 */
function CoreHeaderBar({ title, eyebrow, userName, userStatus = "Active now", userImage,
                         userAvatar, onUserClick, accent, children, right }) {
  return (
    <div className="relative h-16 flex items-center justify-between gap-4 px-4 sm:px-6 overflow-hidden">
      <div className="cf-gridfade" aria-hidden="true" />

      <div className="relative z-10 flex items-center gap-3 min-w-0">
        {title}
      </div>

      {children}

      <div className="relative z-10 flex items-center gap-3 shrink-0">
        {right}
        {userName && createElement(
          onUserClick ? "button" : "div",
          {
            ...(onUserClick
              ? {
                  onClick: onUserClick,
                  "aria-label": `Profile — ${userName}`,
                  className: "cf-focus rounded-full flex items-center gap-3 shrink-0 transition-opacity duration-200 hover:opacity-80",
                }
              : { className: "flex items-center gap-3 shrink-0" }),
          },
          <div key="who" className="hidden sm:flex flex-col items-end leading-tight">
            <span className="cf-accent text-[10px] truncate max-w-[16ch]" style={{ color: "var(--cf-ink)" }}>{userName.toUpperCase()}</span>
            <span className="cf-accent text-[9px] cf-dim2 opacity-70 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent || "var(--cf-green)" }} />
              {userStatus.toUpperCase()}
            </span>
          </div>,
          /* One avatar, not two. A caller that has a real account passes its own — carrying the
             uploaded picture and the generated fallback — and it replaces this circle entirely
             rather than sitting beside it. */
          userAvatar
            ? <span key="avatar" className="shrink-0">{userAvatar}</span>
            : (
              <div key="avatar" className="size-9 rounded-full overflow-hidden p-0.5 shrink-0"
                style={{ border: `1px solid ${accent || "var(--cf-line2)"}`, background: "var(--cf-panel)" }}>
                {userImage
                  ? <img src={userImage} alt="" className="size-full rounded-full object-cover" />
                  : (
                    /* No profile behind this one — an initial on the role's own colour names the
                       account without inventing a face for it. */
                    <span className="size-full rounded-full flex items-center justify-center cf-display font-black text-xs"
                      style={{ background: `color-mix(in oklab, ${accent || "var(--cf-blue-hi)"} 22%, transparent)`, color: accent || "var(--cf-blue-hi)" }}>
                      {userName.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/**
 * The segmented filter strip. Horizontally scrollable with the scrollbar hidden, and a fade
 * on the right edge so a strip that overflows reads as continuing rather than as cut off.
 */
function CoreStrip({ links, current, onChange, accent, transparent = false }) {
  return (
    <div className="relative group transition-colors duration-300"
      style={{
        borderTop: `1px solid ${transparent ? "transparent" : "var(--cf-line)"}`,
        background: "transparent",
      }}>
      <div className="cf-strip">
        {links.map((l) => {
          const active = current === l.href;
          return (
            <button key={l.href} type="button" onClick={() => onChange(l.href)}
              data-active={active} aria-current={active ? "page" : undefined}
              className="cf-strip-item cf-focus"
              style={active ? { color: accent || "var(--cf-orange)" } : undefined}>
              {l.name}
              {active && (
                <motion.span layoutId="cf-strip-underline" className="absolute left-0 right-0 bottom-0 h-0.5"
                  initial={false} transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  style={{ background: accent || "var(--cf-orange)" }} />
              )}
            </button>
          );
        })}
      </div>
      <div className="md:hidden absolute right-0 top-0 bottom-0 w-8 pointer-events-none"
        style={{ background: "linear-gradient(270deg, var(--cf-bg), transparent)" }} aria-hidden="true" />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Bento tile visuals — supplied component's pattern, ported TSX → JS.

   The structure is kept: an asymmetric 6-column grid where each tile carries a small live
   animation above its label, instead of a static icon. The demos themselves are rewritten,
   because the originals showed a scaling "Aa", a CDN globe and a phone — none of which this
   product does. Each one below animates a mechanic the copy underneath actually claims, so
   the picture is evidence for the sentence rather than decoration beside it.

   All of them freeze under `prefers-reduced-motion`: they are decorative loops, and a
   permanently cycling animation is the thing that setting exists to stop.
   -------------------------------------------------------------------------- */

/**
 * Congestion spreading along the graph.
 *
 * A row of five zones. One goes critical, then its neighbours climb in sequence — the
 * propagation the model predicts, which a per-node threshold cannot see coming.
 */
function DemoPropagation() {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(reduced ? 2 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setStep((s) => (s + 1) % 5), 900);
    return () => clearInterval(t);
  }, [reduced]);

  // Distance from the origin zone decides how hot each bar is, so the wave reads as
  // travelling outward rather than as five independent blinks.
  const heat = (i) => {
    const d = Math.abs(i - 2);
    const reach = step - d;
    return reach <= 0 ? 0 : Math.min(1, reach / 2);
  };

  return (
    // A fixed-height track keeps the bars vertically centred in the tile: percentage heights
    // need a definite box to resolve against, and the flex parent alone does not give them one.
    <div className="h-full flex items-center justify-center" aria-hidden="true">
      <div className="flex items-end justify-center gap-2 h-24">
        {[0, 1, 2, 3, 4].map((i) => {
          const h = heat(i);
          return (
            <motion.div key={i} className="w-7 rounded-md"
              animate={{ height: `${26 + h * 70}px`, backgroundColor: densityColor(h * 0.95) }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              style={{ height: "26px", background: densityColor(0) }} />
          );
        })}
      </div>
    </div>
  );
}

/**
 * A route bending around a jam.
 *
 * The straight path through the middle turns red; the drawn line takes the long way round.
 * Two stroked paths on one viewBox, cross-fading, so the detour reads as a decision.
 */
function DemoRoute() {
  const reduced = usePrefersReducedMotion();
  const [detour, setDetour] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setDetour((d) => !d), 2400);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <div className="h-full flex items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 160 80" className="w-full max-w-[190px] h-full">
        <line x1="12" y1="40" x2="148" y2="40" stroke="var(--cf-line2)" strokeWidth="2" strokeDasharray="3 4" />
        <motion.circle cx="80" cy="40" r="9"
          animate={{ fill: detour ? "var(--cf-red)" : "var(--cf-line2)", opacity: detour ? 0.9 : 0.45 }}
          transition={{ duration: 0.5 }} />
        <motion.path
          d={detour ? "M12 40 Q 50 40 62 22 Q 80 6 98 22 Q 110 40 148 40" : "M12 40 L148 40"}
          fill="none" stroke="var(--cf-blue-hi)" strokeWidth="2.5" strokeLinecap="round"
          animate={{ d: detour ? "M12 40 Q 50 40 62 22 Q 80 6 98 22 Q 110 40 148 40" : "M12 40 L148 40" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} />
        <circle cx="12" cy="40" r="4" fill="var(--cf-green)" />
        <circle cx="148" cy="40" r="4" fill="var(--cf-violet)" />
      </svg>
    </div>
  );
}

/**
 * The paired baseline.
 *
 * Two bars — the run without rerouting against the run with it — counting to their values,
 * which is the entire claim of the results page in one picture.
 */
function DemoBaseline() {
  const reduced = usePrefersReducedMotion();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (reduced) return;
    // Asymmetric on purpose: a long rest at the real value, then a brief snap back to 100%
    // to replay the drop. An even flip would leave the "no difference" frame on screen half
    // the time.
    let t;
    const cycle = () => {
      setOn(true);
      t = setTimeout(() => { setOn(false); t = setTimeout(cycle, 2600); }, 380);
    };
    t = setTimeout(cycle, 2600);
    return () => clearTimeout(t);
  }, [reduced]);

  // The baseline is the constant to compare against, so it stays pinned at 100%.
  //
  // The optimised bar rests at its real value and only springs back to 100% for the instant
  // the loop replays. An earlier version split the cycle evenly between 72% and 100%, which
  // meant half of every loop showed two identical bars — a state that says the intervention
  // did nothing, i.e. the opposite of the claim, and reads as a broken chart when a
  // screenshot happens to land on it.
  const rows = [
    { l: "NO STRATEGY", pct: 100, c: "var(--cf-red)" },
    { l: "WITH STRATEGY", pct: on ? 100 : 72, c: "var(--cf-green)" },
  ];

  return (
    <div className="h-full flex flex-col justify-center gap-4 w-full" aria-hidden="true">
      {rows.map((r) => (
        <div key={r.l}>
          <div className="flex justify-between mb-1.5">
            <span className="cf-accent text-[9px] cf-dim2">{r.l}</span>
            <span className="cf-mono text-[10px] cf-tnum" style={{ color: r.c }}>{r.pct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <motion.div className="h-full rounded-full"
              initial={false}
              animate={{ width: `${r.pct}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              style={{ background: r.c }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Live tick counter — the ~100ms cadence, stated as a number that keeps moving. */
function DemoTick() {
  const reduced = usePrefersReducedMotion();
  const [tick, setTick] = useState(1284);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setTick((n) => n + 1), 420);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2" aria-hidden="true">
      <div className="cf-display font-black text-4xl cf-tnum" style={{ color: "var(--cf-ink)" }}>
        {tick.toLocaleString()}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="relative flex w-1.5 h-1.5">
          {!reduced && <span className="cf-ping absolute inline-flex w-full h-full rounded-full" style={{ background: "var(--cf-green)" }} />}
          <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--cf-green)" }} />
        </span>
        <span className="cf-accent text-[9px] cf-dim2">TICKS SIMULATED</span>
      </div>
    </div>
  );
}

/**
 * In-memory sessions: the venue graph itself, with nodes lighting in sequence and no store
 * behind them. Deliberately abstract — the claim is about what is *absent*, so the picture
 * shows the graph standing alone rather than inventing a database icon to cross out.
 */
function DemoGraph() {
  const reduced = usePrefersReducedMotion();
  const [lit, setLit] = useState(reduced ? 5 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setLit((n) => (n + 1) % 7), 700);
    return () => clearInterval(t);
  }, [reduced]);

  const nodes = [
    { x: 22, y: 46 }, { x: 60, y: 20 }, { x: 60, y: 68 },
    { x: 104, y: 34 }, { x: 104, y: 72 }, { x: 142, y: 48 },
  ];
  const edges = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5], [1, 2]];

  return (
    <div className="h-full flex items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 164 92" className="w-full max-w-[200px] h-full">
        {edges.map(([a, b], i) => (
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
            stroke="var(--cf-line2)" strokeWidth="1.5" />
        ))}
        {nodes.map((n, i) => (
          <motion.circle key={i} cx={n.x} cy={n.y} r="6"
            animate={{
              fill: i < lit ? "var(--cf-orange)" : "var(--cf-panel)",
              opacity: i < lit ? 1 : 0.6,
            }}
            transition={{ duration: 0.4 }}
            stroke="var(--cf-line2)" strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}

/** The three role portals, cycling — the same data, three different views. */
function DemoPortals() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const roles = Object.values(ROLES);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setActive((a) => (a + 1) % 3), 1500);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <div className="h-full flex items-center justify-center gap-3" aria-hidden="true">
      {roles.map((r, i) => (
        <motion.div key={r.key} className="w-12 h-12 rounded-xl flex items-center justify-center"
          animate={{
            scale: active === i ? 1.12 : 1,
            backgroundColor: active === i
              ? `color-mix(in oklab, ${r.color} 24%, transparent)`
              : "rgba(255,255,255,0.04)",
          }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <r.Icon className="w-5 h-5" strokeWidth={2}
            style={{ color: active === i ? r.color : "var(--cf-dim2)" }} />
        </motion.div>
      ))}
    </div>
  );
}

/** A bento tile: spotlight surface + the shared tile material, with an optional accent. */
function Bento({ color, className = "", children, ...rest }) {
  return (
    <Spotlight color={color} className={`cf-bento rounded-2xl ${className}`} {...rest}>
      {children}
    </Spotlight>
  );
}

/**
 * A number that counts to its new value instead of jumping.
 *
 * Used on the live metrics, where the value changes five times a second. The point is
 * not decoration: a figure that snaps between 1,840 and 1,920 is read as noise, while
 * one that travels is read as a direction — which is the thing an operator is actually
 * looking for. Short duration so it has always settled before the next frame lands.
 *
 * Falls straight through to the plain number under `prefers-reduced-motion`.
 */
function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 400 }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    if (reduced) { setShown(value); return undefined; }

    const from = fromRef.current;
    const delta = value - from;
    if (delta === 0) return undefined;

    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // easeOutCubic: fast to start, settles gently — reads as arriving, not sliding.
      const eased = 1 - (1 - t) ** 3;
      setShown(from + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration, reduced]);

  // Keep the start point honest when a re-render interrupts an animation in flight.
  useEffect(() => { if (reduced) fromRef.current = value; }, [value, reduced]);

  return <>{format(shown)}</>;
}

/**
 * A live value whose colour and width both track a 0–1 ratio.
 *
 * One component rather than a bar and a number wired up separately at each call site,
 * because the two must never disagree — a bar drawn from density and a percentage
 * printed from occupancy is exactly how a dashboard starts lying.
 */
function DensityBar({ density, height = 4, color }) {
  const reduced = usePrefersReducedMotion();
  const pct = Math.min(100, Math.max(0, (density ?? 0) * 100));
  return (
    <div className="rounded-full bg-white/5 overflow-hidden" style={{ height }}>
      <motion.div className="h-full rounded-full"
        initial={false}
        animate={{ width: `${pct}%`, background: color ?? trafficBand(density).color }}
        transition={reduced ? { duration: 0 } : { duration: 0.45, ease: [0.16, 1, 0.3, 1] }} />
    </div>
  );
}

function SectionHeading({ eyebrow, title, lede, center = false }) {
  return (
    <div className={`max-w-2xl mb-12 ${center ? "mx-auto text-center" : ""}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="cf-display font-black uppercase text-3xl sm:text-4xl tracking-tight mt-4 mb-3">{title}</h2>
      <p className="cf-dim text-base leading-relaxed">{lede}</p>
    </div>
  );
}

function PageHeader({ eyebrow, title, lede }) {
  return (
    <section className="relative border-b cf-hairline">
      {/* Top padding clears the fixed header, which is a 64px bar plus the ~48px route strip
          on large screens and just the bar below that. */}
      <div className="relative max-w-7xl mx-auto px-6 pt-32 lg:pt-40 pb-16">
        <Reveal>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="cf-display font-black uppercase tracking-tight mt-5 mb-5" style={{ fontSize: "clamp(2.5rem, 5.5vw, 4rem)", lineHeight: 1.02 }}>
            <GradientShimmer gradient="ember">{title}</GradientShimmer>
          </h1>
          <p className="cf-dim text-lg leading-relaxed max-w-2xl">{lede}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================================
   Router
   ========================================================================== */

const NAV = [
  { path: "/", label: "Home" },
  { path: "/how", label: "How it works" },
  { path: "/platform", label: "Platform" },
  { path: "/intelligence", label: "Intelligence" },
  { path: "/results", label: "Results" },
];

function useHashRoute() {
  const read = () => {
    if (typeof window === "undefined") return "/";
    const h = window.location.hash.replace(/^#/, "");
    return h && h.startsWith("/") ? h : "/";
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const navigate = useCallback((p) => {
    if (typeof window !== "undefined") window.location.hash = p;
    setRoute(p);
  }, []);
  return [route, navigate];
}

/* ============================================================================
   Header
   ========================================================================== */

function Header({ route, navigate, session, signOut, inPortal = false }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 30);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [route]);
  const go = (e, p) => { e.preventDefault(); navigate(p); };

  const lifted = solid || open;

  /*
   * A portal draws its own chrome, so the site header stands down entirely.
   *
   * With the marketing routes gone from it this bar had nothing left but the logo — a 64px
   * strip of almost nothing, floating above the portal's own bar with a dead gap between the
   * two. Two bars where one is empty reads as a layout that broke rather than as a frame. The
   * logo moves into PortalShell's bar, which becomes the single piece of chrome.
   *
   * After every hook above, so the hook order stays identical on both paths.
   */
  if (inPortal) return null;

  return (
    // The blur is applied unconditionally and its *opacity* is what animates.
    // `backdrop-filter` is a discrete property: toggling it between "none" and a blur cannot
    // transition, so the old version snapped the whole bar on the first scroll tick — which
    // is what made the header lurch on the way down. Painting the background on a child that
    // fades keeps the change continuous.
    <header className="fixed top-0 left-0 right-0 z-50">
      <div aria-hidden="true" className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: lifted ? 1 : 0,
          background: "rgba(5,7,11,0.86)",
          backdropFilter: "blur(14px) saturate(120%)",
          WebkitBackdropFilter: "blur(14px) saturate(120%)",
          borderBottom: "1px solid var(--cf-line)",
        }} />
      <ScrollProgress />
      <div className="relative max-w-7xl mx-auto">
        <CoreHeaderBar
          accent="var(--cf-orange)"
          /* Only a real session produces an identity here. The source component always drew
             an avatar and "Active now"; on a public page that would tell a logged-out
             visitor they are signed in.
             Inside a portal the identity is suppressed entirely: PortalShell renders its own
             bar with the same account and sign-out directly below this one, and showing both
             put the same email and avatar on screen twice. */
          userName={inPortal ? undefined : session?.email}
          userStatus="Signed in"
          title={
            <a href="#/" onClick={(e) => go(e, "/")} className="group flex items-center gap-2.5 cf-focus rounded shrink-0">
              <span className="transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-105"
                style={{ transitionTimingFunction: "var(--cf-ease)" }}>
                <LogoMark size={30} />
              </span>
              {/* The source wordmark is italic and tight; this typeface is already condensed,
                  so tracking-tight on top of it closed the letterforms up. Normal tracking
                  keeps "Concourse" legible at 16px. */}
              <span className="cf-display font-bold uppercase text-base leading-none italic whitespace-nowrap">
                Concourse
              </span>
            </a>
          }
          right={
            <>
              {session ? (
                <div className="hidden lg:flex items-center gap-3">
                  <Magnetic strength={4}>
                    <a href={`#/app/${session.role}`} onClick={(e) => go(e, `/app/${session.role}`)}
                      className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2 cf-accent text-[11px] block">
                      MY PORTAL
                    </a>
                  </Magnetic>
                  <button onClick={signOut} className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">SIGN OUT</button>
                </div>
              ) : (
                <div className="hidden lg:flex items-center gap-3">
                  <Magnetic strength={4}>
                    <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2 cf-accent text-[11px] block">
                      OPEN PORTAL
                    </a>
                  </Magnetic>
                </div>
              )}
              {/* The drawer only carries site routes, so inside a portal it has nothing to
                  open. Sign out lives in the portal's own bar. */}
              {!inPortal && (
                <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
                  className="lg:hidden cf-focus cf-btn-outline rounded-lg w-9 h-9 flex items-center justify-center">
                  {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
              )}
            </>
          }
        />

        {/* Routes as a segmented strip rather than spaced links. Hidden on small screens,
            where the drawer below already carries the same destinations.

            Not rendered inside a portal at all. A portal is the application, not a page of the
            marketing site, and carrying the site's routes into it is what offered a signed-in
            attendee a lane to the other tiers' sign-in screens. The portal's own bar below
            already holds the account, its tabs and sign out. */}
        <div className={inPortal ? "hidden" : "hidden lg:block"}>
          {/* At rest the header is transparent over the hero, so the strip drops its own
              background and rules to match; they fade in together on scroll. */}
          <CoreStrip accent="var(--cf-orange)" current={route} transparent={!solid && !open}
            onChange={(href) => navigate(href)}
            links={NAV.map((r) => ({ name: r.label, href: r.path }))} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && !inPortal && (
          <motion.div key="cf-mobile-nav" className="lg:hidden border-t cf-hairline overflow-hidden"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
            <div className="px-6 py-4 flex flex-col gap-1">
              {NAV.map((r, i) => (
                <motion.a key={r.path} href={`#${r.path}`} onClick={(e) => go(e, r.path)}
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i + 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="cf-accent text-sm py-2.5 cf-focus rounded flex items-center justify-between"
                  style={{ color: route === r.path ? "var(--cf-orange)" : "var(--cf-dim)" }}>
                  {r.label.toUpperCase()}
                  {route === r.path && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cf-orange)" }} />}
                </motion.a>
              ))}
              {session ? (
                <>
                  <a href={`#/app/${session.role}`} onClick={(e) => go(e, `/app/${session.role}`)}
                    className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2.5 cf-accent text-[11px] text-center mt-3">
                    MY PORTAL
                  </a>
                  <button onClick={signOut} className="cf-focus cf-btn-outline rounded-lg px-4 py-2.5 cf-accent text-[10px] mt-2">
                    SIGN OUT
                  </button>
                </>
              ) : (
                <a href="#/access" onClick={(e) => go(e, "/access")} className="cf-focus cf-btn-primary cf-shine rounded-lg px-4 py-2.5 cf-accent text-[11px] text-center mt-3">
                  OPEN PORTAL
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ============================================================================
   Marketing pages
   ========================================================================== */

function WordCarousel({ words, interval = 2500 }) {
  const [cur, setCur] = useState(0);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setCur((p) => (p + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [interval, words.length, reduced]);
  return (
    <span className="relative inline-flex w-full justify-center overflow-hidden align-bottom" style={{ height: "1.15em" }}>
      &nbsp;
      {words.map((w, i) => (
        <span key={w} className="absolute" style={{
          transform: reduced ? "none" : `translateY(${i === cur ? "0" : i < cur ? "-120%" : "120%"})`,
          opacity: i === cur ? 1 : 0,
          transition: reduced ? "none" : "transform .6s var(--cf-ease), opacity .5s ease",
        }}>
          <GradientShimmer gradient="ember">{w}</GradientShimmer>
        </span>
      ))}
    </span>
  );
}

/**
 * The map shown on the marketing pages.
 *
 * If a session is running on the backend, it shows that session, live. If not, it shows the
 * sample arena as a still layout with no crowd on it. What it never does is animate invented
 * people — a landing page implying live data it does not have is the one lie a monitoring
 * product cannot afford.
 */
function useShowcase() {
  const { sessions } = useSessionList(10000);
  const flow = useConcourse();

  const running = sessions.find((s) => s.status === "RUNNING") ?? sessions[0];

  useEffect(() => {
    if (running && !flow.sessionId) flow.attach(running.sessionId).catch(() => {});
  }, [running?.sessionId, flow.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallback = useMemo(() => toMapVenue(sampleVenue), []);

  return flow.venue
    ? { venue: flow.venue, people: flow.people, live: true }
    : { venue: fallback, people: [], live: false };
}

/** Small caption under a showcase map, so nobody has to guess whether it is real. */
function ShowcaseNote({ live }) {
  return (
    <p className="cf-mono text-[10px] cf-dim2 mt-3 text-center">
      {live
        ? "LIVE — streaming from a running session"
        : "SAMPLE LAYOUT — no session running; start one from the client portal"}
    </p>
  );
}

/* ----------------------------------------------------------------------------
   Role card previews.

   One small piece of art per portal, drawn from the same venue vocabulary the app itself
   uses — zones, walkways, a route, a density ramp. The point is that the card shows what the
   role actually sees rather than putting a generic icon above a paragraph.

   All three are static SVG: they sit three-up above the fold on the home page, and three
   more animation loops there would cost more than they add. Motion on this section comes
   from the hover state instead.
   -------------------------------------------------------------------------- */

/** Walker: one dot on the map, and the way out. */
function RolePreviewWalker({ color }) {
  return (
    <svg viewBox="0 0 200 110" className="w-full h-full" aria-hidden="true">
      <g stroke="var(--cf-line2)" strokeWidth="1.5" fill="none" opacity=".55">
        <path d="M18 74 H70 V34 H128 V74 H182" />
        <path d="M70 74 V96" /><path d="M128 34 V14" />
      </g>
      {/* The route the walker is given, drawn over the plan in the accent. */}
      <path d="M28 88 Q 52 88 70 74 T 128 34 Q 150 26 172 26" fill="none"
        stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 6" />
      <circle cx="172" cy="26" r="4.5" fill="var(--cf-violet)" />
      <g>
        <circle cx="28" cy="88" r="9" fill={color} opacity=".18" />
        <circle cx="28" cy="88" r="4" fill={color} />
      </g>
    </svg>
  );
}

/** Client: zones filling, on the density ramp. */
function RolePreviewClient({ color }) {
  const zones = [
    { x: 14, w: 52, d: 0.24 }, { x: 72, w: 44, d: 0.58 },
    { x: 122, w: 38, d: 0.9 }, { x: 166, w: 22, d: 0.36 },
  ];
  return (
    <svg viewBox="0 0 200 110" className="w-full h-full" aria-hidden="true">
      {/* Walkways behind the zones, so the fill reads as rooms on a plan. */}
      <g stroke="var(--cf-line2)" strokeWidth="1.5" opacity=".5">
        <line x1="10" y1="52" x2="190" y2="52" />
        <line x1="68" y1="16" x2="68" y2="92" />
        <line x1="118" y1="16" x2="118" y2="92" />
      </g>
      {zones.map((z, i) => {
        const h = 16 + z.d * 44;
        return (
          <g key={i}>
            <rect x={z.x} y={88 - h} width={z.w} height={h} rx="2"
              fill={densityColor(z.d)} opacity={0.22 + z.d * 0.42} />
            <rect x={z.x} y={88 - h} width={z.w} height="2" fill={densityColor(z.d)} />
          </g>
        );
      })}
      <line x1="10" y1="90" x2="190" y2="90" stroke="var(--cf-line2)" strokeWidth="1.5" />
    </svg>
  );
}

/** Admin: many venues at once, one of them flagged. */
function RolePreviewAdmin({ color }) {
  // Deliberately calm apart from one: the admin view is about spotting the exception, and a
  // grid where every tile is lit says the opposite.
  const cells = [
    [0, 0, 0.10], [1, 0, 0.16], [2, 0, 0.08], [3, 0, 0.13],
    [0, 1, 0.18], [1, 1, 0.94], [2, 1, 0.12], [3, 1, 0.30],
    [0, 2, 0.11], [1, 2, 0.20], [2, 2, 0.44], [3, 2, 0.09],
  ];
  return (
    <svg viewBox="0 0 200 110" className="w-full h-full" aria-hidden="true">
      {cells.map(([cx, cy, d], i) => {
        const x = 24 + cx * 40, y = 16 + cy * 28;
        const flagged = d > 0.85;
        return (
          <g key={i}>
            <rect x={x} y={y} width="30" height="20" rx="3"
              fill={flagged ? densityColor(d) : "var(--cf-line2)"}
              opacity={flagged ? 0.9 : 0.3 + d * 0.5} />
            {flagged && (
              <rect x={x - 2.5} y={y - 2.5} width="35" height="25" rx="5"
                fill="none" stroke={color} strokeWidth="1.5" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function HomePage({ navigate }) {
  const { venue, people, live } = useShowcase();
  return (
    <div className="cf-page-in">
      <section className="relative px-6 pt-28 lg:pt-36 pb-16 overflow-hidden">
        {/* Slow conic wash behind the headline only. Clipped by the section so it never
            bleeds into the cards below, and sat under the mesh veil so it reads as depth
            rather than a second competing background. */}
        <div className="absolute inset-x-0 top-0 h-[70vh] pointer-events-none opacity-70" aria-hidden="true"
          style={{ maskImage: "radial-gradient(70% 60% at 50% 30%, #000, transparent)", WebkitMaskImage: "radial-gradient(70% 60% at 50% 30%, #000, transparent)" }}>
          <div className="cf-aurora" />
        </div>

        <div className="max-w-7xl mx-auto text-center relative">
          <Reveal>
            <a href="#/access" onClick={(e) => { e.preventDefault(); navigate("/access"); }}
              className="cf-focus cf-accent group inline-flex items-center gap-3 text-[11px] cf-chip rounded-full pl-4 pr-3 py-2 mb-10 cf-dim hover:border-(--cf-line2) transition-colors">
              <span className="relative flex w-1.5 h-1.5">
                <span className="cf-ping absolute inline-flex w-full h-full rounded-full" style={{ background: "var(--cf-orange)" }} />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--cf-orange)" }} />
              </span>
              THREE PORTALS · ONE LIVE MAP
              <MoveRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <h1 className="cf-display font-black uppercase tracking-tight max-w-4xl mx-auto" style={{ fontSize: "clamp(2.5rem, 6.5vw, 5rem)", lineHeight: 1 }}>
              <span className="block"><GradientShimmer gradient="ember">Know where the crowd</GradientShimmer></span>
              <span className="block"><GradientShimmer gradient="ember">is going to break —</GradientShimmer></span>
              <WordCarousel words={["live.", "predictive.", "measurable.", "on every phone."]} />
            </h1>
            <p className="mt-6 max-w-xl mx-auto leading-relaxed cf-dim" style={{ fontSize: "clamp(1rem, 1.4vw, 1.15rem)" }}>
              Attendees see themselves on the venue map. Organisers see every zone filling in real time.
              We see the whole network — and the bottleneck forming three ticks before it does.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Magnetic>
                <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary cf-shine rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  Open a portal
                </button>
              </Magnetic>
              <Magnetic>
                <button onClick={() => navigate("/platform")} className="cf-focus cf-btn-outline rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  See the platform
                </button>
              </Magnetic>
            </div>
          </Reveal>

          <Reveal delay={140}>
            {/* The map is the product, so it gets treated as the hero image: raised on its own
                plinth with an ember glow under it, and a caption bar that names what is on
                screen. The glow is behind the frame, never over the map itself — tinting live
                density data would make the colours lie. */}
            <div className="mt-12 max-w-5xl mx-auto relative">
              <div className="absolute -inset-x-8 -bottom-6 h-24 pointer-events-none opacity-60" aria-hidden="true"
                style={{ background: "radial-gradient(60% 100% at 50% 100%, rgba(225,6,0,.45), transparent 70%)", filter: "blur(28px)" }} />
              <div className="relative rounded-3xl p-2 cf-card-solid" style={{ boxShadow: "var(--cf-shadow-lg)" }}>
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-1.5" aria-hidden="true">
                    {["var(--cf-red)", "var(--cf-amber)", "var(--cf-green)"].map((c) => (
                      <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.55 }} />
                    ))}
                  </div>
                  <span className="cf-mono text-[10px] cf-dim2 tracking-widest">{venue.name?.toUpperCase() ?? "VENUE"}</span>
                  <ConnectionPill connected={live} status={live ? "RUNNING" : "CREATED"} />
                </div>
                <div className="rounded-2xl overflow-hidden">
                  <VenueMap venue={venue} people={people} me={null} height={440} />
                </div>
              </div>
              <ShowcaseNote live={live} />
            </div>
          </Reveal>
        </div>

        <Reveal delay={220}>
          <div className="mt-16 max-w-5xl mx-auto">
            <Ticker items={[
              "PREDICTIVE CONGESTION MODEL", "2,500 AGENTS PER RUN", "~100MS TICK",
              "GRAPH-AWARE REROUTING", "PAIRED BASELINE SIMULATION", "THREE ROLE PORTALS",
              "LIVE WEBSOCKET STREAM", "NO DATABASE REQUIRED",
            ]} />
          </div>
        </Reveal>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20 border-t cf-hairline">
        <Reveal><SectionHeading eyebrow="WHO IT'S FOR" title="Three views of the same venue" lede="Same live data, three very different jobs — and each portal only ever shows what that role should see." center /></Reveal>

        {/* Role cards.
         *
         * These used to be an icon tile above four stacked lines of text — the same shape as
         * every other feature card on the internet, and nothing in them said what this
         * product is. Each card now *shows* its role instead of only describing it: the
         * walker gets a single dot with a route out, the client gets zones filling, the admin
         * gets a grid of venues. The art is the same venue graph the app draws, so the card
         * previews the thing you get by clicking it.
         *
         * The oversized index numeral and the full-bleed footer bar give the three a
         * deliberate reading order and a real click target, rather than a text link.
         */}
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { n: "01", Preview: RolePreviewWalker, role: "Walker", t: "Attendees", d: "See yourself on the venue map and get the nearest clear way out.", to: "/login/walker", c: "var(--cf-blue-hi)" },
            { n: "02", Preview: RolePreviewClient, role: "Client", t: "Organisers", d: "Upload a floor plan and watch occupancy fill zone by zone.", to: "/login/client", c: "var(--cf-orange)" },
            { n: "03", Preview: RolePreviewAdmin, role: "Admin", t: "Operations", d: "Every venue, every layout, every bottleneck, on one board.", to: "/login/admin", c: "var(--cf-red-text)" },
          ].map(({ n, Preview, role, t, d, to, c }, i) => (
            <Reveal key={role} delay={i * 80} className="h-full">
              <Spotlight as="button" color={c} onClick={() => navigate(to)}
                className="cf-focus cf-rolecard group w-full h-full text-left flex flex-col">

                {/* Live art. Sits in its own bay with the accent bleeding up from the floor,
                    so the colour arrives as light rather than as a filled swatch. */}
                <span className="cf-rolecard-art" style={{ "--accent": c }}>
                  <span className="cf-rolecard-glow" aria-hidden="true" />
                  <Preview color={c} />
                  <span aria-hidden="true" className="cf-rolecard-index cf-display">{n}</span>
                </span>

                <span className="flex-1 flex flex-col px-6 pt-5 pb-6">
                  <span className="cf-accent text-[10px] cf-dim2 mb-1.5 block">{role.toUpperCase()} PORTAL</span>
                  <span className="cf-display font-black uppercase text-2xl tracking-tight leading-none mb-2.5 block">{t}</span>
                  <span className="text-sm cf-dim leading-relaxed block">{d}</span>
                </span>

                <span className="cf-rolecard-foot" style={{ "--accent": c }}>
                  <span className="cf-accent text-[11px]" style={{ color: c }}>ENTER PORTAL</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1.5" style={{ color: c }} />
                </span>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Capability bento. Asymmetric on purpose: the prediction claim is the one that
          differentiates the product, so it gets the wide tile and the others read as
          supporting evidence rather than a flat list of equals. */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t cf-hairline">
        <Reveal><SectionHeading eyebrow="WHAT IT DOES" title="Built to see it coming"
          lede="A threshold tells you a zone is full. The point of this system is to tell you which zone is about to be." center /></Reveal>

        {/* Six columns on desktop so tiles can be 2- or 3-wide and the row rhythm changes down
            the grid. Each tile is a live demo above its label: the animation is the evidence
            for the claim, not decoration beside it. */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 md:auto-rows-[13rem]">
          {[
            {
              d: 0, span: "md:col-span-2 md:row-span-2", color: "var(--cf-orange)", Demo: DemoPropagation,
              Icon: Radio, t: "Predicts, not reports",
              p: "Congestion propagates along the venue's own walkway graph, so a quiet zone about to be hit by an overrunning neighbour is flagged before it fills — not once it already has.",
            },
            {
              d: 80, span: "md:col-span-2", color: "var(--cf-blue-hi)", Demo: DemoRoute,
              Icon: Navigation, t: "Routes around it",
              p: "Paths weighted by live congestion — around the jam, not through it.",
            },
            {
              d: 160, span: "md:col-span-2 md:row-span-2", color: "var(--cf-green)", Demo: DemoBaseline,
              Icon: ShieldCheck, t: "Proves it worked",
              p: "A hidden baseline runs the same crowd and seed with rerouting off, so the before/after is measured, not estimated.",
            },
            {
              d: 240, span: "md:col-span-2", color: "var(--cf-amber)", Demo: DemoTick,
              Icon: Activity, t: "Runs in real time",
              p: "Thousands of agents, roughly ten ticks a second.",
            },
            {
              d: 320, span: "md:col-span-3", color: "var(--cf-blue-hi)", Demo: DemoPortals,
              Icon: Users, t: "Three views, one venue",
              p: "Attendees, organisers and operations each see exactly what their job needs — and nothing beyond it.",
            },
            {
              d: 400, span: "md:col-span-3", color: "var(--cf-orange)", Demo: DemoGraph,
              Icon: Layers, t: "No database required",
              p: "Sessions run in memory against the venue graph, so there is nothing to provision before a demo.",
            },
          ].map(({ d, span, color, Demo, Icon, t, p }) => (
            <Reveal key={t} delay={d} className={span}>
              <Bento color={color} className="p-6 h-full flex flex-col">
                <div className="flex-1 min-h-0"><Demo /></div>
                <div className="mt-4">
                  <div className="cf-display font-bold uppercase text-lg tracking-wide mb-1.5 flex items-center gap-2">
                    <Icon className="w-4 h-4 shrink-0" style={{ color }} strokeWidth={2} />
                    {t}
                  </div>
                  <p className="text-sm cf-dim leading-relaxed">{p}</p>
                </div>
              </Bento>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative">
        {/* Fades to nothing at both ends instead of butting into a hard edge. */}
        <span aria-hidden="true" className="block max-w-7xl mx-auto cf-rule" />
        <div className="max-w-7xl mx-auto px-6 py-16 relative">
          <Reveal>
            <div className="grid grid-cols-2 md:grid-cols-4 rounded-2xl overflow-hidden cf-statband">
              {[
                { to: 2500, suffix: "", l: "AGENTS PER RUN" },
                { to: 100, prefix: "~", suffix: "ms", l: "TICK INTERVAL" },
                { to: 28, suffix: "%", l: "LESS TIME CRITICAL", c: "var(--cf-green)" },
                { to: 0, suffix: "", l: "DATABASES REQUIRED" },
              ].map((s) => (
                <Spotlight key={s.l} className="px-6 py-8 cf-statcell">
                  <div className="cf-display font-black text-3xl mb-1 cf-tnum" style={{ color: s.c || "var(--cf-ink)" }}>
                    <CountOnView value={s.to} prefix={s.prefix} suffix={s.suffix} />
                  </div>
                  <div className="cf-accent text-[11px] cf-dim2">{s.l}</div>
                </Spotlight>
              ))}
            </div>
          </Reveal>
        </div>
        <span aria-hidden="true" className="block max-w-7xl mx-auto cf-rule" />
      </section>

      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <Reveal>
          <h2 className="cf-display font-black uppercase tracking-tight mb-5" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", lineHeight: 1.05 }}>
            <GradientShimmer gradient="ember">Open a portal and watch a venue fill</GradientShimmer>
          </h2>
          <p className="cf-dim max-w-xl mx-auto leading-relaxed mb-8">
            Three roles, one live map. Start a session from the client portal and the whole
            system — map, timing tower, before/after — comes alive against it.
          </p>
          <Magnetic>
            <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary cf-shine rounded-xl px-8 py-4 cf-display font-bold uppercase text-sm tracking-wide">
              Choose your portal
            </button>
          </Magnetic>
        </Reveal>
      </section>
    </div>
  );
}

/**
 * How it works — the end-to-end story.
 *
 * The other marketing pages each cover one slice (the board, the models, the numbers). Nothing
 * previously walked a reader from "I have a floor plan" to "a marshal is reading an instruction",
 * which is the question every first-time visitor actually arrives with.
 */
function HowItWorksPage({ navigate }) {
  const steps = [
    { n: "01", Icon: Upload, c: "var(--cf-orange)", t: "Upload the floor plan",
      d: "A flat 2D image is all that is needed. No CAD, no survey, no site visit.",
      note: "CLIENT PORTAL · ONE IMAGE" },
    { n: "02", Icon: Network, c: "var(--cf-orange)", t: "AI traces it into a graph",
      d: "Halls, corridors, gates and the walkable edges between them become a routable network — the structure everything downstream reasons over.",
      note: "AUTOMATED TRACING · EDITABLE" },
    { n: "03", Icon: Users, c: "var(--cf-blue-hi)", t: "Attendees check in",
      d: "A venue code on your signage puts each device on the map. Only anonymous position inside the geofence is ever used.",
      note: "WALKER PORTAL · VENUE CODE" },
    { n: "04", Icon: Cpu, c: "var(--cf-blue-hi)", t: "The model looks ahead",
      d: "Density, trend and history propagate across the graph, so risk is predicted at a zone's neighbours before that zone itself is full.",
      note: "CONGESTION-PROPAGATION GNN" },
    { n: "05", Icon: Navigation, c: "var(--cf-amber)", t: "Routes bend around the jam",
      d: "Paths are weighted by live congestion, so the way out an attendee is shown goes around the crush rather than into it.",
      note: "PER-ATTENDEE REROUTING" },
    { n: "06", Icon: Radio, c: "var(--cf-red)", t: "Operators get a sentence",
      d: "Density vectors become the actual line a marshal can act on — hold intake here, stage arrivals there.",
      note: "GENERATED ADVISORY" },
  ];

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="HOW IT WORKS" title="Floor plan to instruction"
        lede="Six steps from a flat image of your venue to a sentence a marshal can act on — and the point at which each one stops being a guess." />

      <section className="max-w-5xl mx-auto px-6 py-20">
        {/* A vertical spine with the steps hung off it. The rail is drawn behind the markers
            and stops short at the last one, so the sequence reads as finite rather than
            continuing off the bottom of the page. */}
        <div className="relative">
          <span aria-hidden="true" className="absolute left-[19px] top-3 bottom-14 w-px hidden sm:block"
            style={{ background: "linear-gradient(180deg, var(--cf-orange), var(--cf-blue-hi), var(--cf-red), transparent)", opacity: 0.45 }} />

          <div className="flex flex-col gap-4">
            {steps.map(({ n, Icon, c, t, d, note }, i) => (
              <Reveal key={n} delay={i * 70}>
                <div className="flex gap-5 items-start">
                  <span className="relative z-10 w-10 h-10 rounded-full shrink-0 hidden sm:flex items-center justify-center cf-card-solid"
                    style={{ borderColor: c }}>
                    <Icon className="w-4 h-4" style={{ color: c }} strokeWidth={2} />
                  </span>
                  <Spotlight color={c} className="cf-bento rounded-2xl p-6 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="cf-mono text-[11px]" style={{ color: c }}>{n}</span>
                      <span className="cf-display font-bold uppercase text-lg tracking-wide">{t}</span>
                    </div>
                    <p className="text-sm cf-dim leading-relaxed mb-3">{d}</p>
                    <span className="cf-accent text-[10px] cf-dim2">{note}</span>
                  </Spotlight>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-24">
        <Reveal>
          <Spotlight className="cf-bento rounded-2xl p-8 text-center">
            <div className="cf-display font-black uppercase text-2xl tracking-tight mb-3">
              <GradientShimmer gradient="ember">See it running</GradientShimmer>
            </div>
            <p className="cf-dim text-sm leading-relaxed max-w-xl mx-auto mb-7">
              Start a session from the client portal and every surface on this site — the live board,
              the timing tower, the before/after — starts reporting against it.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Magnetic>
                <button onClick={() => navigate("/access")} className="cf-focus cf-btn-primary cf-shine rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  Open a portal
                </button>
              </Magnetic>
              <Magnetic>
                <button onClick={() => navigate("/platform")} className="cf-focus cf-btn-outline rounded-xl px-7 py-3.5 cf-display font-bold uppercase text-sm tracking-wide">
                  See the live board
                </button>
              </Magnetic>
            </div>
          </Spotlight>
        </Reveal>
      </section>
    </div>
  );
}

function PlatformPage({ navigate }) {
  const { venue, people, live } = useShowcase();
  const [sel, setSel] = useState(null);
  const hall = venue.halls.find((h) => h.id === sel);

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="PLATFORM" title="The live board"
        lede="Every zone ranked by what's about to happen, on a map that behaves like the one already in everyone's pocket." />

      <section className="max-w-7xl mx-auto px-6 py-16 border-b cf-hairline">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="cf-display font-bold uppercase text-lg tracking-wide">{venue.name}</span>
          <span className="cf-mono text-[11px] cf-dim2">{venue.id}</span>
          <ShowcaseNote live={live} />
        </div>
        <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
          <div className="rounded-2xl overflow-hidden" style={{ boxShadow: "var(--cf-shadow-md)" }}>
            <VenueMap venue={venue} people={people} me={null} height={520} onSelectHall={setSel} selectedHall={sel} />
          </div>
          <div className="flex flex-col gap-4">
            <Spotlight className="cf-bento rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">SELECTED ZONE</div>
              {hall ? (
                <>
                  <div className="cf-display font-bold uppercase text-lg tracking-wide mb-1">{hall.name}</div>
                  <div className="cf-mono text-[11px] cf-dim2 mb-4">{hall.type}</div>
                  <div className="h-2 rounded-full cf-panel overflow-hidden mb-2">
                    <div className="h-full rounded-full" style={{ width: `${hall.density * 100}%`, background: densityColor(hall.density) }} />
                  </div>
                  <div className="flex justify-between cf-mono text-xs">
                    <span className="cf-dim2">OCCUPANCY</span>
                    <span style={{ color: densityColor(hall.density) }}>{Math.round(hall.density * 100)}%</span>
                  </div>
                </>
              ) : (
                <p className="text-sm cf-dim leading-relaxed">Tap any zone on the map to inspect its live occupancy and status.</p>
              )}
            </Spotlight>
            <Spotlight className="cf-bento rounded-2xl p-5 flex-1">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">LIVE COUNTS</div>
              <div className="flex flex-col gap-3">
                {[["Inside venue", people.length * 20], ["Capacity", venue.capacity], ["Zones flagged", venue.halls.filter((h) => h.density > 0.7).length]].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between py-1 border-b cf-hairline last:border-0">
                    <span className="text-sm cf-dim">{l}</span>
                    <span className="cf-mono text-sm font-semibold cf-tnum">{v}</span>
                  </div>
                ))}
              </div>
            </Spotlight>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="LIVE TIMING TOWER" title="Ranked by predicted risk"
          lede="Position comes from the congestion-propagation model, so a quiet zone about to be hit by an overrunning neighbour climbs the board before it fills." /></Reveal>
        <Reveal delay={100}><TimingTower zones={venue.halls} /></Reveal>
      </section>
    </div>
  );
}

const ZONE_ICON = { GATE: DoorOpen, WALKWAY: Footprints, CONCESSION: UtensilsCrossed, SEATING: Armchair, EXIT: LogOut };
const STATUS_META = { CRITICAL: { c: "var(--cf-red)", l: "CRITICAL" }, WARNING: { c: "var(--cf-amber)", l: "CAUTION" }, OK: { c: "var(--cf-green)", l: "CLEAR" } };
const TREND_META = { RISING: { I: TrendingUp, c: "var(--cf-red)" }, FALLING: { I: TrendingDown, c: "var(--cf-green)" }, FLAT: { I: Minus, c: "var(--cf-dim)" } };

/**
 * The zone table, ordered worst first — the "timing tower" of the venue.
 *
 * Rows are the `nodes` array off a live frame, so occupancy, status, trend and AI risk are all
 * the server's numbers. Sorted by density here rather than on the server because the server's
 * order is the venue file's order, which is meaningful for the map and useless for a leaderboard.
 */
function TimingTower({ zones = [] }) {
  const ranked = useMemo(
    () => [...zones].sort((a, b) => b.density - a.density),
    [zones],
  );

  if (!ranked.length) {
    return (
      <div className="cf-card rounded-2xl px-6 py-10 text-center">
        <p className="text-sm cf-dim">No zone data yet — start a session to populate the tower.</p>
      </div>
    );
  }

  return (
    <div className="cf-card rounded-2xl overflow-hidden">
      <div className="hidden sm:grid grid-cols-[3rem_1fr_9rem_7rem_9rem] gap-4 px-6 py-3 border-b cf-hairline cf-accent text-[11px] cf-dim2">
        <span>POS</span><span>ZONE</span><span>OCCUPANCY</span><span>TREND</span><span>AI RISK</span>
      </div>
      {ranked.map((z, i) => {
        const Icon = ZONE_ICON[z.type] ?? Armchair;
        const s = STATUS_META[z.status] ?? STATUS_META.OK;
        const t = TREND_META[z.trend] ?? TREND_META.FLAT;
        const TI = t.I;
        return (
          <div key={z.id} className="grid grid-cols-[2.5rem_1fr] sm:grid-cols-[3rem_1fr_9rem_7rem_9rem] gap-4 items-center px-6 py-4 border-b cf-hairline last:border-b-0 hover:bg-white/[0.02] transition-colors">
            <div className="cf-mono font-bold cf-dim2">P{i + 1}</div>
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-lg cf-chip flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{z.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.c }} />
                  <span className="text-[11px] cf-mono" style={{ color: s.c }}>{s.l}</span>
                </div>
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                {/* Capped at 100%: an overfull zone reports density > 1 and would otherwise
                    overflow its own track rather than reading as "full". */}
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, z.density * 100)}%`, background: s.c }} />
              </div>
              <span className="cf-mono text-xs w-10 text-right">{Math.round(z.density * 100)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TI className="w-3.5 h-3.5" style={{ color: t.c }} strokeWidth={2.5} />
              <span className="cf-mono text-xs" style={{ color: t.c }}>{z.trend ?? "FLAT"}</span>
            </div>
            <div><span className="cf-mono text-xs px-2 py-1 rounded" style={{ color: "var(--cf-blue-hi)", border: "1px solid rgba(77,141,240,.3)", background: "rgba(77,141,240,.08)" }}>AI {(z.risk ?? 0).toFixed(2)}</span></div>
          </div>
        );
      })}
    </div>
  );
}

function IntelligencePage() {
  const pipeline = [
    { Icon: Boxes, t: "Input validation", d: "Reject malformed graphs before they reach a model." },
    { Icon: Layers, t: "Preprocessing", d: "Density, trend and history folded into per-node features." },
    { Icon: Network, t: "Graph features", d: "Adjacency built from the venue's own walkway edges." },
    { Icon: Cpu, t: "Model call", d: "Hosted inference for risk scores, then for advisory text." },
    { Icon: GitBranch, t: "Postprocess", d: "Scores mapped back onto node IDs the frontend knows." },
    { Icon: ShieldCheck, t: "Fallback check", d: "If anything is missing, hand off to the deterministic mock." },
  ];
  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="INTELLIGENCE" title="Two calls a threshold can't make"
        lede="Simulation and routing are classic algorithms on purpose. The models earn their place doing what per-node rules can't: seeing a neighbour push crowd into you, and turning a density vector into an instruction." />
      <section className="max-w-7xl mx-auto px-6 py-20 border-b cf-hairline">
        <div className="grid md:grid-cols-2 gap-6">
          {[
            { Icon: Zap, t: "Congestion-Propagation GNN", m: "Graph neural net · message passing", b: "Predicts risk at neighbouring zones a few ticks ahead, not just the one crossing a threshold now.", ql: "PREDICTED · HORIZON 30 TICKS", q: "Gate A push spreading to North Concourse. Risk climbing, three ticks out." },
            { Icon: Radio, t: "Advisory Generator", m: "Text generation · density + trend → instruction", b: "Operators read sentences, not density vectors. This turns raw numbers into the line a marshal can act on.", ql: "GENERATED ADVISORY · GATE A", q: "Hold intake and stage arrivals away from Gate A; it is filling faster than it drains." },
          ].map(({ Icon, t, m, b, ql, q }, i) => (
            <Reveal key={t} delay={i * 80}>
              <Spotlight color="var(--cf-blue-hi)" className="cf-bento rounded-2xl p-7 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-5">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(77,141,240,0.14)" }}>
                    <Icon className="w-5 h-5 cf-blue-hi" strokeWidth={2} />
                  </span>
                  <div>
                    <div className="cf-display font-bold uppercase text-sm tracking-wide">{t}</div>
                    <div className="cf-mono text-[11px] cf-dim2">{m}</div>
                  </div>
                </div>
                <p className="cf-dim text-sm leading-relaxed mb-6">{b}</p>
                <div className="mt-auto border-l-2 pl-4 py-1" style={{ borderColor: "var(--cf-orange)" }}>
                  <div className="cf-mono text-[10px] tracking-widest cf-dim2 mb-1">{ql}</div>
                  <p className="text-sm italic leading-relaxed">&ldquo;{q}&rdquo;</p>
                </div>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="THE /ANALYZE PIPELINE" title="Six steps between a graph and a sentence" lede="One endpoint does the whole job. Spring sends board state; FastAPI returns risk scores and the line to read out." /></Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pipeline.map(({ Icon, t, d }, i) => (
            <Reveal key={t} delay={i * 60}>
              {/* The step number is drawn oversized and low-contrast behind the content so the
                  sequence is readable at a glance without a numeral competing with the title. */}
              <Spotlight className="cf-bento rounded-xl p-6 h-full relative overflow-hidden">
                <span aria-hidden="true" className="cf-display font-black absolute -top-3 right-2 leading-none select-none"
                  style={{ fontSize: "5rem", color: "var(--cf-line)", opacity: 0.55 }}>
                  {i + 1}
                </span>
                <Icon className="w-4 h-4 cf-orange mb-4" strokeWidth={2} />
                <div className="cf-display font-bold uppercase text-sm tracking-wide mb-1.5">{t}</div>
                <p className="text-sm cf-dim leading-relaxed">{d}</p>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResultsPage() {
  const [open, setOpen] = useState(0);
  const { sessions } = useSessionList(10000);
  const [summary, setSummary] = useState(null);

  // The most advanced session is the interesting one to report on — a run that has barely
  // started has nothing to compare yet.
  const target = useMemo(
    () => [...sessions].sort((a, b) => b.tick - a.tick)[0],
    [sessions],
  );

  useEffect(() => {
    if (!target) { setSummary(null); return; }
    let cancelled = false;
    api.getSessionSummary(target.sessionId)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [target?.sessionId, target?.tick]);

  const faqs = [
    { q: "Why did the bottleneck count go up?", a: "Because the crowd got spread across more zones instead of crushed into fewer. Counting zones rewards concentration, which is the wrong incentive. Critical node-ticks — total time any zone spent above the danger line — tracks real risk." },
    { q: "Is the baseline a real run or an estimate?", a: "A real run. A hidden baseline session executes in lockstep with the same venue graph, crowd size and random seed, with rerouting off. Only the intervention differs." },
    { q: "What is a node-tick?", a: "One zone spending one tick above the critical threshold. It measures exposure, not incidents." },
  ];

  const laps = summary
    ? [
        { l: "Lap 1 · No strategy", c: "var(--cf-red)", d: summary.baseline },
        { l: "Lap 2 · With strategy", c: "var(--cf-green)", d: summary.optimised },
      ]
    : [];

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="RESULTS" title="Same crowd, two laps"
        lede="A hidden baseline runs in lockstep with rerouting switched off, on the same venue, crowd and seed. Paired simulation output, not an estimate." />
      <section className="max-w-7xl mx-auto px-6 py-20 border-b cf-hairline">
        {!summary && (
          <div className="cf-card rounded-2xl px-6 py-14 text-center">
            <p className="text-sm cf-dim">
              No completed run to report on yet. Start a session with rerouting on from the
              client portal, and its before/after lands here.
            </p>
          </div>
        )}

        {summary && (
          <>
            <div className="flex flex-wrap items-baseline gap-3 mb-6">
              <span className="cf-display font-bold uppercase text-lg tracking-wide">{summary.venueName}</span>
              <span className="cf-mono text-[11px] cf-dim2">
                {summary.sessionId} · {summary.ticks} ticks · {summary.status}
              </span>
            </div>
            {!summary.comparisonAvailable && (
              <p className="text-sm cf-dim mb-6">
                This run had rerouting off, so both columns are the same numbers — there was no
                intervention to compare against.
              </p>
            )}
          </>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {laps.map(({ l, c, d }, i) => (
            <Reveal key={l} delay={i * 80}>
              <Spotlight color={c} className="cf-bento rounded-2xl p-7 h-full">
                <div className="flex items-center gap-2.5 mb-6">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                  <div className="cf-display font-bold uppercase text-sm tracking-wide" style={{ color: c }}>{l}</div>
                </div>
                <div className="cf-accent text-[11px] cf-dim2 mb-1">CRITICAL NODE-TICKS</div>
                <div className="cf-mono text-4xl font-bold cf-tnum" style={{ color: c }}>{d.criticalNodeTicks}</div>
                <div className="grid grid-cols-3 gap-4 pt-5 mt-5 border-t cf-hairline">
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">PEAK</div><div className="cf-mono font-semibold cf-tnum">{Math.round(d.peakDensity * 100)}%</div></div>
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">ZONES</div><div className="cf-mono font-semibold cf-tnum">{d.bottleneckCount}</div></div>
                  <div><div className="text-[11px] cf-mono cf-dim2 mb-1">EXITED</div><div className="cf-mono font-semibold cf-tnum">{d.exited}</div></div>
                </div>
              </Spotlight>
            </Reveal>
          ))}
        </div>

        {summary && (
          <p className="text-sm cf-dim leading-relaxed max-w-3xl mt-8">{summary.narrative}</p>
        )}
      </section>
      <section className="max-w-7xl mx-auto px-6 py-20">
        <Reveal><SectionHeading eyebrow="READING THE NUMBERS" title="The questions that come up first" lede="Mostly about why one metric moved the wrong way — which turns out to be the interesting part." /></Reveal>
        <div className="max-w-3xl">
          {faqs.map((f, i) => (
            <Reveal key={f.q} delay={i * 60}>
              <div className="border-b cf-hairline group">
                <button onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}
                  className="cf-focus w-full flex items-center justify-between gap-6 py-5 text-left">
                  <span className="cf-display font-bold uppercase text-base tracking-wide transition-colors duration-300"
                    style={{ color: open === i ? "var(--cf-orange)" : undefined }}>{f.q}</span>
                  <span className="w-7 h-7 rounded-full cf-chip flex items-center justify-center shrink-0 transition-colors duration-300">
                    <ChevronDown className="w-4 h-4 cf-dim transition-transform duration-300" style={{ transform: open === i ? "rotate(180deg)" : "none" }} />
                  </span>
                </button>
                <div style={{ display: "grid", gridTemplateRows: open === i ? "1fr" : "0fr", transition: "grid-template-rows .35s cubic-bezier(0.16,1,0.3,1)" }}>
                  <div style={{ overflow: "hidden" }}><p className="text-sm cf-dim leading-relaxed pb-5 max-w-2xl">{f.a}</p></div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================================
   Access page — the entry point that explains each role
   ========================================================================== */

/* ============================================================================
   Account identity
   ========================================================================== */

/**
 * The account as the UI reads it, mapped in exactly one place.
 *
 * `/auth/me` and the register/login responses return the same shape, and both used to be
 * unpacked inline with slightly different fields — which is how the header ended up able to
 * show an email but not a name. Everything that builds a session now goes through here.
 */
function toSession(u) {
  return {
    id: u?.id ?? null,
    email: u?.email ?? "",
    role: (u?.role ?? "walker").toLowerCase(),
    displayName: u?.displayName ?? null,
    bio: u?.bio ?? null,
    avatar: u?.avatar ?? null,
  };
}

/** What to call someone: the name they chose, or the part of their address before the @. */
function personName(session) {
  const name = session?.displayName?.trim();
  if (name) return name;
  const local = (session?.email ?? "").split("@")[0];
  return local || "Account";
}

/** One or two letters for the fallback avatar. "Ops Lead" → OL, "moazz" → MO. */
function initialsOf(session) {
  const source = personName(session).replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/**
 * A stable hue per account.
 *
 * Derived from the account id so the same person is the same colour on every device and after
 * every sign-in — a generated avatar that changed between sessions would be worse than none,
 * because the colour is the thing people actually recognise in a header. Hashed rather than
 * taken modulo directly so neighbouring ids do not come out as neighbouring colours.
 */
function avatarHue(seed) {
  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/**
 * The account's picture, or a generated stand-in.
 *
 * Nobody uploads a photo before they need one, so the empty state has to look deliberate
 * rather than broken: initials on a colour the account owns. The uploaded image, when there is
 * one, is a data URI already carried on the session — no second request to draw a 36px circle.
 */
function Avatar({ session, size = 36, className = "", ring = true }) {
  const hue = avatarHue(session?.id ?? session?.email);
  const style = {
    width: size, height: size,
    boxShadow: ring ? "inset 0 0 0 1px rgba(255,255,255,0.14)" : "none",
  };
  if (session?.avatar) {
    return (
      <img src={session.avatar} alt="" aria-hidden="true"
        className={`rounded-full object-cover shrink-0 ${className}`} style={style} />
    );
  }
  return (
    <span aria-hidden="true"
      className={`rounded-full shrink-0 flex items-center justify-center cf-display font-black ${className}`}
      style={{
        ...style,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        letterSpacing: "0.02em",
        color: `hsl(${hue} 80% 88%)`,
        background: `linear-gradient(140deg, hsl(${hue} 55% 26%), hsl(${hue} 62% 16%))`,
      }}>
      {initialsOf(session)}
    </span>
  );
}

const ROLES = {
  walker: {
    key: "walker", label: "Walker", who: "Attendees & visitors", color: "var(--cf-blue-hi)", Icon: Ticket,
    tagline: "Find yourself. Find the way out.",
    blurb: "Type the venue code from the signage at your entrance and the map loads with you on it. Routes are coloured by how crowded they actually are right now — blue is clear, red is a crush — and the way out you're shown goes around the jam, not through it.",
    can: ["A live map of the venue you checked into", "A route out that avoids the crowds", "Colour-coded congestion on every path", "Water points, restrooms, concessions"],
    cannot: ["Other attendees' identities or positions", "Venue analytics or capacity figures", "Anything outside the venue geofence"],
  },
  client: {
    key: "client", label: "Client", who: "Venue owners & organisers", color: "var(--cf-orange)", Icon: Building2,
    tagline: "Upload a floor plan. Get a live map.",
    blurb: "Drop in a flat 2D image of your venue and AI traces it into a working map — halls, corridors, gates, and the pathways between them. Set a venue code for your signage, then it's live: occupancy per zone, and warnings the moment an area starts becoming dangerous.",
    can: ["AI tracing of 2D floor plans into pathways", "A venue code attendees check in with", "Live occupancy and crowd-safety warnings", "Reroute advisories as zones fill"],
    cannot: ["Individual attendee identities", "Other clients' venues or data", "Platform-wide analytics"],
  },
  admin: {
    key: "admin", label: "Admin", who: "Platform operations", color: "var(--cf-red-text)", Icon: UserCog,
    tagline: "Every venue. Every bottleneck.",
    blurb: "The operations console. Cross-venue monitoring, layout review, incident history, and the model's own accuracy over time — where predicted risk did and didn't match what happened.",
    can: ["All venues and layouts", "Cross-venue bottleneck monitoring", "Client account management", "Model accuracy and incident review"],
    cannot: ["Attendee personal data beyond anonymised position", "Anything without an audit-log entry"],
  },
};

/**
 * Portal chooser — supplied pricing-card pattern, ported TSX → JS.
 *
 * The structure is kept as-is: a badge and centred header, the headline value under it, a
 * divider, a checklist of what you get, and a CTA pinned to the bottom of the card so all
 * three buttons line up regardless of how much text sits above them. One card is `featured`
 * and carries the ring plus a "most popular" flag.
 *
 * Two things are re-pointed at this product. There is no billing here, so the price slot
 * carries the tagline — the line that actually distinguishes one portal from another. And
 * the pricing card lists only inclusions; a portal's *exclusions* are the security boundary
 * and the most important thing on the page, so the checklist keeps both, with the same
 * green-check / red-cross language used elsewhere in the app.
 */
function AccessPage({ navigate }) {
  // Client is featured: it is the only role that can create a session, so it is the one a
  // first-time visitor almost always wants.
  const plans = Object.values(ROLES).map((r) => ({ ...r, featured: r.key === "client" }));

  return (
    <div className="cf-page-in">
      <PageHeader eyebrow="PORTALS" title="Pick your way in"
        lede="One platform, three portals. Each sees exactly what its job requires and nothing beyond it — the boundaries below are the actual access model, not a marketing summary." />

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 min-[900px]:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan, i) => (
            <Reveal key={plan.key} delay={i * 90} className="h-full">
              <Spotlight
                color={plan.color}
                aria-label={`${plan.label} portal`}
                className={`cf-bento group rounded-2xl p-6 h-full flex flex-col text-left ${plan.featured ? "min-[900px]:-translate-y-2" : ""}`}
                style={plan.featured
                  ? { borderColor: plan.color, boxShadow: `0 0 0 1px color-mix(in oklab, ${plan.color} 22%, transparent), var(--cf-shadow-lg)` }
                  : undefined}>

                {/* Header block — badge, then the tagline in the slot a price would occupy. */}
                <div className="text-center">
                  <div className="inline-flex items-center gap-2 flex-wrap justify-center">
                    <span className="cf-accent text-[10px] rounded-full px-2.5 py-1"
                      style={plan.featured
                        // Dark ink on the bright chip, not white. White on the featured accent
                        // reaches 2.87:1 — this is 7.02:1, and dark-on-bright is what a solid
                        // accent chip wants anyway. Holds while the featured plan is the
                        // orange one; a dark accent would need the inverse.
                        ? { background: plan.color, color: "var(--cf-bg)" }
                        : { background: "rgba(255,255,255,0.06)", color: "var(--cf-dim)", border: "1px solid var(--cf-line)" }}>
                      {plan.label.toUpperCase()}
                    </span>
                    {plan.featured && (
                      <span className="cf-accent text-[10px] rounded-full px-2.5 py-1"
                        style={{ background: `color-mix(in oklab, ${plan.color} 16%, transparent)`, color: plan.color }}>
                        MOST USED
                      </span>
                    )}
                  </div>

                  <span className="mt-5 mb-4 w-12 h-12 rounded-xl mx-auto flex items-center justify-center transition-transform duration-500 group-hover:scale-110"
                    style={{ background: `color-mix(in oklab, ${plan.color} 18%, transparent)`, transitionTimingFunction: "var(--cf-ease)" }}>
                    <plan.Icon className="w-6 h-6" style={{ color: plan.color }} strokeWidth={2} />
                  </span>

                  {/* The role name is the anchor, matching the source where the plan title
                      leads and the price sits under it as the accent. Reversing that put a
                      long coloured tagline above the name and the card stopped announcing
                      which portal it was. */}
                  <h3 className="cf-display font-black uppercase text-2xl tracking-tight leading-none mb-2">
                    {plan.label}
                  </h3>
                  <p className="cf-display font-bold uppercase text-sm tracking-wide leading-snug mb-2"
                    style={{ color: plan.color }}>
                    {plan.tagline}
                  </p>
                  <p className="cf-accent text-[10px] cf-dim2">{plan.who.toUpperCase()}</p>
                </div>

                <div className="my-5 border-t cf-hairline" />

                <p className="text-sm cf-dim leading-relaxed mb-5">{plan.blurb}</p>

                <div className="cf-accent text-[10px] cf-dim2 mb-2.5">CAN SEE</div>
                <ul className="flex flex-col gap-2.5 mb-5">
                  {plan.can.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-sm cf-dim">
                      <CircleCheck className="w-4 h-4 cf-green shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>

                <div className="cf-accent text-[10px] cf-dim2 mb-2.5">NEVER SEES</div>
                <ul className="flex flex-col gap-2.5">
                  {plan.cannot.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-sm cf-dim2">
                      <CircleX className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--cf-red-text)" }} strokeWidth={2} aria-hidden="true" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>

                {/* mt-auto keeps every CTA on the same baseline however long the lists run. */}
                <div className="mt-auto pt-6">
                  <button onClick={() => navigate(`/login/${plan.key}`)}
                    className="cf-focus cf-shine rounded-xl px-5 py-3 cf-display font-bold uppercase text-sm tracking-wide w-full transition-all"
                    style={plan.featured
                      ? { background: `linear-gradient(100deg, ${plan.color}, color-mix(in oklab, ${plan.color} 62%, var(--cf-orange)))`, color: "#fff" }
                      : { background: `color-mix(in oklab, ${plan.color} 14%, transparent)`, border: `1px solid ${plan.color}`, color: plan.color }}>
                    Sign in as {plan.label}
                  </button>
                </div>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <Reveal>
          <div className="cf-card rounded-2xl p-7 flex items-start gap-4">
            <ShieldCheck className="w-5 h-5 cf-green shrink-0 mt-0.5" strokeWidth={2} />
            <div>
              <div className="cf-display font-bold uppercase text-base tracking-wide mb-2">Position data never leaves the geofence</div>
              <p className="text-sm cf-dim leading-relaxed max-w-3xl">
                A device only contributes a dot while it is inside the venue polygon. Step outside and the point stops
                being rendered and stops being counted — there is no tracking of where anyone goes before or after.
                Walkers see only themselves; organisers and admins see anonymous density, never identities.
              </p>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

/* ============================================================================
   Login
   ========================================================================== */

/**
 * Sign-in flow.
 *
 * Follows the supplied component's shape: a full-screen, centred flow over an animated
 * background, with the form entering in staged steps and a confirmation beat before the
 * redirect rather than an instant jump.
 *
 * The original drives its background with Three.js + React Three Fiber — about 25MB of
 * dependency for one screen's backdrop. This app already ships a WebGL shader engine
 * (@paper-design/shaders-react, ~430KB) doing exactly that job site-wide, so the backdrop
 * here is the existing <MeshField>, intensified locally. Same effect, no second WebGL stack.
 */
/**
 * The password rules, shown while they are being met rather than after they are broken.
 *
 * Every rule is on screen from the first keystroke, ticking off live. The alternative — an
 * error after submitting — makes choosing a password a guessing game where each attempt
 * reveals one more requirement, and it is the same amount of markup either way.
 *
 * The bar underneath is advisory and deliberately separate from the checklist: the checklist
 * is what the form enforces, the bar is only a hint that longer is better. A passphrase that
 * reads "Fair" is still perfectly acceptable to submit.
 */
function PasswordRequirements({ password, accent, show }) {
  const checks = passwordChecks(password);
  const strength = passwordStrength(password);
  const problem = passwordError(password);

  if (!show) return null;

  return (
    <div className="mb-4 text-left">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mb-3">
        {checks.map((c) => (
          <span key={c.id} className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: c.met ? "var(--cf-green, #4ade80)" : "var(--cf-dim2)" }}>
            <span aria-hidden="true"
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition-all"
              style={c.met
                ? { background: "color-mix(in oklab, var(--cf-green, #4ade80) 22%, transparent)" }
                : { border: "1px solid var(--cf-line2)" }}>
              {c.met && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
            </span>
            {c.label}
          </span>
        ))}
      </div>

      <div className="flex gap-1 mb-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-0.5 flex-1 rounded-full transition-all duration-300"
            style={{
              background: i <= strength.score
                ? (strength.score >= 3 ? "var(--cf-green, #4ade80)" : accent)
                : "var(--cf-line)",
            }} />
        ))}
      </div>
      {/* One live region for both, so a screen reader hears the strength change and any
          violation from the same place instead of two competing announcements. */}
      <p className="text-[10px] cf-accent text-center" aria-live="polite"
        style={{ color: problem ? "var(--cf-red)" : "var(--cf-dim2)" }}>
        {problem ?? (strength.label ? strength.label.toUpperCase() : " ")}
      </p>
    </div>
  );
}

function LoginPage({ roleKey, navigate, signIn }) {
  const role = ROLES[roleKey] ?? ROLES.walker;
  const reduced = usePrefersReducedMotion();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // email → code → (reset) → success
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Registration and sign-in share one screen, and the choice is made on the first panel
  // rather than the second. It decides what the whole flow is, so asking for it after the
  // email — and after the heading has already committed to one of them — meant people typed a
  // password into a form that turned out to be doing the other thing.
  const [wantsNewAccount, setWantsNewAccount] = useState(false);

  // The admin portal is sign-in only. The console is granted per address by the platform
  // team, so a sign-up form there could only ever collect a password and then refuse it.
  const allowsSignUp = role.key !== "admin";

  // Derived rather than just hidden. Switching portals from the chips below re-renders this
  // component in place instead of remounting it, so a "create account" chosen on the client
  // door would otherwise still be set on arriving at the admin one — with the control that
  // set it no longer on screen to unset it.
  const isNewAccount = allowsSignUp && wantsNewAccount;
  const [err, setErr] = useState("");
  // Password recovery. `resetCode` is what the user types back; `issuedCode` is the one the
  // backend handed over directly, which only happens where there is no mail server to send
  // it through — see api.auth.forgotPassword.
  const [resetCode, setResetCode] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const passwordRef = useRef(null);
  const resetCodeRef = useRef(null);
  const finishing = useRef(false);
  // Flipped on one frame after mount so the staged entrance has an initial state to leave.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const timers = useRef([]);

  // The two dot-matrix layers. The forward reveal runs from mount; when the code completes
  // the reverse layer is switched on first and the forward one removed a frame later, so the
  // grid appears to collapse back out rather than cutting to a second animation.
  const [forwardCanvas, setForwardCanvas] = useState(true);
  const [reverseCanvas, setReverseCanvas] = useState(false);

  // Every timeout is tracked so an unmount mid-flow cannot land setState on a dead component
  // or fire a navigate after the user has already left the page.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (step !== "code" && step !== "reset") return;
    const target = () => (step === "reset" ? resetCodeRef.current : passwordRef.current);
    const t = setTimeout(() => target()?.focus(), reduced ? 0 : 420);
    timers.current.push(t);
    return () => clearTimeout(t);
  }, [step, reduced]);

  const submitEmail = (e) => {
    e?.preventDefault?.();
    // Caught here rather than at the backend: a typo in the address cannot succeed, and
    // finding that out after typing a password on the next panel wastes the whole attempt.
    const problem = emailError(email);
    if (problem) { setErr(problem); return; }
    setErr("");
    setStep("code");
  };

  /** Turns any failure from the auth endpoints into one line a person can act on. */
  const explain = (e, fallback) => (
    e?.status === 409 ? "That email is already registered — switch to Sign in."
      : e?.status === 401 ? "Email or password is incorrect."
        // 403 is the admin gate and the disabled-account case. Both carry a message written
        // for a reader, so pass it through rather than replacing it with a generic one.
        : e?.status === 403 ? (e?.message ?? "This portal is not open to that account.")
          : e?.status === 0 ? "Cannot reach the server. Is the backend running?"
            : e?.message ?? fallback
  );

  /**
   * The shared tail of every successful authentication — register, sign in, or reset.
   *
   * The reveal-out is deliberately started only once the backend has accepted the
   * credentials. Running it optimistically looked better but meant a failed login played a
   * triumphant "you are in" sequence before dumping the user back to an error.
   */
  const celebrate = (res) => {
    finishing.current = true;
    setBusy(false);

    // The account's own role wins over whichever portal door was used to get here. The two
    // now agree for walker and client — signing in at either door moves the account there —
    // so in practice this only diverges for an admin, who lands in the operations console
    // whichever entrance they came through.
    const actualRole = (res.user?.role ?? role.key).toLowerCase();

    setReverseCanvas(true);
    timers.current.push(setTimeout(() => setForwardCanvas(false), 60));
    timers.current.push(setTimeout(() => setReverseCanvas(false), reduced ? 150 : 1150));
    timers.current.push(setTimeout(() => setStep("success"), reduced ? 200 : 1200));
    timers.current.push(setTimeout(() => {
      signIn(res.user ? { ...toSession(res.user), role: actualRole }
                      : { role: actualRole, email: email.trim() });
      navigate(`/app/${actualRole}`);
    }, reduced ? 600 : 3400));
  };

  const finish = async () => {
    if (finishing.current || busy) return;
    if (isNewAccount) {
      const problem = passwordError(password);
      if (problem) { setErr(problem); return; }
      if (!passwordAcceptable(password)) { setErr("Your password does not meet the requirements yet."); return; }
    } else if (!password) {
      setErr("Enter your password.");
      return;
    }

    setBusy(true);
    setErr("");
    try {
      celebrate(isNewAccount
        ? await api.auth.register({ email: email.trim(), password, role: role.key })
        : await api.auth.login({ email: email.trim(), password, portal: role.key }));
    } catch (e) {
      setBusy(false);
      setErr(explain(e, "Could not sign you in."));
    }
  };

  /**
   * Ask for a reset code and move to the panel that redeems it.
   *
   * This always advances, even for an address with no account. The backend answers
   * identically either way so that this cannot be used to discover which emails are
   * registered, and a screen that advanced only for real accounts would hand back exactly
   * the answer the endpoint is careful not to give.
   */
  const requestReset = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api.auth.forgotPassword({ email: email.trim() });
      setIssuedCode(res?.code ?? "");
      setResetCode(res?.code ?? "");
      setPassword("");
      setBusy(false);
      setStep("reset");
    } catch (e) {
      setBusy(false);
      setErr(explain(e, "Could not start a password reset."));
    }
  };

  const submitReset = async () => {
    if (finishing.current || busy) return;
    if (!resetCode.trim()) { setErr("Enter the reset code."); return; }
    const problem = passwordError(password);
    if (problem) { setErr(problem); return; }
    if (!passwordAcceptable(password)) { setErr("Your new password does not meet the requirements yet."); return; }

    setBusy(true);
    setErr("");
    try {
      celebrate(await api.auth.resetPassword({
        email: email.trim(), code: resetCode.trim(), password,
      }));
    } catch (e) {
      setBusy(false);
      setErr(explain(e, "Could not reset that password."));
    }
  };

  // Setting a password is gated on the policy; using an existing one is not. An account
  // created before a rule existed is still a valid account, and refusing to let it sign in
  // would lock people out of exactly the accounts they need to get in to fix.
  const canSubmitPassword = isNewAccount ? passwordAcceptable(password) : password.length > 0;
  const canSubmitReset = passwordAcceptable(password) && resetCode.trim().length > 0;

  const backToEmail = () => {
    finishing.current = false;
    setStep("email");
    setPassword("");
    setResetCode("");
    setIssuedCode("");
    setErr("");
    setReverseCanvas(false);
    setForwardCanvas(true);
  };

  // Staged entrance, done in CSS rather than through Motion.
  //
  // This used to return fresh `initial`/`animate` objects from inside the render. Motion
  // treats each of those as a new animation target, and because the sign-in re-renders while
  // it runs (the shader canvas mounts, `step` changes, AnimatePresence swaps children), some
  // elements had their entrance restarted and then never finished — they were left stranded
  // at the initial `opacity: 0`, so parts of the form were simply invisible on screen while
  // still being present and "visible" to any DOM check.
  //
  // A CSS transition driven by one boolean cannot strand: the end state is a plain class, so
  // however many times this re-renders, the element still settles at opacity 1.
  const stage = (i) => (reduced ? {} : {
    style: {
      opacity: entered ? 1 : 0,
      transform: entered ? "none" : "translateY(14px)",
      transition: `opacity .5s var(--cf-ease) ${0.06 * i}s, transform .5s var(--cf-ease) ${0.06 * i}s`,
    },
  });

  const slide = (dir) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, x: dir * 60 }, animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: dir * -60 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } });

  // The dot grid is drawn in the role's own colour rather than the source's white, so each
  // portal's sign-in is identifiable before a word is read.
  const dotRGB = useMemo(() => ({
    walker: [77, 141, 240], client: [255, 106, 0], admin: [225, 6, 0],
  }[role.key] ?? [255, 106, 0]), [role.key]);

  return (
    <div className="cf-page-in min-h-screen flex flex-col items-center justify-center px-6 py-28 relative">
      {/* The reveal. Mounted behind everything and masked to a vignette so the dots read as
          depth at the edges and never compete with the form in the middle. */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {forwardCanvas && (
          <CanvasRevealEffect colors={[dotRGB, [255, 255, 255]]} dotSize={6} speed={3} />
        )}
        {reverseCanvas && (
          <CanvasRevealEffect colors={[dotRGB, [255, 255, 255]]} dotSize={6} speed={4} reverse />
        )}
        <div className="absolute inset-0"
          style={{ background: "radial-gradient(circle at center, rgba(5,7,11,.92) 0%, rgba(5,7,11,.55) 45%, rgba(5,7,11,.92) 100%)" }} />
      </div>

      <div className="w-full max-w-md relative z-10">
        <AnimatePresence mode="wait">
          {step === "email" && (
            <motion.div key="email" {...slide(-1)} className="text-center">
              <div {...stage(0)} className="flex justify-center mb-6">
                <span className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: `color-mix(in oklab, ${role.color} 18%, transparent)` }}>
                  <role.Icon className="w-7 h-7" style={{ color: role.color }} strokeWidth={2} />
                </span>
              </div>

              <div {...stage(1)}>
                <div className="cf-accent text-[10px] cf-dim2 mb-2">{role.who.toUpperCase()}</div>
                <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                  style={{ fontSize: "clamp(2rem, 5vw, 2.75rem)" }}>
                  <GradientShimmer gradient="ember">{`${role.label} portal`}</GradientShimmer>
                </h1>
                <p className="text-base cf-dim font-light mb-6">{role.tagline}</p>
              </div>

              {/* The sign-in / create-account choice, made before anything is typed.
                  A segmented control at the top rather than a link under the password field:
                  it is the one decision that changes what every input below it means, so it
                  belongs where it is read first and stays visible while the form is filled.

                  Absent on the admin door rather than present-and-refused: offering a control
                  whose only outcome is a 403 wastes a password on a door that was never open. */}
              {allowsSignUp && (
                <div {...stage(2)} className="flex gap-1 p-1 rounded-full mb-4 mx-auto max-w-xs"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line)", backdropFilter: "blur(4px)" }}>
                  {[["Sign in", false], ["Create account", true]].map(([label, wantsNew]) => (
                    <button key={label} type="button" aria-pressed={isNewAccount === wantsNew}
                      onClick={() => { setWantsNewAccount(wantsNew); setErr(""); }}
                      className="cf-focus flex-1 rounded-full py-2 cf-display font-bold uppercase text-[11px] tracking-wide transition-all"
                      style={isNewAccount === wantsNew
                        ? { background: `color-mix(in oklab, ${role.color} 26%, transparent)`, color: "var(--cf-ink)", boxShadow: "inset 0 1px 0 rgba(255,246,240,.09)" }
                        : { background: "transparent", color: "var(--cf-dim2)" }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {!allowsSignUp && (
                <p {...stage(2)} className="cf-accent text-[10px] cf-dim2 mb-4">
                  SIGN IN ONLY — ACCESS IS GRANTED BY THE PLATFORM TEAM
                </p>
              )}

              {/* noValidate hands the check to emailError rather than to the browser.
                  Chrome's own type=email rule blocks submit before onSubmit ever runs, so a
                  malformed address produced a native tooltip in the browser's styling and our
                  own message never appeared — and its rule is looser anyway, accepting
                  "someone@example" with no dot in the domain. One validator, one message. */}
              <form {...stage(3)} onSubmit={submitEmail} className="mb-4" noValidate>
                <div className="relative">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder={`you@${role.key === "walker" ? "example.com" : role.key === "client" ? "yourvenue.com" : "concourse.io"}`}
                    aria-label="Email address"
                    className="cf-focus w-full rounded-full py-3.5 pl-5 pr-14 text-sm text-center transition-colors"
                    style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
                  <button type="submit" aria-label="Continue"
                    className="cf-focus absolute right-2 top-2 w-9 h-9 flex items-center justify-center rounded-full transition-colors"
                    style={{ background: `color-mix(in oklab, ${role.color} 26%, transparent)`, color: "var(--cf-ink)" }}>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                {err && <p className="text-sm mt-3" style={{ color: "var(--cf-red-text)" }} role="alert">{err}</p>}
              </form>

              <div {...stage(4)} className="flex items-center gap-4 my-6">
                <span className="h-px flex-1" style={{ background: "var(--cf-line)" }} />
                <span className="cf-accent text-[10px] cf-dim2">OR PICK ANOTHER PORTAL</span>
                <span className="h-px flex-1" style={{ background: "var(--cf-line)" }} />
              </div>

              <div {...stage(5)} className="flex gap-2">
                {Object.values(ROLES).filter((r) => r.key !== role.key).map((r) => (
                  <button key={r.key} onClick={() => navigate(`/login/${r.key}`)}
                    className="cf-focus cf-chip rounded-full px-4 py-2.5 flex-1 transition-colors hover:border-(--cf-line2)">
                    <span className="cf-display font-bold uppercase text-xs" style={{ color: r.color }}>{r.label}</span>
                  </button>
                ))}
              </div>

              <p {...stage(6)} className="text-xs cf-dim2 leading-relaxed mt-10">
                {/* Says something the notice above it does not, rather than repeating it. */}
                {allowsSignUp
                  ? "One account covers both the walker and the client portal — the same credentials open either door, and signing in at one moves you there."
                  : "If your address has not been granted the console, use the walker or client portal instead — those are self-service and share one account."}
              </p>
            </motion.div>
          )}

          {step === "code" && (
            <motion.div key="code" {...slide(1)} className="text-center">
              <div {...stage(0)}>
                <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                  style={{ fontSize: "clamp(1.9rem, 4.5vw, 2.5rem)" }}>
                  <GradientShimmer gradient="ember">{isNewAccount ? "Choose a password" : "Enter your password"}</GradientShimmer>
                </h1>
                <p className="text-sm cf-dim font-light mb-1">
                  {isNewAccount
                    // The requirements are listed under the field now, so repeating one of
                    // them here only made the two disagree as the rules changed.
                    ? "Choose something you do not use elsewhere. This creates your account."
                    : `Signing in to your existing account, at the ${role.label.toLowerCase()} door.`}
                </p>
                <p className="cf-mono text-[11px] cf-dim2 mb-8">{email}</p>
              </div>

              <div {...stage(1)} className="relative mb-4">
                <Lock className="w-4 h-4 cf-dim2 absolute left-5 top-1/2 -translate-y-1/2" />
                <input
                  ref={passwordRef}
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmitPassword) finish(); }}
                  placeholder="••••••••"
                  autoComplete={isNewAccount ? "new-password" : "current-password"}
                  aria-label="Password"
                  className="cf-focus w-full rounded-full py-3.5 pl-12 pr-5 text-sm text-center transition-colors"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
              </div>

              <PasswordRequirements password={password} accent={role.color} show={isNewAccount} />

              {err && <p className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }} role="alert">{err}</p>}

              <div {...stage(2)} className="flex gap-3">
                <button onClick={backToEmail} disabled={busy}
                  className="cf-focus cf-btn-outline rounded-full px-6 py-3 cf-display font-bold uppercase text-xs tracking-wide disabled:opacity-50">
                  Back
                </button>
                <button onClick={() => finish()}
                  disabled={!canSubmitPassword || busy}
                  className="cf-focus flex-1 rounded-full py-3 cf-display font-bold uppercase text-xs tracking-wide transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={canSubmitPassword && !busy
                    ? { background: `linear-gradient(100deg, ${role.color}, color-mix(in oklab, ${role.color} 62%, var(--cf-orange)))`, color: "#fff" }
                    : { background: "rgba(255,255,255,0.04)", color: "var(--cf-dim2)", border: "1px solid var(--cf-line)" }}>
                  {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/35 border-t-white animate-spin" aria-hidden="true" />}
                  {busy ? "Checking…" : isNewAccount ? "Create account" : "Sign in"}
                </button>
              </div>

              {/* Only offered when signing in. During registration there is no account
                  behind the address yet, so a reset could only ever report nothing found. */}
              {!isNewAccount && (
                <button onClick={requestReset} disabled={busy}
                  className="cf-focus cf-btn-ghost cf-accent text-[10px] mt-6 disabled:opacity-50">
                  FORGOT PASSWORD?
                </button>
              )}
            </motion.div>
          )}

          {step === "reset" && (
            <motion.div key="reset" {...slide(1)} className="text-center">
              <div {...stage(0)}>
                <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                  style={{ fontSize: "clamp(1.9rem, 4.5vw, 2.5rem)" }}>
                  <GradientShimmer gradient="ember">Reset your password</GradientShimmer>
                </h1>
                <p className="text-sm cf-dim font-light mb-1">
                  Enter the code, then choose a new password.
                </p>
                <p className="cf-mono text-[11px] cf-dim2 mb-6">{email}</p>
              </div>

              {/* Where the code came from, said plainly.
                  A screen that claims to have sent an email it did not send is worse than one
                  that admits the code is on screen. The wording stays general — "not set up
                  yet" covers both no mail account and a missing app password — because this
                  is a user-facing panel, not a configuration report. Once delivery works the
                  backend withholds the code and this branch stops rendering. */}
              <div {...stage(1)} className="rounded-2xl px-4 py-3 mb-5 text-left cf-bento">
                <div className="cf-accent text-[10px] cf-dim2 mb-1.5">
                  {issuedCode ? "EMAIL NOT SET UP YET — CODE SHOWN HERE" : "CHECK YOUR INBOX"}
                </div>
                <p className="text-xs cf-dim leading-relaxed">
                  {issuedCode
                    ? "Email delivery is not configured, so the code is filled in below instead. Once it is, the code is emailed and never shown on this screen. It expires in 30 minutes and can be used once."
                    : "If that address has an account, a reset code is on its way. It expires in 30 minutes and can be used once."}
                </p>
              </div>

              <div {...stage(2)} className="relative mb-3">
                <ShieldCheck className="w-4 h-4 cf-dim2 absolute left-5 top-1/2 -translate-y-1/2" />
                <input
                  ref={resetCodeRef}
                  type="text"
                  value={resetCode}
                  onChange={(e) => { setResetCode(e.target.value.toUpperCase()); setErr(""); }}
                  placeholder="RESET CODE"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  maxLength={12}
                  aria-label="Reset code"
                  className="cf-focus cf-mono w-full rounded-full py-3.5 pl-12 pr-5 text-sm text-center uppercase tracking-[0.3em] transition-colors"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
              </div>

              <div {...stage(3)} className="relative mb-4">
                <Lock className="w-4 h-4 cf-dim2 absolute left-5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmitReset) submitReset(); }}
                  placeholder="New password"
                  autoComplete="new-password"
                  aria-label="New password"
                  className="cf-focus w-full rounded-full py-3.5 pl-12 pr-5 text-sm text-center transition-colors"
                  style={{ background: "rgba(5,7,11,0.55)", border: "1px solid var(--cf-line2)", color: "var(--cf-ink)", backdropFilter: "blur(4px)" }} />
              </div>

              <PasswordRequirements password={password} accent={role.color} show />

              {err && <p className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }} role="alert">{err}</p>}

              <div {...stage(4)} className="flex gap-3">
                <button onClick={backToEmail} disabled={busy}
                  className="cf-focus cf-btn-outline rounded-full px-6 py-3 cf-display font-bold uppercase text-xs tracking-wide disabled:opacity-50">
                  Back
                </button>
                <button onClick={() => submitReset()}
                  disabled={!canSubmitReset || busy}
                  className="cf-focus flex-1 rounded-full py-3 cf-display font-bold uppercase text-xs tracking-wide transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={canSubmitReset && !busy
                    ? { background: `linear-gradient(100deg, ${role.color}, color-mix(in oklab, ${role.color} 62%, var(--cf-orange)))`, color: "#fff" }
                    : { background: "rgba(255,255,255,0.04)", color: "var(--cf-dim2)", border: "1px solid var(--cf-line)" }}>
                  {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/35 border-t-white animate-spin" aria-hidden="true" />}
                  {busy ? "Saving…" : "Set new password"}
                </button>
              </div>

              <button onClick={requestReset} disabled={busy}
                className="cf-focus cf-btn-ghost cf-accent text-[10px] mt-6 disabled:opacity-50">
                SEND A NEW CODE
              </button>
            </motion.div>
          )}

          {step === "success" && (
            <motion.div key="success" className="text-center"
              initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
              <h1 className="cf-display font-black uppercase tracking-tight leading-none mb-3"
                style={{ fontSize: "clamp(2rem, 5vw, 2.75rem)" }}>
                <GradientShimmer gradient="ember">You&rsquo;re in</GradientShimmer>
              </h1>
              <p className="text-base cf-dim font-light">Opening the {role.label.toLowerCase()} portal…</p>

              <motion.div className="py-10"
                initial={reduced ? false : { scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4, delay: reduced ? 0 : 0.2 }}>
                <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: `linear-gradient(140deg, ${role.color}, color-mix(in oklab, ${role.color} 55%, var(--cf-orange)))` }}>
                  <Check className="w-8 h-8 text-white" strokeWidth={3} />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ============================================================================
   App shell for portals
   ========================================================================== */

/**
 * The guard for "signed in here, asking for there".
 *
 * Two cases arrive at this component. Asking for the portal you are already in is not a
 * decision worth a screen, so it just forwards. Asking for a different tier is: the honest
 * answer is that this account cannot open that door, and the useful answer is the two ways
 * forward. Deliberately not phrased as an error — a stale bookmark or a link a colleague
 * pasted is the ordinary way to land here, and the person has done nothing wrong.
 */
function AlreadySignedIn({ session, wanted, navigate, signOut, sameTier = false }) {
  const mine = ROLES[session.role];
  const theirs = ROLES[wanted];

  useEffect(() => {
    if (sameTier) navigate(`/app/${session.role}`);
  }, [sameTier, session.role, navigate]);
  if (sameTier) return null;

  return (
    <div className="cf-page-in min-h-screen flex items-center px-5 sm:px-6 py-24 sm:py-32" data-portal={session.role}>
      <div className="w-full max-w-lg mx-auto">
        <Reveal>
          <div className="cf-card rounded-2xl p-6 sm:p-8">
            <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
              style={{ background: `color-mix(in oklab, ${mine.color} 16%, transparent)` }}>
              <mine.Icon className="w-6 h-6" style={{ color: mine.color }} strokeWidth={2} aria-hidden="true" />
            </span>

            <h1 className="cf-display font-black uppercase text-3xl tracking-tight mb-3">
              You are signed in as {mine.label.toLowerCase()}
            </h1>
            <p className="text-sm cf-dim leading-relaxed mb-2">
              This account is <span className="cf-mono text-xs cf-ink">{session.email}</span>, and it
              opens the {mine.label.toLowerCase()} portal.
            </p>
            <p className="text-sm cf-dim leading-relaxed mb-7">
              The {theirs.label.toLowerCase()} portal is a different account. One session signs in
              to one portal, so switching means signing out of this one first.
            </p>

            <button onClick={() => navigate(`/app/${session.role}`)}
              className="cf-focus cf-btn-primary rounded-xl px-5 py-4 cf-display font-bold uppercase text-sm tracking-wide w-full">
              Go to my {mine.label.toLowerCase()} portal
            </button>
            <button onClick={() => { signOut(); navigate(`/login/${wanted}`); }}
              className="cf-focus cf-btn-outline rounded-xl px-5 py-3.5 cf-accent text-[11px] w-full mt-3">
              SIGN OUT AND USE {theirs.label.toUpperCase()}
            </button>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/**
 * Shrink a chosen picture before it ever leaves the browser.
 *
 * A photo straight off a phone is several megabytes, and the account column holds far less
 * than that — so without this the only feedback a person gets for using their own camera roll
 * is a rejection. 256px is well past what a 40px circle can show even on a 3x screen, and JPEG
 * at 0.86 keeps a face recognisable inside a few tens of kilobytes.
 */
async function shrinkImage(file, max = 256) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // Square-crop from the centre, so a portrait photo does not arrive squashed into a circle.
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap,
      (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
      0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close?.();
  }
}

/**
 * The account panel: who you are, and the three things you can change about it.
 *
 * Deliberately a panel over the portal rather than its own route. Editing a profile is a
 * detour from whatever the person came here to do — an organiser mid-session should not lose
 * the running venue to change their name — so it opens over the work and closes back onto it.
 */
function ProfilePanel({ session, onClose, onSaved }) {
  const [displayName, setDisplayName] = useState(session.displayName ?? "");
  const [bio, setBio] = useState(session.bio ?? "");
  const [avatar, setAvatar] = useState(session.avatar ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const role = ROLES[session.role] ?? ROLES.walker;

  // Escape closes, and focus starts inside the panel rather than wherever the page left it.
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    panelRef.current?.querySelector("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";           // so choosing the same file twice still fires
    if (!file) return;
    setError("");
    try {
      setAvatar(await shrinkImage(file));
    } catch {
      setError("That image could not be read. Try a PNG or JPEG.");
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const updated = await api.auth.updateProfile({
        displayName,
        bio,
        // Empty string clears it server-side; null would read as "leave alone".
        avatar: avatar ?? "",
      });
      onSaved(toSession(updated));
      setSaved(true);
      setTimeout(onClose, 700);
    } catch (err) {
      setError(err?.message ?? "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const preview = { ...session, displayName, avatar };

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <button aria-label="Close profile" onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="cf-profile-title"
        className="cf-card relative rounded-2xl w-full max-w-lg p-6 sm:p-8 my-auto">
        <div className="flex items-start justify-between gap-4 mb-7">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar session={preview} size={56} />
            <div className="min-w-0">
              <h2 id="cf-profile-title" className="cf-display font-black uppercase text-xl tracking-tight leading-none mb-1.5">
                Your profile
              </h2>
              <span className="cf-accent text-[10px] cf-dim2 block">
                {role.label.toUpperCase()} · <span className="cf-mono normal-case">{session.email}</span>
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="cf-focus cf-btn-outline rounded-lg w-9 h-9 flex items-center justify-center shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-7">
          <button onClick={() => fileRef.current?.click()}
            className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2.5 cf-accent text-[10px]">
            {avatar ? "CHANGE PICTURE" : "UPLOAD PICTURE"}
          </button>
          {avatar && (
            <button onClick={() => setAvatar(null)}
              className="cf-focus cf-btn-ghost cf-accent text-[10px]">REMOVE</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="sr-only" tabIndex={-1} />
        </div>

        <label htmlFor="cf-profile-name" className="cf-accent text-[10px] cf-dim2 block mb-2">DISPLAY NAME</label>
        <input id="cf-profile-name" value={displayName} maxLength={120}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={personName({ email: session.email })}
          className="cf-input cf-focus w-full rounded-xl px-4 py-3 text-sm mb-5" />

        <div className="flex items-baseline justify-between mb-2">
          <label htmlFor="cf-profile-bio" className="cf-accent text-[10px] cf-dim2">ABOUT YOU</label>
          <span className="cf-mono text-[10px] cf-dim2">{bio.length}/280</span>
        </div>
        <textarea id="cf-profile-bio" value={bio} maxLength={280} rows={3}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Ops lead, north stand. Radio channel 4."
          className="cf-input cf-focus w-full rounded-xl px-4 py-3 text-sm resize-none mb-2" />
        <p className="text-xs cf-dim2 leading-relaxed mb-6">
          Shown to you, and to the operators of venues you work with. Never to other attendees.
        </p>

        {error && <p role="alert" className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }}>{error}</p>}

        <button onClick={save} disabled={busy}
          className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
          {saved ? "Saved" : busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

function PortalShell({ role, session, navigate, signOut, onSession, tabs, active, setActive, children }) {
  const r = ROLES[role];
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="cf-page-in pb-20" data-portal={role}>
      {/* The portal chrome, and now the only chrome: the site header stands down inside a
          portal, so this bar carries the mark as well as the role identity, the account and
          sign out. Full-bleed rather than inset in the content column, so it reads as the
          frame around the portal rather than as the first card inside it.

          Sticky rather than fixed: it stays with you down a long session list without the
          content needing to reserve a gap for it, which is what left the dead band above. */}
      <div className="border-b sticky top-0 z-40"
        style={{ borderColor: "var(--cf-line)", background: "rgba(11,16,24,0.88)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-7xl mx-auto">
          <CoreHeaderBar
            accent={r.color}
            userName={personName(session)}
            userStatus={session?.bio || "Active now"}
            title={
              <>
                {/* The mark, and the only way back to the public site from inside a portal.
                    Sign out is the other exit, and it is next to the account where it belongs. */}
                <a href="#/" onClick={(e) => { e.preventDefault(); navigate("/"); }}
                  aria-label="Concourse — back to site"
                  className="cf-focus rounded shrink-0 hidden sm:flex items-center pr-3 mr-1 border-r"
                  style={{ borderColor: "var(--cf-line)" }}>
                  <LogoMark size={26} />
                </a>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `color-mix(in oklab, ${r.color} 18%, transparent)` }}>
                  <r.Icon className="w-4.5 h-4.5" style={{ color: r.color }} strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="cf-accent text-[9px] cf-dim2 block leading-none mb-1">{r.who.toUpperCase()}</span>
                  <h1 className="cf-display font-black uppercase text-lg sm:text-xl tracking-tight leading-none italic">
                    {r.label} portal
                  </h1>
                </span>
              </>
            }
            /* The account block is the control. A portal shows one person's identity all day,
               so the picture opens the profile rather than sitting next to something that does. */
            userAvatar={<Avatar session={session} size={36} />}
            onUserClick={() => setProfileOpen(true)}
            right={
              <button onClick={() => { signOut(); navigate("/access"); }}
                className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                SIGN OUT
              </button>
            }
          />
        </div>

        {tabs && (
          <div className="max-w-7xl mx-auto">
            <CoreStrip accent={r.color} current={active} onChange={setActive}
              links={tabs.map((t) => ({ name: t, href: t }))} />
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 pt-8">
        {children}
      </div>

      {profileOpen && (
        <ProfilePanel session={session} onClose={() => setProfileOpen(false)}
          onSaved={(updated) => onSession?.(updated)} />
      )}
    </div>
  );
}

/* ---- Walker portal ---- */

function WalkerApp({ session, navigate, signOut, onSession }) {
  const [entered, setEntered] = useState("");
  const [joinError, setJoinError] = useState("");
  const { sessions } = useSessionList(8000);

  /*
   * No venue directory here, deliberately.
   *
   * This screen used to list every venue the backend had stored so a code could be picked
   * rather than typed. That is a convenience the walker portal is not allowed to offer: the
   * access model this product publishes says an attendee never sees other clients' venues,
   * and the list showed all of them by name to anyone who signed up. The entrance signage is
   * the only thing that should hand out a code.
   */
  const flow = useConcourse();
  const { venue, rawVenue, frame, info, connected } = flow;

  // Where the attendee says they are. The backend has no per-person GPS — it simulates a crowd,
  // it does not track your phone — so this is zone-level and self-declared, and the UI says so
  // rather than drawing a false 3-metre accuracy circle.
  const [atNodeId, setAtNodeId] = useState(null);
  const [destinationId, setDestinationId] = useState(null);

  /**
   * This device's attendee id, generated once and kept.
   *
   * Opaque and attached to no account — the venue only ever learns "some attendee is in this
   * zone". Persisted so a refresh does not leave the previous id ageing out in the venue,
   * counting somebody who is not there.
   */
  const [walkerId] = useState(() => {
    const existing = localStorage.getItem("cf-walker-id");
    if (existing) return existing;
    const created = `w-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("cf-walker-id", created);
    return created;
  });

  /**
   * Check in with the venue code from the signage, not a session id.
   *
   * The code resolves against the live session list rather than being sent to the
   * backend, because a venue code is a venue id and `GET /sessions` already reports
   * which session is running on which venue. Falling back to attaching the typed value
   * directly keeps a raw session id working for anyone reading one off the admin
   * console.
   */
  const join = async () => {
    const code = normaliseCode(entered);
    const invalid = codeError(code);
    if (invalid) { setJoinError(invalid); return; }

    setJoinError("");
    const match = resolveSessionForCode(sessions, code);

    try {
      if (match) {
        await flow.attach(match.sessionId);
        return;
      }
      // No live session on that code. The venue itself may still exist — it is stored on
      // disk and outlives any run — so show the map without live crowd rather than
      // telling someone standing in the building that their venue does not exist.
      await flow.attachVenue(code);
    } catch (cause) {
      setJoinError(
        cause.status === 404
          ? `No venue found with the code "${code}". Check the code on the signage at your entrance.`
          : cause.message,
      );
    }
  };

  // Default to a gate — where you would actually be when you walk in.
  useEffect(() => {
    if (venue && !atNodeId) {
      setAtNodeId((venue.halls.find((h) => h.type === "GATE") ?? venue.halls[0])?.id ?? null);
    }
  }, [venue, atNodeId]);

  /**
   * The route, recomputed against live density.
   *
   * Client-side rather than `GET /venues/{id}/route`: the server's route is by distance
   * only and cannot see the frame, so it happily routes through the jam. This runs the
   * same graph with a congestion penalty — see src/crowdRouting.js — and it re-plans as
   * the crowd moves, which is the entire point of showing an attendee a route at all.
   */
  const route = useMemo(
    () => planRoute(rawVenue, venue, atNodeId, frame,
      destinationId ? { toNodeId: destinationId } : {}),
    [rawVenue, venue, atNodeId, frame, destinationId],
  );

  /**
   * Tells the venue which zone we are in, so the operator's density includes us.
   *
   * The same endpoint the mobile app uses, with the self-declared form — a browser has no GPS
   * worth trusting at zone granularity, and this is exactly what the phone falls back to when
   * permission is denied. One code path, so a web attendee and a phone attendee are the same
   * kind of thing in the same count.
   *
   * Re-sent on a timer as well as on change: the backend expires an attendee after
   * `session.walker-ttl-ms` (30s), so a tab left open on one zone has to keep saying so or it
   * silently stops counting.
   */
  useEffect(() => {
    if (!flow.sessionId || !atNodeId) return undefined;
    let cancelled = false;

    // Failure here must not cost the attendee their map. They still see the venue and their own
    // position; the only thing lost is the operator seeing them, and there is nothing useful an
    // attendee could do about that.
    const report = () => api.placeWalker(flow.sessionId, walkerId, { nodeId: atNodeId }).catch(() => {});

    report();
    const timer = setInterval(() => { if (!cancelled) report(); }, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [flow.sessionId, atNodeId, walkerId]);

  const here = venue?.halls.find((h) => h.id === atNodeId) ?? null;

  if (!venue) {
    return (
      /*
       * Two columns from lg, one below it.
       *
       * The attendee is on a phone in a queue, so the phone layout is the real one and the
       * form is sized for a thumb. But this also opens on a laptop, and a lone 28rem card in
       * the middle of a 1440px window reads as a page that failed to load rather than as a
       * focused one. The second column is not filler: it is the promise the removed venue
       * list was breaking, stated where someone is deciding whether to type their code in.
       */
      <div className="cf-page-in min-h-screen flex items-center px-5 sm:px-6 py-24 sm:py-32" data-portal="walker">
        <div className="w-full max-w-5xl mx-auto grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-10 lg:gap-16 items-center">
          <Reveal>
            <div className="cf-card rounded-2xl p-6 sm:p-8">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: "rgba(77,141,240,0.16)" }}>
                <MapPin className="w-6 h-6 cf-blue-hi" strokeWidth={2} aria-hidden="true" />
              </span>
              <h1 className="cf-display font-black uppercase text-3xl sm:text-4xl tracking-tight mb-2">Check in</h1>
              <p id="cf-checkin-help" className="text-sm cf-dim leading-relaxed mb-7">
                Type the venue code from the signage at your entrance. The map loads live
                from the venue's own simulation, so what you see is what the operators see.
              </p>

              <label htmlFor="cf-venue-code" className="cf-accent text-[10px] cf-dim2 block mb-2">
                VENUE CODE
              </label>
              <input id="cf-venue-code"
                value={entered} onChange={(e) => setEntered(normaliseCode(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="WEMBLEY-01"
                /* The code is printed in caps on a sign, so the field never fights the person
                   copying it: no autocapitalise surprises, no autocorrect, no spellcheck
                   underline, and the on-screen keyboard opens on the character layout. */
                autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                aria-describedby={joinError ? "cf-checkin-error" : "cf-checkin-help"}
                aria-invalid={joinError ? true : undefined}
                className="cf-input cf-focus w-full rounded-xl px-4 py-4 text-lg cf-display font-bold tracking-[0.3em] text-center mb-4" />

              {/* role="alert" so a screen reader announces the failure instead of leaving the
                  person waiting on a check-in that silently did not happen. */}
              {joinError && (
                <p id="cf-checkin-error" role="alert" className="text-sm mb-4" style={{ color: "var(--cf-red-text)" }}>
                  {joinError}
                </p>
              )}

              <button onClick={join} disabled={flow.busy}
                className="cf-focus cf-btn-primary rounded-xl px-5 py-4 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
                {flow.busy ? "Checking in…" : "Check in"}
              </button>

              <button onClick={() => { signOut(); navigate("/access"); }} className="cf-focus cf-btn-ghost cf-accent text-[11px] mt-6 w-full py-2">
                SIGN OUT
              </button>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <div className="lg:pl-2">
              <span className="cf-accent text-[10px] cf-dim2 block mb-4">ONCE YOU ARE IN</span>
              <ul className="space-y-6">
                {[
                  [Map, "The venue map, live",
                    "Every zone shaded by how full it actually is right now — blue is clear, red is a crush."],
                  [Route, "A way out around the crowd",
                    "The route is planned around the congestion rather than straight through it, and it re-plans as the crowd moves."],
                  [ShieldCheck, "You are not being tracked",
                    "Your position is the zone you tell us you are in. No GPS, no trail, and no other attendee is ever shown to you."],
                ].map(([Icon, title, body]) => (
                  <li key={title} className="flex gap-4">
                    <span className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center mt-0.5"
                      style={{ background: "rgba(77,141,240,0.12)" }}>
                      <Icon className="w-4.5 h-4.5 cf-blue-hi" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="cf-display font-bold uppercase text-sm tracking-wide block mb-1">{title}</span>
                      <span className="text-sm cf-dim leading-relaxed block">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    );
  }

  const exits = venue.halls.filter((h) => h.type === "EXIT");
  // "You" is the centre of the zone you told us you are in — no invented precision.
  const me = here ? { x: here.center[0], y: here.center[1], accuracy: here.radius } : null;

  return (
    <PortalShell role="walker" session={session} navigate={navigate} signOut={signOut} onSession={onSession}>
      <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
        <div>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <div className="cf-display font-bold uppercase text-xl tracking-wide">{venue.name}</div>
              <div className="cf-mono text-[11px] cf-dim2">
                CODE {normaliseCode(info?.venueId ?? venue.id)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionPill connected={connected} status={info?.status} />
              {/* Leave the venue's count immediately rather than waiting out the TTL. Best
                  effort: if it fails, the attendee ages out in thirty seconds anyway. */}
              <button onClick={() => {
                if (flow.sessionId) api.removeWalker(flow.sessionId, walkerId).catch(() => {});
                flow.leave(); setAtNodeId(null); setDestinationId(null);
              }}
                className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                CHANGE VENUE
              </button>
            </div>
          </div>

          {/* The banner an attendee actually needs: is the way I am being sent clear? */}
          <RouteBanner route={route} venue={venue} />

          {/* Density on, crowd dots off: an attendee should see that a zone is busy without
              being shown where every other individual is standing. */}
          <VenueMap venue={venue} people={[]} me={me} trafficRoute={route}
            showDensity showPeople={false} height={520}
            onSelectHall={setAtNodeId} selectedHall={atNodeId} />

          <div className="cf-card rounded-xl px-5 py-4 mt-4 flex items-start gap-3">
            <MapPin className="w-4 h-4 cf-blue-hi shrink-0 mt-0.5" strokeWidth={2} />
            <p className="text-sm cf-dim leading-relaxed">
              Tap the zone you're standing in. The venue is told which zone that is — never a
              coordinate — so staff see how full each area is, not where you are. You are not
              named, nothing is linked to an account, and you stop counting about thirty seconds
              after you close this. Other attendees are never shown to you.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="cf-card rounded-2xl p-5">
            <div className="cf-accent text-[10px] cf-dim2 mb-3">YOU ARE IN</div>
            <div className="flex items-center gap-3 mb-2">
              <span className="relative flex w-3 h-3">
                <span className="absolute inline-flex h-full w-full rounded-full cf-ping" style={{ background: "var(--cf-blue-hi)", opacity: .5 }} />
                <span className="relative inline-flex rounded-full w-3 h-3" style={{ background: "var(--cf-blue-hi)" }} />
              </span>
              <span className="text-sm font-semibold">{here?.name ?? "—"}</span>
            </div>
            <div className="cf-mono text-[11px] cf-dim2">ZONE-LEVEL · TAP THE MAP TO CHANGE</div>
          </div>

          {/* Turn-by-turn, coloured by what each leg is like to walk. */}
          <RouteSteps route={route} venue={venue} />

          <div className="cf-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="cf-accent text-[10px] cf-dim2">EXITS</span>
              {destinationId && (
                <button onClick={() => setDestinationId(null)}
                  className="cf-focus cf-btn-ghost cf-mono text-[9px]">CLEAR</button>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {exits.map((h) => {
                const band = trafficBand(h.density);
                const chosen = destinationId === h.id
                  || (!destinationId && route?.destination === h.id);
                return (
                  <button key={h.id}
                    onClick={() => setDestinationId(h.id === destinationId ? null : h.id)}
                    className="cf-focus flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                    style={chosen
                      ? { background: "rgba(255,255,255,0.05)", border: `1px solid ${band.color}` }
                      : { border: "1px solid transparent" }}>
                    <span className="flex items-center gap-2.5 min-w-0">
                      <LogOut className="w-3.5 h-3.5 shrink-0" style={{ color: band.color }} />
                      <span className="text-sm truncate">{h.name}</span>
                    </span>
                    <span className="cf-mono text-[10px] shrink-0" style={{ color: band.color }}>
                      {band.label}
                    </span>
                  </button>
                );
              })}
              {!exits.length && <p className="text-sm cf-dim">This venue has no marked exit.</p>}
            </div>
            {exits.length > 0 && (
              <p className="cf-mono text-[9px] cf-dim2 mt-2.5">TAP AN EXIT TO ROUTE THERE</p>
            )}
          </div>

          {venue.pois.length > 0 && (
            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-3">FACILITIES</div>
              <div className="flex flex-col gap-2">
                {venue.pois.map((p) => {
                  const Icon = POI_ICON[p.kind] ?? MapPin;
                  return (
                    <button key={p.id} onClick={() => setDestinationId(p.id.replace(/^poi-/, ""))}
                      className="cf-focus flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-white/5 transition-colors">
                      <Icon className="w-3.5 h-3.5 cf-blue-hi shrink-0" />
                      <span className="text-sm">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <ErrorNote error={flow.error} />
        </div>
      </div>
    </PortalShell>
  );
}

/**
 * The one-line verdict on the route an attendee is being shown.
 *
 * Sits above the map rather than in the sidebar because on a phone the sidebar is below
 * the fold, and "the route you are about to walk runs through a crush" is not something
 * to make anyone scroll for.
 */
export function RouteBanner({ route, venue }) {
  const reduced = useReducedMotion();
  if (!route) return null;

  const destination = zoneName(venue, route.destination);
  const minutes = Math.max(1, Math.round(route.etaSeconds / 60));

  const tone = route.noClearRoute
    ? { color: "var(--cf-red-text)", Icon: AlertTriangle,
        title: "Every route out is congested right now",
        body: `The clearest way to ${destination} still passes through heavy crowd. Move calmly and follow steward instructions.` }
    : route.detoured
      ? { color: "var(--cf-amber)", Icon: Navigation,
          title: `Routed around the crowd to ${destination}`,
          body: `${route.avoided ? `${zoneName(venue, route.avoided)} is congested, so this route goes around it. ` : ""}About ${route.detourCost}m further, and it keeps moving.` }
      : { color: "var(--cf-blue-hi)", Icon: Navigation,
          title: `Clear route to ${destination}`,
          body: `${route.distance}m, roughly ${minutes} minute${minutes === 1 ? "" : "s"} at walking pace.` };

  return (
    <motion.div
      key={`${route.destination}-${route.noClearRoute}-${route.detoured}`}
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="cf-card rounded-xl px-4 py-3.5 mb-4 flex items-start gap-3"
      style={{ borderColor: `color-mix(in oklab, ${tone.color} 45%, transparent)` }}>
      <tone.Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: tone.color }} strokeWidth={2} />
      <div className="min-w-0">
        <div className="cf-display font-bold uppercase text-sm tracking-wide"
          style={{ color: tone.color }}>{tone.title}</div>
        <p className="text-sm cf-dim leading-relaxed mt-0.5">{tone.body}</p>
      </div>
    </motion.div>
  );
}

/**
 * Turn-by-turn legs, each carrying the colour of the zone it enters.
 *
 * Named zones rather than "in 40m turn left": the venue graph has no bearings, so a
 * direction here would be invented. Zone names are what the signage says anyway.
 */
export function RouteSteps({ route, venue }) {
  const reduced = useReducedMotion();
  if (!route?.segments?.length) return null;

  return (
    <div className="cf-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="cf-accent text-[10px] cf-dim2">YOUR WAY OUT</span>
        <span className="cf-mono text-[10px]" style={{ color: route.band.color }}>
          {route.distance}m
        </span>
      </div>
      <div className="flex flex-col">
        {route.path.map((nodeId, i) => {
          const segment = route.segments[i - 1];
          const band = segment?.band;
          const last = i === route.path.length - 1;
          return (
            <motion.div key={nodeId}
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: reduced ? 0 : i * 0.05 }}
              className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
                  style={{
                    background: i === 0 ? "var(--cf-blue-hi)" : last ? "var(--cf-violet)" : band?.color,
                    boxShadow: i === 0 ? "0 0 0 3px rgba(77,141,240,.2)" : undefined,
                  }} />
                {!last && (
                  <span className="w-0.5 flex-1 my-1 rounded-full"
                    style={{ background: route.segments[i]?.band.color ?? "var(--cf-line)" }} />
                )}
              </div>
              <div className={`min-w-0 ${last ? "" : "pb-3"}`}>
                <div className="text-sm font-semibold truncate">{zoneName(venue, nodeId)}</div>
                <div className="cf-mono text-[9px] cf-dim2">
                  {i === 0 ? "YOU ARE HERE" : last ? "DESTINATION" : band?.label}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Client portal ---- */

/**
 * Session setup: upload a venue layout and open a run on it.
 *
 * The venue travels inline in POST /sessions, so there is no separate upload step — the file
 * you drop is the graph the simulation runs on.
 */
function SessionSetup({ onCreate, busy, error, initialVenue = null, onNeedsTracing = null }) {
  const [venueJson, setVenueJson] = useState(initialVenue ?? sampleVenue);
  const [fileName, setFileName] = useState(
    initialVenue ? `${initialVenue.name ?? "Traced venue"} (AI-traced)` : "venue-layout-sample.json",
  );
  const [parseError, setParseError] = useState(null);

  /**
   * The venue code — what goes on the signage and what attendees type to check in.
   *
   * It becomes the venue's `id`, which is client-supplied on `POST /venues` and carried
   * on every SessionInfo, so no new backend field is needed for this to work end to end.
   */
  const [code, setCode] = useState(() =>
    normaliseCode(initialVenue?.id ?? "") || suggestCode(initialVenue?.name ?? sampleVenue.name));
  const [codeTouched, setCodeTouched] = useState(false);

  const [settings, setSettings] = useState({
    // 6000 ticks ≈ 10 minutes of wall clock: the backend runs one tick every 100ms.
    //
    // The old 1200 ended a run after two minutes, and because a finished session stops
    // broadcasting, the map simply froze — which reads as "the live simulation is
    // broken" rather than "the run you asked for is over". Ten minutes outlasts any
    // demo; STOP is there when it should end sooner.
    crowdSize: 2500, arrivalRate: 25, maxTicks: 6000, rerouteEnabled: true,
  });
  const fileRef = useRef(null);

  // A traced layout arriving from Layout Studio replaces whatever was loaded, and
  // re-suggests a code from its name — unless the operator has already typed one, which
  // is theirs to keep.
  useEffect(() => {
    if (!initialVenue) return;
    setVenueJson(initialVenue);
    setFileName(`${initialVenue.name ?? "Traced venue"} (AI-traced)`);
    setParseError(null);
    if (!codeTouched) setCode(suggestCode(initialVenue.name));
  }, [initialVenue]); // eslint-disable-line react-hooks/exhaustive-deps

  const codeIssue = codeError(code);

  const readVenue = (file) => {
    if (!file) return;

    // An image is a floor plan, not a graph. It has to go through the tracer, which
    // lives on the AI layout tab — so hand it over rather than failing with a JSON
    // parse error that tells the operator nothing about what to do next.
    if (file.type.startsWith("image/")) {
      setParseError(null);
      onNeedsTracing?.(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          throw new Error("A venue needs a `nodes` array and an `edges` array.");
        }
        setVenueJson(parsed);
        setFileName(file.name);
        setParseError(null);
        if (!codeTouched) setCode(suggestCode(parsed.name));
      } catch (cause) {
        setParseError(`${file.name} is not a usable venue layout — ${cause.message}`);
      }
    };
    reader.readAsText(file);
  };

  /** Stamps the code onto the venue as its id, then opens the session on it. */
  const create = () => {
    if (codeIssue) return;
    onCreate({ ...venueJson, id: normaliseCode(code) }, settings);
  };

  const field = (label, key, min, max) => (
    <label className="flex flex-col gap-1.5">
      <span className="cf-accent text-[10px] cf-dim2">{label}</span>
      <input
        type="number" min={min} max={max} value={settings[key]}
        onChange={(e) => setSettings((s) => ({ ...s, [key]: Number(e.target.value) }))}
        className="cf-input cf-focus rounded-lg px-3 py-2 cf-mono text-sm" />
    </label>
  );

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Venue layout</div>
        <p className="text-sm cf-dim leading-relaxed mb-5">
          Drop a picture of your floor plan and it gets traced into a map. The sample arena
          is loaded and ready if you just want to see a crowd run.
        </p>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); readVenue(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          className="cf-focus rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center px-6 py-10 cursor-pointer transition-all"
          style={{ borderColor: "var(--cf-line2)" }}>
          <Upload className="w-6 h-6 cf-dim2 mb-3" strokeWidth={1.6} />
          <div className="cf-display font-bold uppercase text-sm tracking-wide mb-1">{fileName}</div>
          <p className="text-xs cf-dim2">
            {venueJson.nodes.length} zones · {venueJson.edges.length} walkways · click to replace
          </p>
          {/* Images first in the accept list, because a floor plan is what most people
              arrive with. A venue JSON is still accepted — it is what the tracer
              produces, so a layout traced once can be reused without re-tracing it. */}
          <input ref={fileRef} type="file"
            accept="image/png,image/jpeg,image/webp,application/json,.json"
            className="hidden"
            onChange={(e) => readVenue(e.target.files?.[0])} />
        </div>
        <p className="text-xs cf-dim2 mt-2.5">
          PNG, JPG or WEBP floor plan — or a venue JSON you traced earlier.
        </p>
        {parseError && <p className="text-sm mt-3" style={{ color: "var(--cf-red-text)" }}>{parseError}</p>}

        {/* The venue code. Deliberately on the layout side of the form rather than with
            the crowd settings: it identifies the building, and it outlives any one run. */}
        <div className="mt-6">
          <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Venue code</div>
          <p className="text-sm cf-dim leading-relaxed mb-4">
            Put this on your entrance signage. Attendees type it to check in and see the
            live map of your venue — it stays the same across every session you run here.
          </p>
          <input
            value={code}
            onChange={(e) => { setCode(normaliseCode(e.target.value)); setCodeTouched(true); }}
            aria-label="Venue code"
            aria-invalid={!!codeIssue}
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            placeholder="WEMBLEY-01"
            className="cf-input cf-focus w-full rounded-xl px-4 py-4 text-lg cf-display font-bold tracking-[0.3em] text-center" />
          {codeIssue
            ? <p className="text-sm mt-2" style={{ color: "var(--cf-red-text)" }}>{codeIssue}</p>
            : (
              <p className="cf-mono text-[10px] cf-dim2 mt-2">
                ATTENDEES CHECK IN WITH <span style={{ color: "var(--cf-orange)" }}>{normaliseCode(code)}</span>
              </p>
            )}
        </div>
      </div>

      <div>
        <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">Crowd</div>
        <p className="text-sm cf-dim leading-relaxed mb-5">
          How many people arrive, and how fast. With rerouting on, a hidden baseline run
          executes alongside on the same seed so the summary has a real before and after.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-5">
          {field("CROWD SIZE", "crowdSize", 1, 10000)}
          {field("ARRIVALS / TICK", "arrivalRate", 1, 2000)}
          {field(
            // Ticks are the backend's unit but minutes are what an operator is
            // deciding, so show both rather than making them do the arithmetic.
            `RUN LENGTH · ~${Math.max(1, Math.round(settings.maxTicks / 600))} MIN`,
            "maxTicks", 1, 60000,
          )}
          <label className="flex flex-col gap-1.5">
            <span className="cf-accent text-[10px] cf-dim2">REROUTING</span>
            <button
              onClick={() => setSettings((s) => ({ ...s, rerouteEnabled: !s.rerouteEnabled }))}
              aria-pressed={settings.rerouteEnabled}
              className="cf-focus cf-btn-outline rounded-lg px-3 py-2 cf-mono text-sm text-left"
              style={settings.rerouteEnabled ? { color: "var(--cf-green)", borderColor: "var(--cf-green)" } : {}}>
              {settings.rerouteEnabled ? "ON" : "OFF"}
            </button>
          </label>
        </div>

        <button
          onClick={create} disabled={busy || !!codeIssue}
          className="cf-focus cf-btn-primary rounded-xl px-5 py-3.5 cf-display font-bold uppercase text-sm tracking-wide w-full disabled:opacity-50">
          {busy ? "Creating…" : "Create session"}
        </button>
        <div className="mt-4"><ErrorNote error={error} /></div>
      </div>
    </div>
  );
}

/** Start / pause / stop, plus the tick clock. Disabled states follow the session's status. */
function SessionControls({ info, busy, onStart, onPause, onStop, connected }) {
  const status = info?.status ?? "CREATED";
  const terminal = status === "STOPPED" || status === "COMPLETED";
  return (
    <div className="cf-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="cf-accent text-[10px] cf-dim2">SESSION</span>
        <ConnectionPill connected={connected} status={status} />
      </div>
      <div className="cf-mono text-[11px] cf-dim2 mb-1">{info?.sessionId}</div>
      <div className="cf-mono text-sm mb-2">
        TICK {info?.tick ?? 0} / {info?.maxTicks ?? 0}
      </div>

      {/* Progress, because "TICK 1180 / 1200" does not read as "about to end".
          A run that finishes stops broadcasting and the map stops moving, so the one
          thing this panel has to convey is how much time is left. */}
      <div className="mb-4">
        <DensityBar height={3}
          density={(info?.tick ?? 0) / Math.max(1, info?.maxTicks ?? 1)}
          color={terminal ? "var(--cf-dim2)" : "var(--cf-blue-hi)"} />
      </div>

      {/* A finished run is the single most confusing state in the app: everything
          simply stops, with nothing on screen saying why. Say it plainly, and offer
          the way forward rather than leaving three disabled buttons. */}
      {terminal && (
        <div className="rounded-lg px-3 py-2.5 mb-3"
          style={{ background: "rgba(77,141,240,0.1)", border: "1px solid rgba(77,141,240,0.3)" }}>
          <div className="cf-mono text-[10px] mb-1" style={{ color: "var(--cf-blue-hi)" }}>
            {status === "COMPLETED" ? "RUN FINISHED" : "RUN STOPPED"}
          </div>
          <p className="text-xs cf-dim leading-relaxed">
            {status === "COMPLETED"
              ? `Reached tick ${info?.maxTicks ?? 0}, so the crowd has stopped moving. Start a new session to run again — raise MAX TICKS for a longer run.`
              : "You stopped this run. Start a new session to run again."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button onClick={onStart} disabled={busy || terminal || status === "RUNNING"}
          className="cf-focus cf-btn-primary rounded-lg px-3 py-2.5 cf-accent text-[10px] disabled:opacity-40">START</button>
        <button onClick={onPause} disabled={busy || status !== "RUNNING"}
          className="cf-focus cf-btn-outline rounded-lg px-3 py-2.5 cf-accent text-[10px] disabled:opacity-40">PAUSE</button>
        <button onClick={onStop} disabled={busy || terminal}
          className="cf-focus cf-btn-outline rounded-lg px-3 py-2.5 cf-accent text-[10px] disabled:opacity-40">STOP</button>
      </div>
    </div>
  );
}

/**
 * The operator's safety panel: which zones are dangerous, and what to do about each.
 *
 * Distinct from the admin Incidents feed, which is a *log* — every alert the backend has
 * raised, newest first, including ones that have since resolved. This is the opposite: a
 * live picture of what is wrong right now, ranked, with the one at the top being the one
 * to act on. A log is for the review afterwards; this is for the next thirty seconds.
 *
 * Capped at four. An operator scanning a phone during an incident reads the top of a
 * list, not the bottom, and a panel that lists every zone above 50% buries the crush
 * under the queues.
 */
export function HazardAlerts({ hazards }) {
  const reduced = useReducedMotion();
  const top = (hazards ?? []).slice(0, 4);

  const critical = top.filter((h) => hazardWarning(h).severity === "CRITICAL").length;

  return (
    <div className="cf-card rounded-2xl p-5"
      style={critical ? { borderColor: "rgba(225,6,0,.5)" } : {}}>
      <div className="flex items-center justify-between mb-4">
        <span className="flex items-center gap-2">
          <AlertTriangle className={`w-3.5 h-3.5 ${critical ? "cf-red cf-pulse" : "cf-dim2"}`} strokeWidth={2} />
          <span className={`cf-accent text-[10px] ${critical ? "cf-red" : "cf-dim2"}`}>
            CROWD SAFETY
          </span>
        </span>
        {critical > 0 && (
          <span className="cf-mono text-[9px] px-2 py-0.5 rounded"
            style={{ background: "rgba(225,6,0,.16)", color: "var(--cf-red-text)" }}>
            {critical} CRITICAL
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {top.map((hazard) => {
          const warning = hazardWarning(hazard);
          const colour = warning.severity === "CRITICAL" ? "var(--cf-red)"
            : warning.severity === "WARNING" ? "var(--cf-amber)" : "var(--cf-dim)";
          return (
            <motion.div key={hazard.hall.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden">
              <div className="flex gap-2.5 pb-3.5 mb-3.5 border-b cf-hairline last:border-b-0">
                <span className="w-1 rounded-full shrink-0" style={{ background: colour }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="cf-mono text-[9px]" style={{ color: colour }}>
                      {warning.severity}
                    </span>
                    <span className="cf-mono text-[9px] cf-dim2">
                      {Math.round(hazard.density * 100)}%
                      {hazard.rising && " ↑"}
                    </span>
                  </div>
                  <div className="text-sm font-semibold leading-snug">{warning.title}</div>
                  <p className="text-xs cf-dim leading-relaxed mt-1">{warning.body}</p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {!top.length && (
        <p className="text-sm cf-dim leading-relaxed">
          Every zone is below the warning line. Alerts appear here the moment one starts
          filling faster than it can clear.
        </p>
      )}
    </div>
  );
}

/**
 * Ties a venue's layout to real coordinates, so the mobile app can turn a GPS fix into a zone.
 *
 * Three anchors. Two would seem enough — a similarity has four degrees of freedom and two points
 * give four equations — but a rotation and its mirror image fit two points equally well, and
 * since venue y runs downward while north runs up, the mirrored one is usually what a two-point
 * solve picks. The result fits both anchors perfectly and sends people to the gate diagonally
 * opposite. The third anchor settles handedness from the data.
 *
 * Deliberately typed rather than walked: coordinates for three known gates can be read off any
 * map app in a minute, which unblocks the demo without anybody standing in the building. A
 * "stand here, tap" capture mode belongs in the phone app, later.
 */
function GeorefPanel({ venue }) {
  const zones = venue.halls;
  const [rows, setRows] = useState(() => [0, 1, 2].map((i) => ({
    // Gates and exits first: zone radius comes from capacity, so those are the smallest and the
    // easiest to stand in the middle of. Anchor placement error is the ceiling on the accuracy
    // of this whole feature.
    nodeId: (zones.filter((z) => z.type === "GATE" || z.type === "EXIT")[i] ?? zones[i])?.id ?? "",
    lat: "",
    lng: "",
  })));
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getGeoref(venue.id)
      .then((georef) => { if (!cancelled) setResult(georef); })
      // 404 is the ordinary answer — most venues have no georeference and never will.
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [venue.id]);

  const setRow = (i, patch) =>
    setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const anchors = rows.map((row) => ({
        nodeId: row.nodeId,
        lat: Number(row.lat),
        lng: Number(row.lng),
      }));
      if (anchors.some((a) => !a.nodeId || !Number.isFinite(a.lat) || !Number.isFinite(a.lng))) {
        setError("Every anchor needs a zone and a numeric latitude and longitude.");
        return;
      }
      setResult(await api.setGeoref(venue.id, anchors));
    } catch (cause) {
      // The backend's messages name the measurement that failed and the value it needed, which
      // is far more useful than anything this form could work out for itself.
      setError(cause.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.clearGeoref(venue.id);
      setResult(null);
      setError(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-card rounded-2xl p-6">
      <div className="cf-display font-bold uppercase text-lg tracking-wide mb-2">
        GPS reference
      </div>
      <p className="text-sm cf-dim leading-relaxed mb-5">
        Stand in three zones and record the coordinates your phone reports, or read them off a map
        app. Attendees on the mobile app can then be placed automatically instead of tapping their
        zone. Without this the app still works — it just asks people where they are.
      </p>

      {result ? (
        <div className="cf-card-solid rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Check className="w-4 h-4" style={{ color: "var(--cf-green)" }} strokeWidth={2.5} />
            <span className="text-sm font-semibold">This venue is georeferenced</span>
          </div>
          <div className="cf-mono text-[11px] cf-dim2">
            {result.scaleRatio?.toFixed(2)} layout units per metre · {result.shearDegrees?.toFixed(1)}° shear
          </div>
          {/* Reported, not enforced. A stylised layout genuinely has some shear, and the person
              who drew it is better placed than the server to judge how much is too much. */}
          {result.shearDegrees > 15 && (
            <div className="cf-mono text-[11px] mt-2" style={{ color: "var(--cf-amber)" }}>
              High shear — the fit may be absorbing anchor error. Check the three readings.
            </div>
          )}
          <button onClick={clear} disabled={busy}
            className="cf-focus cf-btn-outline rounded-lg px-3 py-1.5 cf-accent text-[10px] mt-3">
            REMOVE
          </button>
        </div>
      ) : (
        <div className="cf-mono text-[11px] cf-dim2 mb-5">
          NOT SET · the app will ask attendees to tap their zone
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_7rem] gap-2">
            <select value={row.nodeId} onChange={(e) => setRow(i, { nodeId: e.target.value })}
              className="cf-input cf-focus rounded-lg px-3 py-2 text-sm">
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
            <input value={row.lat} onChange={(e) => setRow(i, { lat: e.target.value })}
              placeholder="lat" inputMode="decimal"
              className="cf-input cf-focus rounded-lg px-3 py-2 text-sm cf-mono" />
            <input value={row.lng} onChange={(e) => setRow(i, { lng: e.target.value })}
              placeholder="lng" inputMode="decimal"
              className="cf-input cf-focus rounded-lg px-3 py-2 text-sm cf-mono" />
          </div>
        ))}
      </div>

      <p className="cf-mono text-[10px] cf-dim2 mt-3 leading-relaxed">
        USE GATES AND EXITS. A zone's radius comes from its capacity, so a gate is a few metres
        across and a large stand is tens — and how close to a zone's centre you stood is the limit
        on how accurate any of this can be.
      </p>

      <ErrorNote error={error} />

      <button onClick={save} disabled={busy}
        className="cf-focus cf-btn-primary rounded-xl px-5 py-3 cf-display font-bold uppercase text-sm tracking-wide w-full mt-4 disabled:opacity-50">
        {busy ? "Saving…" : result ? "Replace anchors" : "Set anchors"}
      </button>
    </div>
  );
}

function ClientApp({ session, navigate, signOut, onSession }) {
  const [tab, setTab] = useState("Live");
  /** A venue graph the AI traced out of a floor plan, waiting to be turned into a run. */
  const [tracedVenue, setTracedVenue] = useState(null);

  /** A floor plan dropped on the Live tab, handed to Layout Studio to trace. */
  const [planToTrace, setPlanToTrace] = useState(null);

  const flow = useConcourse();
  const { venue, people, frame, info, metrics, advisory, aiStatus, reroutePath, connected, busy, error } = flow;

  /** Zones worth an operator's attention, worst first. Recomputed per frame. */
  const hazards = useMemo(
    () => rankHazards(venue?.halls, frame?.predictedRisk),
    [venue?.halls, frame?.predictedRisk],
  );

  return (
    <PortalShell role="client" session={session} navigate={navigate} signOut={signOut} onSession={onSession}
      tabs={["Live", "AI layout", "GPS"]} active={tab} setActive={setTab}>

      {tab === "Live" && !venue && (
        <SessionSetup onCreate={flow.create} busy={busy} error={error}
          initialVenue={tracedVenue}
          onNeedsTracing={(file) => { setPlanToTrace(file); setTab("AI layout"); }} />
      )}

      {tab === "Live" && venue && (
        <div className="grid lg:grid-cols-[1fr_19rem] gap-6">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <div className="cf-display font-bold uppercase text-xl tracking-wide">{venue.name}</div>
                {/* The code, given the prominence it needs: this is the string that has
                    to end up on the signage, and an operator should be able to read it
                    off this screen without hunting. */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="cf-accent text-[9px] cf-dim2">CHECK-IN CODE</span>
                  <span className="cf-display font-bold text-sm tracking-[0.25em] px-2 py-0.5 rounded"
                    style={{ background: "rgba(255,106,0,0.14)", color: "var(--cf-orange)" }}>
                    {normaliseCode(info?.venueId ?? venue.id)}
                  </span>
                </div>
              </div>
              <button onClick={flow.leave} className="cf-focus cf-btn-outline rounded-lg px-3.5 py-2 cf-accent text-[10px]">
                NEW SESSION
              </button>
            </div>
            {/* No `route` here. The diversion polyline drew a single line from an entrance
                clean across to an exit, which read as a route every agent was taking rather
                than as one advisory path — and it appeared at the end of a run, when the last
                reroute happened to be the longest. The rerouted agents already carry an orange
                marker, which says the same thing without drawing a road that is not there. */}
            <VenueMap venue={venue} people={people} crowdTotal={metrics?.peopleInside ?? 0}
              me={null} height={520}
              // Schematic, not the generated floor art.
              //
              // The art looked better in isolation but could not keep its promise: its painted
              // walls and the venue graph are two different things that only approximately
              // agree, so agents legitimately placed by the simulation still landed on drawn
              // void. Here the zones and corridors on screen *are* the walkable mask, so a
              // figure outside them is impossible rather than merely unlikely.
              />
            <p className="cf-mono text-[10px] cf-dim2 mt-2">
              {(metrics?.peopleInside ?? 0).toLocaleString()} inside · drawn as crowd figures,
              positions sampled server-side
              {reroutePath && " · orange-tagged figures are being diverted"}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <SessionControls info={info} busy={busy} connected={connected}
              onStart={flow.start} onPause={flow.pause} onStop={flow.stop} />

            {/* Safety warnings, above the metrics: an operator scanning this column needs
                "the north concourse is about to become dangerous" before they need a
                headcount. */}
            <HazardAlerts hazards={hazards} />

            <div className="cf-card rounded-2xl p-5">
              <div className="cf-accent text-[10px] cf-dim2 mb-4">INSIDE NOW</div>
              <div className="cf-display font-black text-4xl mb-1 tabular-nums">
                <CountUp value={metrics?.peopleInside ?? 0} />
              </div>
              <div className="cf-mono text-[11px] cf-dim2 mb-4">
                OF {venue.capacity.toLocaleString()} CAPACITY · {metrics?.exited ?? 0} LEFT
              </div>
              {/* Real attendees are counted apart from simulated agents, never folded in. An
                  operator looking at a busy zone has to be able to tell how much of it is people
                  with phones and how much is the model — they are not the same evidence. */}
              {(metrics?.realWalkers ?? 0) > 0 && (
                <div className="cf-mono text-[11px] mb-4 flex items-center gap-1.5"
                  style={{ color: "var(--cf-blue-hi)" }}>
                  <Smartphone className="w-3.5 h-3.5" strokeWidth={2} />
                  {metrics.realWalkers.toLocaleString()} REAL {metrics.realWalkers === 1 ? "ATTENDEE" : "ATTENDEES"} ON THE APP
                </div>
              )}
              <DensityBar height={8}
                density={(metrics?.peopleInside ?? 0) / Math.max(1, venue.capacity)}
                color="linear-gradient(90deg, var(--cf-orange), var(--cf-red))" />
              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t cf-hairline">
                <div>
                  <div className="text-[10px] cf-mono cf-dim2 mb-0.5">PEAK DENSITY</div>
                  <div className="cf-mono font-semibold">{Math.round((metrics?.peakDensity ?? 0) * 100)}%</div>
                </div>
                <div>
                  <div className="text-[10px] cf-mono cf-dim2 mb-0.5">CRITICAL TICKS</div>
                  <div className="cf-mono font-semibold">{metrics?.criticalNodeTicks ?? 0}</div>
                </div>
              </div>
            </div>

            <div className="cf-card rounded-2xl p-5 flex-1">
              <div className="cf-accent text-[10px] cf-dim2 mb-4">ZONE STATUS</div>
              <div className="flex flex-col gap-3">
                {venue.halls.map((h) => (
                  <div key={h.id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm truncate pr-2">{h.name}</span>
                      <span className="cf-mono text-[11px] shrink-0 tabular-nums" style={{ color: densityColor(h.density) }}>
                        <CountUp value={(h.density ?? 0) * 100} format={(n) => `${Math.round(n)}%`} />
                      </span>
                    </div>
                    <DensityBar density={h.density} color={densityColor(h.density)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="cf-card rounded-2xl p-5" style={advisory ? { borderColor: "rgba(225,6,0,.35)" } : {}}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-3.5 h-3.5 ${advisory ? "cf-red" : "cf-dim2"}`} />
                <span className={`cf-accent text-[10px] ${advisory ? "cf-red" : "cf-dim2"}`}>ADVISORY</span>
              </div>
              <p className="text-sm cf-dim leading-relaxed">
                {advisory ?? "No advisory yet — the AI layer is called once density moves enough to be worth asking about."}
              </p>
              {aiStatus && <div className="cf-mono text-[10px] cf-dim2 mt-3">AI · {aiStatus}</div>}
            </div>

            <ErrorNote error={error} />
          </div>
        </div>
      )}

      {/* AI tracing. Its own tab rather than a step inside session setup, because a plan
          is traced once for a building and then reused for every run on it. */}
      {tab === "GPS" && !venue && (
        <div className="cf-card rounded-2xl px-6 py-14 text-center">
          <p className="text-sm cf-dim">Create a session on the Live tab to georeference its venue.</p>
        </div>
      )}

      {tab === "GPS" && venue && <GeorefPanel venue={venue} />}

      {tab === "AI layout" && (
        <div>
          <div className="cf-card rounded-2xl p-6 mb-6 flex items-start gap-4">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(255,106,0,0.16)" }}>
              <Cpu className="w-5 h-5 cf-orange" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="cf-display font-bold uppercase text-base tracking-wide mb-1.5">
                Turn a floor plan into a walkable map
              </div>
              <p className="text-sm cf-dim leading-relaxed">
                Upload a 2D plan of your venue and a vision model reads it — halls, gates,
                exits — while computer vision traces the walkable space into the pathways
                the simulation actually routes people along. Check what it found, fix
                anything it got wrong, then run a session on it.
              </p>
              {tracedVenue && (
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <span className="cf-mono text-[11px] cf-green flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {tracedVenue.nodes?.length ?? 0} zones · {tracedVenue.edges?.length ?? 0} pathways ready
                  </span>
                  <button onClick={() => { flow.leave(); setTab("Live"); }}
                    className="cf-focus cf-btn-primary rounded-lg px-4 py-2 cf-accent text-[10px]">
                    USE IT FOR A SESSION
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Confirmed graphs land here. LayoutStudio only fires this once the *server*
              has re-validated the operator's edits, so a graph reaching this callback has
              already been checked for a gate that cannot reach an exit. */}
          <LayoutStudio initialFile={planToTrace}
            onConfirmed={(v) => { setTracedVenue(v); }} />
        </div>
      )}

    </PortalShell>
  );
}

/* ---- Admin portal ---- */

/**
 * Polls GET /sessions. Every session on the backend, newest first — baseline twins excluded
 * server-side, since a shadow run is an implementation detail and not something to operate.
 *
 * ponytail: a 4s poll, not a socket. The session list changes only when somebody creates or
 * stops a run; opening a second WebSocket to learn that would cost more than it saves. The
 * live numbers inside a session still arrive on its own stream.
 */
function useSessionList(intervalMs = 4000) {
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const list = await api.listSessions();
        if (!cancelled) { setSessions(list); setError(null); }
      } catch (cause) {
        if (!cancelled) setError(cause.message);
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [intervalMs]);

  return { sessions, error };
}

function AdminApp({ session, navigate, signOut, onSession }) {
  const [tab, setTab] = useState("Overview");
  const reduced = useReducedMotion();
  const { sessions, error: listError } = useSessionList();
  const flow = useConcourse();
  const { venue, people, frame, alerts, connected, info } = flow;

  // Follow the first running session by default, so the overview is populated on arrival
  // rather than requiring a click to show anything at all.
  useEffect(() => {
    if (flow.sessionId || !sessions.length) return;
    const target = sessions.find((s) => s.status === "RUNNING") ?? sessions[0];
    flow.attach(target.sessionId).catch(() => {});
  }, [sessions, flow.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => ({
    venues: new Set(sessions.map((s) => s.venueId)).size,
    inside: sessions.reduce((sum, s) => sum + (s.peopleInside ?? 0), 0),
    critical: (frame?.nodes ?? []).filter((n) => n.status === "CRITICAL").length,
    peakRisk: Math.max(0, ...Object.values(frame?.predictedRisk ?? {})),
  }), [sessions, frame]);

  /** Alerts newest first, which is the only order a live feed makes sense in. */
  const incidents = useMemo(() => [...alerts].reverse(), [alerts]);

  return (
    <PortalShell role="admin" session={session} navigate={navigate} signOut={signOut} onSession={onSession}
      tabs={["Overview", "Venues", "Incidents"]} active={tab} setActive={setTab}>

      {tab === "Overview" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { v: totals.venues, l: "ACTIVE VENUES", f: (n) => Math.round(n) },
              { v: totals.inside, l: "PEOPLE INSIDE" },
              { v: totals.critical, l: "ZONES CRITICAL", c: totals.critical ? "var(--cf-red)" : undefined, f: (n) => Math.round(n) },
              { v: totals.peakRisk, l: "PEAK PREDICTED RISK", c: "var(--cf-orange)", f: (n) => n.toFixed(2) },
            ].map((s, i) => (
              <motion.div key={s.l} className="cf-card rounded-2xl p-6"
                initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.4, delay: reduced ? 0 : i * 0.06, ease: [0.16, 1, 0.3, 1] }}>
                <div className="cf-display font-black text-3xl mb-1 tabular-nums" style={{ color: s.c || "var(--cf-ink)" }}>
                  <CountUp value={s.v} format={s.f} />
                </div>
                <div className="cf-accent text-[10px] cf-dim2">{s.l}</div>
              </motion.div>
            ))}
          </div>
          <div className="mb-4"><ErrorNote error={listError ?? flow.error} /></div>
          <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {sessions.map((s) => (
                  <button key={s.sessionId} onClick={() => flow.attach(s.sessionId)}
                    className="cf-focus cf-accent text-[11px] rounded-lg px-4 py-2 transition-colors"
                    style={s.sessionId === flow.sessionId
                      ? { background: "color-mix(in oklab, var(--cf-red) 18%, transparent)", color: "var(--cf-red-text)", border: "1px solid var(--cf-red)" }
                      : { border: "1px solid var(--cf-line)", color: "var(--cf-dim)" }}>
                    {s.venueName} · {s.status}
                  </button>
                ))}
                {!sessions.length && (
                  <span className="text-sm cf-dim">No sessions running. Open the client portal to create one.</span>
                )}
                {flow.sessionId && <ConnectionPill connected={connected} status={info?.status} />}
              </div>
              {venue ? (
                <VenueMap venue={venue} people={people} me={null} height={480} />
              ) : (
                <div className="cf-card rounded-2xl px-6 py-20 text-center">
                  <p className="text-sm cf-dim">Select a session to watch its map.</p>
                </div>
              )}
            </div>
            <div className="cf-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Bell className="w-3.5 h-3.5 cf-orange" />
                <span className="cf-accent text-[10px] cf-dim2">LIVE FEED</span>
              </div>
              <div className="flex flex-col gap-4">
                {/* `popLayout` so an arriving alert slides the rest down rather than
                    shoving them — on a feed that updates mid-incident, a list that jumps
                    is a list an operator loses their place in. */}
                <AnimatePresence initial={false} mode="popLayout">
                  {incidents.map((inc) => (
                    <motion.div key={inc.id} layout className="flex gap-3"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                        style={{ background: (STATUS_META[inc.severity] ?? STATUS_META.OK).c }} />
                      <div className="min-w-0">
                        <div className="cf-mono text-[10px] cf-dim2 mb-0.5">
                          TICK {inc.tick} · {Math.round(inc.density * 100)}%
                        </div>
                        <div className="text-sm leading-snug">{zoneName(venue, inc.nodeId)}</div>
                        <div className="text-xs cf-dim leading-snug mt-0.5">{inc.message}</div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {!incidents.length && (
                  <p className="text-sm cf-dim">Nothing raised yet. Alerts appear as zones cross the warning line.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "Venues" && (
        <div className="cf-card rounded-2xl overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_9rem_8rem_8rem_8rem] gap-4 px-6 py-3 border-b cf-hairline cf-accent text-[11px] cf-dim2">
            <span>VENUE</span><span>SESSION</span><span>CROWD</span><span>INSIDE</span><span>STATUS</span>
          </div>
          {sessions.map((s) => {
            const meta = SESSION_STATUS_META[s.status] ?? SESSION_STATUS_META.CREATED;
            return (
              <div key={s.sessionId} className="grid sm:grid-cols-[1fr_9rem_8rem_8rem_8rem] gap-4 items-center px-6 py-4 border-b cf-hairline last:border-b-0 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg cf-chip flex items-center justify-center shrink-0"><Building2 className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{s.venueName}</div>
                    <div className="cf-mono text-[10px] cf-dim2">
                      tick {s.tick} / {s.maxTicks} · {s.viewers} watching
                    </div>
                  </div>
                </div>
                <span className="cf-mono text-xs cf-dim2 truncate">{s.sessionId}</span>
                <span className="cf-mono text-xs">{s.crowdSize.toLocaleString()}</span>
                <span className="cf-mono text-xs">{(s.peopleInside ?? 0).toLocaleString()}</span>
                <span className="cf-mono text-[11px]" style={{ color: meta.c }}>{meta.l}</span>
              </div>
            );
          })}
          {!sessions.length && (
            <div className="px-6 py-14 text-center"><p className="text-sm cf-dim">No sessions yet.</p></div>
          )}
        </div>
      )}

      {tab === "Incidents" && (
        <div className="cf-card rounded-2xl overflow-hidden">
          {incidents.map((inc) => {
            const meta = STATUS_META[inc.severity] ?? STATUS_META.OK;
            return (
              <div key={inc.id} className="flex items-start gap-4 px-6 py-5 border-b cf-hairline last:border-b-0">
                <span className="cf-mono text-xs cf-dim2 shrink-0 w-12">t{inc.tick}</span>
                <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: meta.c }} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">
                    {zoneName(venue, inc.nodeId)}
                    <span className="cf-dim2 cf-mono text-[11px] ml-2">{Math.round(inc.density * 100)}% · {inc.trend}</span>
                  </div>
                  <div className="text-sm cf-dim mt-0.5">{inc.message}</div>
                </div>
                <span className="cf-mono text-[10px] shrink-0" style={{ color: meta.c }}>{meta.l}</span>
              </div>
            );
          })}
          {!incidents.length && (
            <div className="px-6 py-14 text-center">
              <p className="text-sm cf-dim">No incidents on this session.</p>
            </div>
          )}
        </div>
      )}
    </PortalShell>
  );
}

/** Alerts carry a node id; the readable name lives on the venue. Falls back to the id. */
function zoneName(venue, nodeId) {
  return venue?.halls.find((h) => h.id === nodeId)?.name ?? nodeId;
}

/* ============================================================================
   Footer
   ========================================================================== */

function Footer({ navigate }) {
  return (
    <footer className="border-t cf-hairline relative" style={{ background: "rgba(5,7,11,0.6)" }}>
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid md:grid-cols-[2fr_1fr_1fr] gap-10 mb-10">
          <div>
            <Wordmark size={32} className="mb-4" />
            <p className="cf-dim text-sm leading-relaxed max-w-sm mb-5">
              Simulate the venue, predict the bottleneck, route around it — before the queue becomes a crush.
            </p>
            {/* The density ramp as a legend. It is the one piece of visual language a reader
                needs to interpret every map on the site, so it is worth restating at the end. */}
            <div className="flex items-center gap-2">
              <span className="cf-accent text-[10px] cf-dim2">CLEAR</span>
              <span className="h-1.5 w-28 rounded-full" style={{ background: "linear-gradient(90deg, var(--cf-green), var(--cf-amber), var(--cf-orange), var(--cf-red))" }} />
              <span className="cf-accent text-[10px] cf-dim2">CRUSH</span>
            </div>
          </div>
          <div>
            <div className="cf-accent text-[10px] cf-dim2 mb-4">PLATFORM</div>
            <div className="flex flex-col gap-2">
              {NAV.map((r) => (
                <a key={r.path} href={`#${r.path}`} onClick={(e) => { e.preventDefault(); navigate(r.path); }}
                  className="text-sm cf-dim hover:text-white cf-focus rounded w-fit transition-all duration-300 hover:translate-x-1">{r.label}</a>
              ))}
            </div>
          </div>
          <div>
            <div className="cf-accent text-[10px] cf-dim2 mb-4">PORTALS</div>
            <div className="flex flex-col gap-2">
              {Object.values(ROLES).map((r) => (
                <a key={r.key} href={`#/login/${r.key}`} onClick={(e) => { e.preventDefault(); navigate(`/login/${r.key}`); }}
                  className="text-sm cf-dim hover:text-white cf-focus rounded w-fit transition-all duration-300 hover:translate-x-1">{r.label}</a>
              ))}
            </div>
          </div>
        </div>
        <p className="cf-dim2 text-xs cf-mono border-t cf-hairline pt-8">
          CROWD SAFETY AND INDOOR WAYFINDING FOR VENUES
        </p>
      </div>
    </footer>
  );
}

/* ============================================================================
   App
   ========================================================================== */

export default function ConcourseApp() {
  const [route, navigate] = useHashRoute();
  const [session, setSession] = useState(null);

  // A token in localStorage outlives the page, so the app asks the backend who it belongs to
  // on boot. Without this, a refresh looked signed-out while every API call was still
  // authenticated — the two states would disagree until the next manual login.
  useEffect(() => {
    let alive = true;
    api.auth.me()
      .then((me) => {
        if (alive && me) setSession(toSession(me));
      })
      .catch(() => { /* signed out is the correct fallback */ });
    return () => { alive = false; };
  }, []);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [route]);

  const signIn = (s) => setSession(s);
  const signOut = () => { api.auth.signOut(); setSession(null); };

  /* Portal chrome, not site chrome. Also covers /login/* while a session exists, because that
     route then renders the "signed in as" guard — and offering the site's routes beside it
     would hand back the same lane to another tier's sign-in that the guard just closed. */
  const isPortal = route.startsWith("/app/") || (!!session && route.startsWith("/login/"));
  const loginMatch = route.match(/^\/login\/(walker|client|admin)$/);
  const appMatch = route.match(/^\/app\/(walker|client|admin)$/);

  /*
   * One session, one portal.
   *
   * These routes used to check only that *a* session existed, so a signed-in walker who typed
   * /app/admin got the operations console rendered around them. The backend refused every
   * request it made, so no data escaped — but the product's whole claim is that each portal
   * shows exactly what its job requires and nothing beyond it, and a console that draws itself
   * and then fails to fill in is a worse answer than not drawing.
   *
   * A mismatch is not treated as an error either. Landing on the wrong tier is almost always a
   * stale link or a shared URL, so the guard states which account is signed in and offers the
   * two things that actually help: go to your own portal, or sign out and use the other one.
   */
  let page;
  if (loginMatch) {
    const wanted = loginMatch[1];
    if (!session) {
      page = <LoginPage roleKey={wanted} navigate={navigate} signIn={signIn} />;
    } else if (session.role === wanted) {
      page = <AlreadySignedIn session={session} wanted={wanted} navigate={navigate} signOut={signOut} sameTier />;
    } else {
      page = <AlreadySignedIn session={session} wanted={wanted} navigate={navigate} signOut={signOut} />;
    }
  } else if (appMatch) {
    const role = appMatch[1];
    if (!session) {
      page = <LoginPage roleKey={role} navigate={navigate} signIn={signIn} />;
    } else if (session.role !== role) {
      page = <AlreadySignedIn session={session} wanted={role} navigate={navigate} signOut={signOut} />;
    } else if (role === "walker") {
      page = <WalkerApp session={session} navigate={navigate} signOut={signOut} onSession={setSession} />;
    } else if (role === "client") {
      page = <ClientApp session={session} navigate={navigate} signOut={signOut} onSession={setSession} />;
    } else {
      page = <AdminApp session={session} navigate={navigate} signOut={signOut} onSession={setSession} />;
    }
  } else {
    switch (route) {
      case "/how": page = <HowItWorksPage navigate={navigate} />; break;
      case "/platform": page = <PlatformPage navigate={navigate} />; break;
      case "/intelligence": page = <IntelligencePage />; break;
      case "/results": page = <ResultsPage />; break;
      case "/access": page = <AccessPage navigate={navigate} />; break;
      default: page = <HomePage navigate={navigate} />;
    }
  }

  return (
    <div className="cf-root">
      <style>{STYLE}</style>
      <MeshField />
      <div className="relative" style={{ zIndex: 2 }}>
        <Header route={route} navigate={navigate} session={session} signOut={signOut} inPortal={isPortal} />
        {/* `mode="wait"` so the outgoing page finishes leaving before the next arrives.
            Cross-fading them instead put two full-height pages in the layout at once and
            the footer jumped as they swapped. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.main key={route}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}>
            {page}
          </motion.main>
        </AnimatePresence>
        {!isPortal && <Footer navigate={navigate} />}
      </div>
    </div>
  );
}
