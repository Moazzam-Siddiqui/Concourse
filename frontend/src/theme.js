/**
 * Every colour, surface, type and motion decision for the app.
 *
 * Its own module because it is CSS, not JSX: inside the component file it was a 437
 * line template literal, where one backtick inside a comment closes the string and
 * breaks the build with an error pointing at a line of prose. Here it is only ever a
 * string, and it is the single place to change how the product looks.
 */
export const STYLE = `
  :root{
    color-scheme:light;
    /* Paper, not white. A true #FFF ground makes warm greys look dirty; an off-white
       with a little yellow in it is what lets beige, olive and terracotta sit together
       without any of them turning muddy. */
    --cf-bg:#F7F4EE; --cf-panel:#F2EDE3; --cf-card:#EFE9DD; --cf-card-hi:#E6DFD0;
    --cf-line:#DED6C6; --cf-line2:#C7BDAA;

    /* Warm near-black rather than a true black, and warm greys under it, so the text
       belongs to the same family as the ground instead of sitting on top of it. */
    --cf-ink:#211E1A; --cf-dim:#5E5951; --cf-dim2:#6E6759;

    /* Olive is the accent: buttons, focus, links, the mark. It is the only colour here
       that is neither paper nor data, which is the whole job - one hue for "you can act
       on this", and it sits outside the ramp so a control can never be mistaken for a
       zone in trouble. */
    --cf-olive:#5F6B39; --cf-olive-text:#4E5830; --cf-olive-lo:#E4E7D5;
    --cf-porcelain:#5F6B39; --cf-porcelain-lo:#E4E7D5;
    --cf-lime:#5F6B39; --cf-lime-text:#4E5830; --cf-lime-lo:#E4E7D5;
    --cf-cobalt:#5F6B39; --cf-cobalt-text:#4E5830; --cf-cobalt-lo:#E4E7D5;
    --cf-champagne:#5F6B39; --cf-champagne-lo:#E4E7D5;

    /* The density ramp, in earth. Dusty blue is clear, ochre is filling, terracotta is a
       crush. Ochre is the one colour not in the supplied palette: a ramp needs three
       stops and only the two ends were given, and it sits between them in hue and in
       weight so the scale stays continuous. */
    --cf-flow:#4E6B87;
    --cf-sage:#4E6B87; --cf-attention:#96661F; --cf-coral:#A94A32;
    --cf-green:#4E6B87; --cf-blue-hi:#4E6B87; --cf-blue:#3A536B; --cf-blue-lo:#DCE4EC;
    --cf-orange:#96661F; --cf-amber:#96661F;
    --cf-red:#A94A32; --cf-red-text:#8F3D28;

    /* The three portal identities, drawn from the same six. */
    --cf-iris:#5F6B39; --cf-iris-text:#4E5830; --cf-iris-lo:#E4E7D5;
    --cf-cyan:#4E6B87; --cf-cyan-text:#3F5A73; --cf-cyan-lo:#DCE4EC;
    --cf-fuchsia:#A94A32; --cf-fuchsia-text:#8F3D28; --cf-fuchsia-lo:#F0DED6;

    /* Warm neutral chrome for rules and borders. */
    --cf-metal:#6E6759; --cf-metal-hi:#211E1A; --cf-metal-lo:#C7BDAA;
    --cf-violet:#7A6A8C;

    /* Doors, read against the dark map plate rather than against the page, so these are
       the two lightest things on it. Olive out because an exit sign is always green;
       beige in because nothing else on the plate is paper-coloured. */
    --cf-way-out:#9CAF6B; --cf-way-in:#E8E1D2;

    /* The map: a warm near-black plate. Warm, so it reads as a plate laid on the paper
       rather than as a hole cut through it. */
    --cf-plate:#262119; --cf-plate-hi:#2E281F;

    /* Shadows are soft, warm and low. On paper a shadow is the only depth cue there is,
       and a neutral grey one against a warm ground reads as dirt. */
    --cf-shadow-sm:0 1px 2px rgba(64,54,38,.06), 0 2px 10px -6px rgba(64,54,38,.10);
    --cf-shadow-md:0 10px 28px -14px rgba(64,54,38,.22);
    --cf-shadow-lg:0 26px 60px -30px rgba(64,54,38,.30);
    --cf-glow-ember:0 0 0 1px rgba(33,30,26,.07), 0 14px 40px -22px rgba(64,54,38,.22);

    /* IBM Carbon's spacing scale, verbatim. Every value is a multiple of 2, 4 or 8 and
       snaps to an 8px base, which is what stops a layout drifting into 13px here and
       27px there. Ad-hoc padding is the thing that makes a page read as unplanned even
       when every colour is right. */
    --cf-s01:0.125rem; --cf-s02:0.25rem; --cf-s03:0.5rem;  --cf-s04:0.75rem;
    --cf-s05:1rem;     --cf-s06:1.5rem;  --cf-s07:2rem;    --cf-s08:2.5rem;
    --cf-s09:3rem;     --cf-s10:4rem;    --cf-s11:5rem;    --cf-s12:6rem;
    --cf-s13:10rem;

    /* Carbon's productive type scale. Each size ships with the line-height it was drawn
       for - the pairing is the token, not the size on its own. Weight drops as size
       rises, which is why large headings here are lighter than the body, not heavier. */
    --cf-t-label:0.75rem;   --cf-lh-label:1rem;
    --cf-t-body:1rem;       --cf-lh-body:1.5rem;
    --cf-t-h03:1.25rem;     --cf-lh-h03:1.75rem;
    --cf-t-h04:1.75rem;     --cf-lh-h04:2.25rem;
    --cf-t-h05:2rem;        --cf-lh-h05:2.5rem;
    --cf-t-h06:2.625rem;    --cf-lh-h06:3.125rem;
    --cf-t-h07:3.375rem;    --cf-lh-h07:4rem;

    /* One easing for everything that moves, so the whole UI decelerates with the same hand. */
    --cf-ease:cubic-bezier(0.16,1,0.3,1);

    /* Three speeds, by what the motion is for: pointer feedback, state change, arrival. */
    --cf-t-control:180ms;
    --cf-t-state:260ms;
    --cf-t-reveal:600ms;
  }
  .cf-section{ padding-top:var(--cf-s12); padding-bottom:var(--cf-s12); }
  @media (min-width:1024px){ .cf-section{ padding-top:var(--cf-s13); padding-bottom:var(--cf-s13); } }
  .cf-root{ background:var(--cf-bg); color:var(--cf-ink);
    font-family:'Karla','Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
    -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    position:relative; min-height:100vh; }
  /* Montserrat is geometric and wide, so it needs negative tracking to stop reading as
     a logo at paragraph-adjacent sizes - and more of it the larger it gets. */
  /* Condensed and geometric, so it takes the opposite treatment to a normal-width face:
     no negative tracking, because tightening something already narrow closes the
     counters, and a size or two larger, because it sets visibly smaller at the same
     point size. */
  .cf-display{ font-family:'Big Shoulders Display','Oswald',Impact,sans-serif;
    letter-spacing:0.004em; font-weight:700; }
  .cf-accent{ font-family:'Big Shoulders Display','Oswald',sans-serif; font-weight:700; letter-spacing:0.18em; }
  /* The annotation voice. One weight, no italic, illegible under about 18px - so it is
     used only where a handwritten note on paper is the point, and never for a label or a
     control. */
  .cf-hand{ font-family:'Shadows Into Light',cursive; letter-spacing:0.01em; }

  /* One highlight crossing the text, right to left, then a pause before it returns.
     no-repeat plus a band half the element wide is what makes the travel visible: with
     a repeating image every position looks identical to the last and nothing appears to
     move. Percentages here are relative to (element width - image width), so with a 50%
     image, 250% parks it fully off to the right and -100% fully off to the left. */
  .cf-shimmer{
    color:var(--cf-ink); -webkit-text-fill-color:transparent;
    background-color:currentColor;
    background-image:linear-gradient(to right, currentColor 0%,
      var(--cf-flow) 22%, var(--cf-attention) 38%, #E8BC6A 50%,
      var(--cf-attention) 62%, var(--cf-coral) 78%, currentColor 100%);
    background-repeat:no-repeat; background-size:65% 200%;
    -webkit-background-clip:text; background-clip:text;
    animation:cf-shimmer 4.5s linear infinite; }
  /* Deliberately NOT switched off under reduced motion. The preference is about things
     that travel across the screen and can cause nausea; a colour crossing stationary
     letters moves nothing. It slows down and rests longer instead, and everything on
     this page that actually moves still stops. */
  @media (prefers-reduced-motion: reduce){
    .cf-shimmer{ animation-duration:9s; } }
  @keyframes cf-shimmer{
    from{ background-position-x:250%; }
    to{ background-position-x:-100%; } }

  .cf-panel{ background:var(--cf-panel); }
  .cf-card{ background:linear-gradient(170deg, var(--cf-card), var(--cf-card-hi));
    border:1px solid var(--cf-line); box-shadow:var(--cf-shadow-sm);
    transition:transform var(--cf-t-control) var(--cf-ease), box-shadow var(--cf-t-control) var(--cf-ease), border-color var(--cf-t-control) var(--cf-ease); }
  .cf-card-solid{ background:var(--cf-card); border:1px solid var(--cf-line); }
  .cf-lift:hover{ transform:translateY(-3px); border-color:var(--cf-line2); box-shadow:var(--cf-shadow-md); }
  /* Rules carry a trace of the brand metal rather than being neutral grey. Barely
     visible on its own, but it is what stops a dark page reading as a wireframe. */
  .cf-hairline{ border-color:var(--cf-line); }
  .cf-dim{ color:var(--cf-dim); } .cf-dim2{ color:var(--cf-dim2); }
  .cf-red{ color:var(--cf-red-text); } .cf-orange{ color:var(--cf-orange); }
  .cf-amber{ color:var(--cf-amber); } .cf-green{ color:var(--cf-green); }
  .cf-blue-hi{ color:var(--cf-blue-hi); }
  .cf-bg-red{ background:var(--cf-red); }

  /* Mesh gradient field — fixed, soft, slow. The "lovable-style" backdrop. */
  /* Paper Shaders grain gradient. Sits directly above the CSS mesh and below the veil, so it
     replaces the mesh visually once it loads without either layer having to know about the
     other. Fades in because the shader chunk arrives after first paint and a hard swap of the
     whole page backdrop reads as a flash. */

  /* The veil that keeps body copy readable over the backdrop.
     Tuned against the shader, not the old CSS mesh: at the previous 0.55→0.94 ramp it was
     near-opaque black by mid-page and the gradient underneath simply could not be seen. It
     now stays light enough for the field to read through, and the pages that need the most
     protection get it from their own card surfaces instead. */
  /* Static page texture. Cheap, and it holds still so the one interactive field reads
     as deliberate rather than as more of the same. */
  /* The backdrop canvas. Fixed and pointer-transparent so it never takes a click, and
     z-index 0 with the app at 2, so it stays behind everything without needing a
     stacking context of its own. */
  .cf-wavefield{ position:fixed; inset:0; z-index:0; pointer-events:none;
    width:100%; height:100%; display:block; }

  /* The designated zone. Masked at the edges so the grid dissolves instead of ending
     on a rectangle, and it never covers its own content. */
  .cf-kfield{ position:relative; isolation:isolate; }
  .cf-kfield-canvas{ position:absolute; inset:0; width:100%; height:100%; z-index:0;
    pointer-events:none;
    -webkit-mask-image:radial-gradient(72% 62% at 50% 42%, #000 30%, transparent 78%);
    mask-image:radial-gradient(72% 62% at 50% 42%, #000 30%, transparent 78%); }
  /* Behind a portal the live map is the thing being read, so the grid steps back. */
  [data-portal] { --cf-grid-strength:0.28; }
  /* No page-wide tint. The grid is the backdrop; anything laid over it is just a
     film between the user and the interface. */
  .cf-veil{ display:none; }

  /* Was a scrim that darkened the mesh behind long-form text. There is no mesh behind it
     now and the paper is already the quietest surface on the page, so a scrim could only
     dirty it. Kept as a positioning hook; it paints nothing. */
  .cf-readable{ position:relative; }

  @keyframes cf-drift1{ from{ transform:translate3d(0,0,0) scale(1); } to{ transform:translate3d(6vw,7vh,0) scale(1.12); } }
  @keyframes cf-drift2{ from{ transform:translate3d(0,0,0) scale(1.05); } to{ transform:translate3d(-7vw,5vh,0) scale(.92); } }
  @keyframes cf-drift3{ from{ transform:translate3d(0,0,0) scale(.95); } to{ transform:translate3d(5vw,-8vh,0) scale(1.1); } }


  .cf-btn-primary{ background:var(--cf-olive); color:#F7F4EE; font-weight:700; transition:filter var(--cf-t-control) var(--cf-ease), transform var(--cf-t-control) var(--cf-ease), box-shadow var(--cf-t-control) var(--cf-ease); box-shadow:var(--cf-shadow-md); }
  .cf-btn-primary:hover{ filter:brightness(1.1); transform:translateY(-1px); }
  .cf-btn-outline{ border:1px solid var(--cf-line2); color:var(--cf-ink); background:transparent; transition:all var(--cf-t-control) var(--cf-ease); }
  .cf-btn-outline:hover{ border-color:var(--cf-dim); background:var(--cf-card-hi); }
  .cf-btn-ghost{ color:var(--cf-dim); transition:color var(--cf-t-control) var(--cf-ease); }
  .cf-btn-ghost:hover{ color:var(--cf-ink); }
  .cf-focus:focus-visible{ outline:2px solid var(--cf-cobalt-text); outline-offset:2px; }

  .cf-input{ background:#FFFFFF; border:1px solid var(--cf-line); color:var(--cf-ink); transition:border-color var(--cf-t-control) var(--cf-ease), box-shadow var(--cf-t-control) var(--cf-ease); }
  .cf-input:focus{ outline:none; border-color:var(--cf-cobalt-text); box-shadow:0 0 0 3px rgba(95,107,57,.20); }

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

     --portal-cta is the primary button's fill and --portal-ink is its label. The two are
     declared together because which ink wins depends entirely on the hue: blue is dark
     enough to take white (4.52:1), while lime and violet are both light enough that
     near-black is the only readable choice (15.85:1 and 4.97:1). A single shared label
     colour would have forced every portal's fill toward the middle to accommodate it,
     which is how you end up with three portals that all look the same. */
  [data-portal]{ --portal-accent:var(--cf-olive); --portal-accent-deep:var(--cf-olive-lo);
    --portal-cta:#5F6B39; --portal-ink:#F7F4EE;
    --portal-glow:rgba(95,107,57,.35); --portal-ring:rgba(95,107,57,.22); }
  [data-portal="walker"]{ --portal-accent:var(--cf-cyan); --portal-accent-deep:var(--cf-cyan-lo);
    --portal-cta:#4E6B87; --portal-ink:#F7F4EE;
    --portal-glow:rgba(78,107,135,.35); --portal-ring:rgba(78,107,135,.22); }
  [data-portal="client"]{ --portal-accent:var(--cf-olive); --portal-accent-deep:var(--cf-olive-lo);
    --portal-cta:#5F6B39; --portal-ink:#F7F4EE;
    --portal-glow:rgba(95,107,57,.35); --portal-ring:rgba(95,107,57,.22); }
  [data-portal="admin"]{ --portal-accent:var(--cf-fuchsia); --portal-accent-deep:var(--cf-fuchsia-lo);
    --portal-cta:#A94A32; --portal-ink:#F7F4EE;
    --portal-glow:rgba(169,74,50,.35); --portal-ring:rgba(169,74,50,.22); }

  [data-portal] .cf-btn-primary{
    background:var(--portal-cta); color:var(--portal-ink);
    box-shadow:0 10px 30px -14px var(--portal-glow); }
  [data-portal] .cf-focus:focus-visible{ outline-color:var(--portal-accent); }
  [data-portal] .cf-input:focus{ border-color:var(--portal-accent); box-shadow:0 0 0 3px var(--portal-ring); }
  .cf-input::placeholder{ color:var(--cf-dim2); }

  .cf-chip{ background:var(--cf-olive-lo); border:1px solid rgba(95,107,57,0.28); }

  @keyframes cf-marquee{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
  .cf-marquee-track{ animation:cf-marquee 30s linear infinite; }
  @keyframes cf-flow{ to{ stroke-dashoffset:-24; } }
  .cf-flow{ stroke-dasharray:4 8; animation:cf-flow 1.4s linear infinite; }
  @keyframes cf-ping{ 0%{ transform:scale(.5); opacity:.85; } 100%{ transform:scale(2.8); opacity:0; } }
  .cf-ping{ animation:cf-ping 2.4s cubic-bezier(0,0,.2,1) infinite; transform-origin:center; }
  @keyframes cf-pulse{ 0%,100%{ opacity:1; } 50%{ opacity:.35; } }
  .cf-pulse{ animation:cf-pulse 1.8s ease-in-out infinite; }

  .cf-reveal{ opacity:0; transform:translateY(22px); transition:opacity var(--cf-t-reveal) var(--cf-ease), transform var(--cf-t-reveal) var(--cf-ease); }
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
    background:var(--cf-cobalt); transform:scaleX(0); transform-origin:left;
    transition:transform var(--cf-t-control) var(--cf-ease); }
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
    opacity:0; transition:opacity var(--cf-t-state) var(--cf-ease);
    background:radial-gradient(340px circle at var(--mx,50%) var(--my,50%),
      color-mix(in oklab, var(--cf-spot-color, var(--cf-cobalt)) 18%, transparent), transparent 62%);
  }
  .cf-spot:hover::before, .cf-spot:focus-within::before{ opacity:1; }
  .cf-spot > *{ position:relative; z-index:1; }

  /* The hairline that lights up on hover. A masked gradient border: the ::after paints a
     radial highlight and the mask punches out everything but a 1px rim. */
  .cf-spot-edge::after{
    content:''; position:absolute; inset:0; border-radius:inherit; z-index:0; pointer-events:none;
    padding:1px; opacity:0; transition:opacity var(--cf-t-state) var(--cf-ease);
    background:radial-gradient(260px circle at var(--mx,50%) var(--my,50%),
      var(--cf-spot-color, var(--cf-cobalt)), transparent 60%);
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
  /* One cell of the feature slab. No radius of its own: the grid rounds its four
     outside corners and the cells inside stay square, so the whole thing reads as a
     single panel divided by rules rather than as a tray of cards. */
  .cf-bento-cell{ background:var(--cf-card); border:1px solid var(--cf-line);
    box-shadow:var(--cf-shadow-sm); }

  .cf-bento{ position:relative; isolation:isolate; border-radius:1rem;
    background:
      linear-gradient(168deg, var(--cf-card), var(--cf-card-hi));
    border:1px solid var(--cf-line);
    border-top-color:var(--cf-line);
    box-shadow:var(--cf-shadow-sm);
    transition:transform var(--cf-t-state) var(--cf-ease), border-color var(--cf-t-state) var(--cf-ease), box-shadow var(--cf-t-state) var(--cf-ease); }
  .cf-bento:hover{ transform:translateY(-4px);
    border-color:var(--cf-line2); border-top-color:var(--cf-line2);
    box-shadow:var(--cf-shadow-md); }

  /* Conic aurora used behind hero art and feature tiles. */
  @keyframes cf-spin{ to{ transform:rotate(1turn); } }
  .cf-aurora{ position:absolute; inset:-40%; pointer-events:none; opacity:.5; filter:blur(52px);
    background:radial-gradient(60% 50% at 50% 0%, rgba(95,107,57,.14), transparent 70%);
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
    background:linear-gradient(100deg, transparent, rgba(33,30,26,.07), transparent);
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
    background:linear-gradient(90deg, var(--cf-line2), var(--cf-metal), var(--cf-line2)); }

  /* Tubelight nav indicator: a bar above the active item plus stacked blurs for the bloom. */
  .cf-lamp{ position:absolute; left:50%; transform:translateX(-50%); top:-11px; width:26px; height:3px;
    border-radius:0 0 3px 3px; background:var(--cf-metal); }
  .cf-lamp span{ position:absolute; border-radius:9999px; background:rgba(95,107,57,.22); }
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
    transition:background-color var(--cf-t-control) var(--cf-ease), color var(--cf-t-control) var(--cf-ease); }
  @media (min-width:768px){ .cf-strip-item{ font-size:0.72rem; } }
  /* No divider after the final segment — a trailing rule reads as a cell with nothing in it. */
  .cf-strip-item:last-child{ border-right:0; }
  .cf-strip-item:hover{ background:rgba(33,30,26,0.05); color:var(--cf-ink); }
  .cf-strip-item[data-active="true"]{ color:var(--cf-ink); background:rgba(33,30,26,0.06); }

  /* Role card: art bay on top, copy in the middle, action bar pinned to the floor. */
  .cf-rolecard{ position:relative; isolation:isolate; overflow:hidden; border-radius:1rem;
    background:
      linear-gradient(168deg, var(--cf-card), var(--cf-card-hi));
    border:1px solid var(--cf-line); border-top-color:var(--cf-line);
    box-shadow:var(--cf-shadow-sm);
    transition:transform var(--cf-t-state) var(--cf-ease), border-color var(--cf-t-state) var(--cf-ease), box-shadow var(--cf-t-state) var(--cf-ease); }
  .cf-rolecard:hover{ transform:translateY(-5px);
    border-color:var(--cf-line2); border-top-color:var(--cf-line2);
    box-shadow:var(--cf-shadow-md); }

  .cf-rolecard-art{ position:relative; display:block; height:10.5rem; padding:1rem 1.25rem 0;
    border-bottom:1px solid var(--cf-line); overflow:hidden; }
  /* Accent bleeds up from the floor of the bay, so colour arrives as light. */
  .cf-rolecard-glow{ position:absolute; inset:auto -20% -60% -20%; height:130%;
    background:radial-gradient(60% 100% at 50% 100%, color-mix(in oklab, var(--accent) 30%, transparent), transparent 72%);
    opacity:.22; transition:opacity var(--cf-t-state) var(--cf-ease); pointer-events:none; }
  .cf-rolecard:hover .cf-rolecard-glow{ opacity:.40; }
  .cf-rolecard-art svg{ position:relative; z-index:1; }

  .cf-rolecard-index{ position:absolute; top:.35rem; right:.85rem; z-index:2;
    font-weight:900; font-size:2.75rem; line-height:1; letter-spacing:-.02em;
    color:transparent; -webkit-text-stroke:1px rgba(33,30,26,.22); user-select:none; }
  .cf-rolecard:hover .cf-rolecard-index{ -webkit-text-stroke-color:color-mix(in oklab, var(--accent) 45%, transparent); }

  .cf-rolecard-foot{ display:flex; align-items:center; justify-content:space-between;
    padding:.85rem 1.5rem; border-top:1px solid var(--cf-line);
    background:linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 7%, transparent));
    transition:background var(--cf-t-state) var(--cf-ease); }
  .cf-rolecard:hover .cf-rolecard-foot{
    background:linear-gradient(180deg, transparent, color-mix(in oklab, var(--accent) 16%, transparent)); }

  /* Stat band. Shares the card material so it belongs to the same system, with 1px inner
     rules between cells rather than an opaque plate behind them. */
  .cf-statband{
    background:linear-gradient(168deg, var(--cf-card), var(--cf-card-hi));
    border:1px solid var(--cf-line); box-shadow:var(--cf-shadow-sm); }
  .cf-statcell{ border-right:1px solid var(--cf-line); }
  .cf-statcell:last-child{ border-right:0; }
  @media (max-width:767px){
    .cf-statcell:nth-child(2n){ border-right:0; }
    .cf-statcell:nth-child(-n+2){ border-bottom:1px solid var(--cf-line); }
  }

  /* Section divider that fades out at both ends instead of butting into the gutter. */
  .cf-rule{ height:1px; border:0;
    background:linear-gradient(90deg, transparent, var(--cf-line2), transparent); }

  /* Numeric labels that should not reflow as digits change (counters, clocks). */
  .cf-tnum{ font-variant-numeric:tabular-nums; }


  @keyframes cf-sweep{ 0%{ transform:translateX(-100%); } 100%{ transform:translateX(300%); } }
  .cf-sweep{ animation:cf-sweep 3.2s var(--cf-ease) infinite; }

  @media (prefers-reduced-motion: reduce){
      .cf-marquee-track,.cf-flow,.cf-ping,.cf-pulse{ animation:none !important; }
    .cf-reveal{ opacity:1 !important; transform:none !important; transition:none !important; }
    .cf-aurora,.cf-sweep{ animation:none !important; }
    .cf-bento:hover{ transform:none; }
  }
`;
