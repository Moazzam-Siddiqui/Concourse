import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, Trash2, Plus, Check, TriangleAlert, Loader2, MapPin, DoorOpen,
  LogOut, Footprints, UtensilsCrossed, Armchair, Link2, MousePointer2,
  Eye, EyeOff, RotateCcw, Play, ChevronDown, Wand2, Pencil,
} from "lucide-react";

/**
 * Layout Studio — human verification step between the AI parse and the simulation.
 *
 * The brief's rule: one wrong VLM interpretation must not silently ruin a simulation.
 * So nothing here auto-advances. The operator sees what the pipeline inferred, what it
 * repaired on its own, and what is still wrong, and has to press Confirm.
 *
 * Coordinates: the graph is in canvas pixels from the parse (metadata.canvas). The SVG
 * viewBox is that canvas, so node x/y map 1:1 and the uploaded plan can sit underneath
 * at the same scale with no transform maths.
 */

// This screen talks to the AI service directly from the browser rather than through the
// backend, so it needs its own base URL - and the same production default as src/api.js.
// A deployed build falling back to localhost asks each visitor's own machine to trace
// their floor plan, which fails as "Can't reach the AI service at http://localhost:8000".
const API_BASE = import.meta?.env?.VITE_AI_SERVICE_URL
  ?? (import.meta?.env?.PROD ? "https://concourse-ai-adup.onrender.com" : "http://localhost:8000");

const NODE_TYPES = ["GATE", "WALKWAY", "CONCESSION", "SEATING", "EXIT"];

const TYPE_META = {
  GATE:       { color: "var(--cf-coral)", Icon: DoorOpen,   label: "Gate" },
  EXIT:       { color: "#00C853", Icon: LogOut,          label: "Exit" },
  WALKWAY:    { color: "#4D8DF0", Icon: Footprints,      label: "Walkway" },
  CONCESSION: { color: "#FFB020", Icon: UtensilsCrossed, label: "Concession" },
  SEATING:    { color: "#9B5CFF", Icon: Armchair,        label: "Seating" },
};

const TOOLS = {
  SELECT: "select",
  ADD_NODE: "add-node",
  CONNECT: "connect",
  DELETE: "delete",
};

/* ------------------------------------------------------------------ */

export default function LayoutStudio({ onConfirmed, initialFile = null }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  /**
   * How the plan becomes a graph. The two are genuinely different jobs, not a
   * quality setting:
   *
   * - `auto`   — trace it. Fast, and approximate in a way that depends on how the
   *              plan was drawn. Tunable, and previewed before committing.
   * - `manual` — the plan is a backdrop and the operator draws the corridors. Slower
   *              per venue, always right.
   *
   * Auto-tracing an architectural drawing cannot be made reliable across every
   * drawing convention, so offering only that would mean some plans simply never
   * work. The manual path is the floor under the feature.
   */
  const [mode, setMode] = useState("auto");

  /** Mask tuning. Mirrors RoomTuning on the server; the server clamps these. */
  const [tuning, setTuning] = useState({
    room_aware: true,
    wall_run_px: 11,
    corridor_min_px: 15,
    large_room_multiple: 2.2,
  });
  const [maskPreview, setMaskPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const [venue, setVenue] = useState(null);
  const [tool, setTool] = useState(TOOLS.SELECT);
  const [selected, setSelected] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [showPlan, setShowPlan] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  const fileRef = useRef(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const canvas = result?.metadata?.canvas ?? { width: 1600, height: 1000 };

  /* ---- upload -------------------------------------------------------- */

  const acceptFile = useCallback((f) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("That file isn't an image. Upload a PNG, JPG or WEBP floor plan.");
      return;
    }
    setError("");
    setFile(f);
    setResult(null);
    setVenue(null);
    setConfirmState(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(f);
  }, []);

  // A plan dropped on another screen and handed here. Adopted rather than ignored, so
  // an operator who dropped a floor plan on the session form lands on this tab with
  // their file already loaded instead of having to find and drop it a second time.
  useEffect(() => {
    if (initialFile) acceptFile(initialFile);
  }, [initialFile, acceptFile]);

  /**
   * Ask the server which pixels it would call road, without building a graph.
   *
   * Debounced by the effect below rather than fired per keystroke: each call re-runs
   * the morphology over a 1600px image, and a slider drag would otherwise queue a
   * dozen of them and paint them out of order.
   */
  const refreshPreview = useCallback(async () => {
    if (!file || mode !== "auto" || !tuning.room_aware) { setMaskPreview(null); return; }
    setPreviewing(true);
    try {
      const body = new FormData();
      body.append("layout", file);
      body.append("wall_run_px", String(tuning.wall_run_px));
      body.append("corridor_min_px", String(tuning.corridor_min_px));
      body.append("large_room_multiple", String(tuning.large_room_multiple));

      const res = await fetch(`${API_BASE}/layout/preview`, { method: "POST", body });
      if (!res.ok) throw new Error(`Preview failed (${res.status})`);
      setMaskPreview(await res.json());
    } catch {
      // A failed preview is not worth an error banner — the parse button still works,
      // and the operator can see for themselves that no preview appeared.
      setMaskPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [file, mode, tuning]);

  useEffect(() => {
    if (!file || mode !== "auto") return undefined;
    const timer = setTimeout(refreshPreview, 350);
    return () => clearTimeout(timer);
  }, [file, mode, tuning, refreshPreview]);

  /**
   * Start from an empty graph with the plan as a backdrop.
   *
   * Shaped like a ParseResponse so the verify screen below needs no special case for
   * it — the editor, the validation panel and the confirm button all work against the
   * same object whether the nodes came from the tracer or from nobody.
   */
  const startManual = useCallback(() => {
    if (!file) return;
    const image = new Image();
    image.onload = () => {
      setResult({
        layout_id: null, // no server-side parse to re-fetch or confirm against
        venue: {
          id: `venue-manual-${Date.now().toString(36)}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          nodes: [],
          edges: [],
        },
        semantic: { zones: [], degraded: true },
        metadata: {
          confidence: 1, // drawn by a human; nothing was guessed
          vlm_used: false,
          degraded: false,
          manual: true,
          canvas: { width: image.naturalWidth, height: image.naturalHeight },
          timings_ms: {},
          issues: [],
          repairs: [],
        },
      });
      setVenue({
        id: `venue-manual-${Date.now().toString(36)}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        nodes: [],
        edges: [],
      });
      setTool(TOOLS.ADD_NODE); // the only useful tool on an empty canvas
      setSelected(null);
    };
    image.src = preview;
  }, [file, preview]);

  const parse = useCallback(async () => {
    if (!file) return;
    setParsing(true);
    setError("");
    try {
      const body = new FormData();
      body.append("layout", file);
      body.append("venue_name", file.name.replace(/\.[^.]+$/, ""));
      body.append("room_aware", String(tuning.room_aware));
      body.append("wall_run_px", String(tuning.wall_run_px));
      body.append("corridor_min_px", String(tuning.corridor_min_px));
      body.append("large_room_multiple", String(tuning.large_room_multiple));

      const res = await fetch(`${API_BASE}/layout/parse`, { method: "POST", body });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Parse failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setVenue(structuredClone(data.venue));
      setSelected(null);
    } catch (e) {
      setError(
        e.message === "Failed to fetch"
          ? `Can't reach the AI service at ${API_BASE}. Is it running on port 8000?`
          : e.message,
      );
    } finally {
      setParsing(false);
    }
  }, [file, tuning]);

  /* ---- graph editing -------------------------------------------------- */

  const nodeById = useMemo(
    () => Object.fromEntries((venue?.nodes ?? []).map((n) => [n.id, n])),
    [venue],
  );

  const degrees = useMemo(() => {
    const d = {};
    for (const e of venue?.edges ?? []) {
      d[e.from] = (d[e.from] ?? 0) + 1;
      d[e.to] = (d[e.to] ?? 0) + 1;
    }
    return d;
  }, [venue]);

  const svgPoint = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * canvas.width,
      y: ((evt.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, [canvas.width, canvas.height]);

  const mutate = useCallback((fn) => {
    setVenue((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setConfirmState(null); // any edit invalidates a previous confirmation
  }, []);

  const handleCanvasClick = useCallback((evt) => {
    if (tool !== TOOLS.ADD_NODE) return;
    const { x, y } = svgPoint(evt);
    mutate((v) => {
      let i = v.nodes.length + 1;
      let id = `manual-${i}`;
      while (v.nodes.some((n) => n.id === id)) id = `manual-${++i}`;
      v.nodes.push({
        id, name: `Node ${i}`, type: "WALKWAY", capacity: 400,
        x: Math.round(x), y: Math.round(y),
      });
    });
  }, [tool, svgPoint, mutate]);

  const handleNodeClick = useCallback((id, evt) => {
    evt.stopPropagation();
    if (tool === TOOLS.DELETE) {
      mutate((v) => {
        v.nodes = v.nodes.filter((n) => n.id !== id);
        v.edges = v.edges.filter((e) => e.from !== id && e.to !== id);
      });
      if (selected === id) setSelected(null);
      return;
    }
    if (tool === TOOLS.CONNECT) {
      if (!connectFrom) { setConnectFrom(id); return; }
      if (connectFrom === id) { setConnectFrom(null); return; }
      mutate((v) => {
        const exists = v.edges.some(
          (e) => (e.from === connectFrom && e.to === id) || (e.from === id && e.to === connectFrom),
        );
        if (exists) return;
        const a = v.nodes.find((n) => n.id === connectFrom);
        const b = v.nodes.find((n) => n.id === id);
        const px = Math.hypot(a.x - b.x, a.y - b.y);
        v.edges.push({
          from: connectFrom, to: id,
          length: Math.max(0.5, Math.round(px * 0.05 * 100) / 100),
          width: 3, bidirectional: true,
        });
      });
      setConnectFrom(null);
      return;
    }
    setSelected(id);
  }, [tool, connectFrom, mutate, selected]);

  const startDrag = useCallback((id, evt) => {
    if (tool !== TOOLS.SELECT) return;
    evt.stopPropagation();
    dragRef.current = { id };
    setSelected(id);
  }, [tool]);

  useEffect(() => {
    const move = (evt) => {
      if (!dragRef.current) return;
      const { x, y } = svgPoint(evt);
      const { id } = dragRef.current;
      setVenue((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const n = next.nodes.find((nn) => nn.id === id);
        if (n) {
          n.x = Math.max(0, Math.min(canvas.width, Math.round(x)));
          n.y = Math.max(0, Math.min(canvas.height, Math.round(y)));
        }
        return next;
      });
    };
    const up = () => {
      if (dragRef.current) setConfirmState(null);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [svgPoint, canvas.width, canvas.height]);

  const updateSelected = useCallback((patch) => {
    mutate((v) => {
      const n = v.nodes.find((nn) => nn.id === selected);
      if (n) Object.assign(n, patch);
    });
  }, [selected, mutate]);

  /* ---- confirm -------------------------------------------------------- */

  const confirm = useCallback(async () => {
    if (!venue || !result) return;
    setConfirming(true);
    try {
      // A hand-drawn graph has no cached parse to confirm against, but it still has to
      // be validated — an operator can leave a gate unable to reach an exit exactly as
      // easily as the tracer can. `/layout/validate` runs the same checks without
      // needing a layout_id.
      const url = result.layout_id
        ? `${API_BASE}/layout/${result.layout_id}/confirm`
        : `${API_BASE}/layout/validate`;
      const res = await fetch(url, {
        method: result.layout_id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue }),
      });
      if (!res.ok) throw new Error(`Confirm failed (${res.status})`);
      const data = await res.json();
      setConfirmState(data);
      setVenue(data.venue);
      if (data.ready) onConfirmed?.(data.venue);
    } catch (e) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }, [venue, result, onConfirmed]);

  const errors = (confirmState?.issues ?? result?.metadata?.issues ?? [])
    .filter((i) => i.severity === "error");
  const warnings = (confirmState?.issues ?? result?.metadata?.issues ?? [])
    .filter((i) => i.severity === "warning");

  /* ---- render --------------------------------------------------------- */

  if (!result) {
    return (
      <div className="ls-root">
        <style>{STYLE}</style>
        <div className="ls-shell ls-narrow">
          <header className="ls-head">
            <span className="ls-eyebrow">LAYOUT STUDIO</span>
            <h1>Upload a floor plan</h1>
            <p>
              Any flat 2D plan — a PDF export, a photo of a printed sheet, an architect's PNG.
              The layout is read for meaning, then measured geometrically; you check the
              result before anything is simulated on it.
            </p>
          </header>

          <div
            className={`ls-drop ${file ? "has-file" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); acceptFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          >
            {preview ? (
              <img src={preview} alt="Floor plan preview" className="ls-preview" />
            ) : (
              <>
                <Upload size={28} strokeWidth={1.6} />
                <strong>Drop a plan, or click to browse</strong>
                <span>PNG, JPG or WEBP · up to 12MB</span>
              </>
            )}
            <input
              ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
              hidden onChange={(e) => acceptFile(e.target.files?.[0])}
            />
          </div>

          {error && <p className="ls-error"><TriangleAlert size={14} /> {error}</p>}

          {file && (
            <>
              {/* Mode. Presented as a real choice rather than a fallback, because on a
                  plan the tracer reads badly, drawing it by hand is the better route
                  and an operator should not have to fail first to discover that. */}
              <div className="ls-modes">
                {[
                  ["auto", Wand2, "Trace it for me",
                    "AI reads the plan and draws the corridors. Preview it below and adjust before committing."],
                  ["manual", Pencil, "I'll draw it",
                    "Your plan becomes a backdrop and you place the corridors yourself. Slower, always accurate."],
                ].map(([id, Icon, title, blurb]) => (
                  <button
                    key={id}
                    className={`ls-mode ${mode === id ? "active" : ""}`}
                    aria-pressed={mode === id}
                    onClick={() => setMode(id)}
                  >
                    <Icon size={17} />
                    <strong>{title}</strong>
                    <span>{blurb}</span>
                  </button>
                ))}
              </div>

              {mode === "auto" && (
                <div className="ls-tune">
                  <label className="ls-check">
                    <input
                      type="checkbox"
                      checked={tuning.room_aware}
                      onChange={(e) =>
                        setTuning((t) => ({ ...t, room_aware: e.target.checked }))}
                    />
                    <span>
                      <strong>This plan has rooms</strong>
                      <em>
                        Keeps corridors out of the rooms. Turn off for an arena or an
                        open exhibition floor, where the halls are the walkable space.
                      </em>
                    </span>
                  </label>

                  {tuning.room_aware && (
                    <>
                      {[
                        ["wall_run_px", "Wall thickness", 3, 41, 2,
                          "Raise it if furniture and text are being read as walls; lower it if thin walls are being missed."],
                        ["corridor_min_px", "Narrowest corridor", 3, 61, 2,
                          "Raise it to ignore construction gaps; lower it if a real corridor disappears."],
                        ["large_room_multiple", "Walk-through size", 1.2, 8, 0.1,
                          "How much bigger than a typical room before people may walk through it rather than to it."],
                      ].map(([key, label, min, max, step, help]) => (
                        <label key={key} className="ls-slider">
                          <span className="ls-slider-top">
                            <span>{label}</span>
                            <b>{tuning[key]}</b>
                          </span>
                          <input
                            type="range" min={min} max={max} step={step}
                            value={tuning[key]}
                            onChange={(e) =>
                              setTuning((t) => ({ ...t, [key]: Number(e.target.value) }))}
                          />
                          <em>{help}</em>
                        </label>
                      ))}

                      {/* The preview is the whole point of the sliders. Without it an
                          operator is adjusting numbers against an invisible result. */}
                      <div className="ls-mask">
                        <div className="ls-mask-head">
                          <span>WHAT WILL BECOME ROAD</span>
                          {previewing && <Loader2 size={13} className="ls-spin" />}
                        </div>
                        {maskPreview ? (
                          <>
                            <img src={maskPreview.image} alt="Traced circulation preview" />
                            <p className="ls-mask-legend">
                              <i style={{ background: "rgb(90,220,120)" }} />Corridors
                              <i style={{ background: "rgb(140,190,225)" }} />Walk-through halls
                              <i style={{ background: "rgb(205,205,205)" }} />Destinations
                            </p>
                            <p className="ls-hint">
                              {maskPreview.rooms} rooms · {maskPreview.traversable} walk-through ·{" "}
                              {(maskPreview.circulation_ratio * 100).toFixed(1)}% of the plan is corridor.
                              {" "}Green should follow the corridors you can see. If it covers a
                              room, or misses the main hallway, adjust the sliders — or draw it
                              by hand instead.
                            </p>
                          </>
                        ) : (
                          <p className="ls-hint">
                            {previewing ? "Reading the plan…" : "Preview unavailable."}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div className="ls-row">
            {mode === "auto" ? (
              <button className="ls-btn primary" onClick={parse} disabled={!file || parsing}>
                {parsing ? <><Loader2 size={15} className="ls-spin" /> Reading the plan…</> : "Trace layout"}
              </button>
            ) : (
              <button className="ls-btn primary" onClick={startManual} disabled={!file}>
                <Pencil size={15} /> Start drawing
              </button>
            )}
            {file && !parsing && (
              <button className="ls-btn ghost" onClick={() => {
                setFile(null); setPreview(null); setMaskPreview(null);
              }}>
                Clear
              </button>
            )}
          </div>

          {parsing && (
            <p className="ls-hint">
              First run loads the vision model, which can take a minute. It's unloaded again
              before the geometry stage so the rest runs on CPU.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ls-root">
      <style>{STYLE}</style>
      <div className="ls-shell">
        <header className="ls-head ls-head-row">
          <div>
            <span className="ls-eyebrow">LAYOUT STUDIO · VERIFY</span>
            <h1>{venue?.name}</h1>
            <p className="ls-sub">
              {venue?.nodes.length} nodes · {venue?.edges.length} edges ·
              confidence {Math.round((result.metadata.confidence ?? 0) * 100)}%
              {result.metadata.vlm_used
                ? ` · ${result.metadata.vlm_model?.split("/").pop()}`
                : " · CV-only (no vision model)"}
            </p>
          </div>
          <button className="ls-btn ghost" onClick={() => { setResult(null); setVenue(null); }}>
            <RotateCcw size={14} /> New plan
          </button>
        </header>

        {/* Not a warning. Running without the vision model is a supported mode — the
            geometry is measured the same way either way, and the VLM only ever
            contributed names and hints. Styling this as a failure sent operators
            looking for a broken install when nothing was broken; what actually needs
            saying is the one concrete consequence: the gates and exits were guessed
            from position, so they are the thing to check. */}
        {result.metadata.degraded && (
          <div className="ls-banner info">
            <MapPin size={15} />
            <span>
              Traced from the drawing's geometry. Zones aren't named, and the entrance
              and exit were inferred from where they sit on the plan — confirm those two
              are right before you simulate.
            </span>
          </div>
        )}

        <div className="ls-grid">
          {/* ---- map ---- */}
          <div className="ls-map-wrap">
            <div className="ls-toolbar">
              {[
                [TOOLS.SELECT, MousePointer2, "Select & move"],
                [TOOLS.ADD_NODE, Plus, "Add node"],
                [TOOLS.CONNECT, Link2, "Connect"],
                [TOOLS.DELETE, Trash2, "Delete"],
              ].map(([id, Icon, label]) => (
                <button
                  key={id} title={label} aria-label={label} aria-pressed={tool === id}
                  className={`ls-tool ${tool === id ? "active" : ""}`}
                  onClick={() => { setTool(id); setConnectFrom(null); }}
                >
                  <Icon size={15} />
                </button>
              ))}
              <span className="ls-tool-sep" />
              <button
                className={`ls-tool ${showPlan ? "active" : ""}`}
                onClick={() => setShowPlan((v) => !v)}
                title={showPlan ? "Hide the uploaded plan" : "Show the uploaded plan"}
                aria-label="Toggle plan underlay"
              >
                {showPlan ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              {tool === TOOLS.CONNECT && (
                <span className="ls-tool-hint">
                  {connectFrom ? "Click the second node" : "Click the first node"}
                </span>
              )}
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 ${canvas.width} ${canvas.height}`}
              className={`ls-map tool-${tool}`}
              onClick={handleCanvasClick}
              role="img"
              aria-label="Extracted venue graph over the uploaded floor plan"
            >
              <rect width={canvas.width} height={canvas.height} fill="#070B12" />
              {showPlan && preview && (
                <image
                  href={preview} x="0" y="0" width={canvas.width} height={canvas.height}
                  preserveAspectRatio="xMidYMid slice" opacity="0.28"
                />
              )}

              {/* edges: casing then core, so they read as corridors not hairlines */}
              {venue?.edges.map((e, i) => {
                const a = nodeById[e.from], b = nodeById[e.to];
                if (!a || !b) return null;
                return (
                  <g key={`${e.from}-${e.to}-${i}`}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke="#0A2A5E" strokeWidth={Math.max(6, e.width * 2.2)} strokeLinecap="round" />
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke="#4D8DF0" strokeWidth={Math.max(2.5, e.width)} strokeLinecap="round" opacity="0.9" />
                  </g>
                );
              })}

              {/* nodes */}
              {venue?.nodes.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.WALKWAY;
                const isSel = selected === n.id;
                const isFrom = connectFrom === n.id;
                const orphan = !degrees[n.id];
                const r = n.type === "GATE" || n.type === "EXIT" ? 15 : 11;
                return (
                  <g
                    key={n.id}
                    onPointerDown={(e) => startDrag(n.id, e)}
                    onClick={(e) => handleNodeClick(n.id, e)}
                    style={{ cursor: tool === TOOLS.SELECT ? "grab" : "pointer" }}
                  >
                    {(isSel || isFrom) && (
                      <circle cx={n.x} cy={n.y} r={r + 9} fill="none"
                        stroke={isFrom ? "var(--cf-attention)" : "var(--cf-ink)"} strokeWidth="2.5" opacity="0.85" />
                    )}
                    {orphan && (
                      <circle cx={n.x} cy={n.y} r={r + 5} fill="none"
                        stroke="var(--cf-coral)" strokeWidth="2" strokeDasharray="5 4" />
                    )}
                    <circle cx={n.x} cy={n.y} r={r} fill={meta.color}
                      stroke="var(--cf-bg)" strokeWidth="3" />
                    <text x={n.x} y={n.y - r - 8} textAnchor="middle"
                      fill="rgba(238,242,248,0.85)" style={{ fontSize: 17, fontWeight: 600, pointerEvents: "none" }}>
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* ---- side panel ---- */}
          <aside className="ls-side">
            {(errors.length > 0 || warnings.length > 0) && (
              <section className="ls-card">
                <h3>Checks</h3>
                {errors.map((i) => (
                  <div key={i.code} className="ls-issue error">
                    <TriangleAlert size={14} />
                    <div><strong>{i.code.replace(/_/g, " ")}</strong><p>{i.message}</p></div>
                  </div>
                ))}
                {warnings.map((i) => (
                  <div key={i.code} className="ls-issue warn">
                    <TriangleAlert size={14} />
                    <div><strong>{i.code.replace(/_/g, " ")}</strong><p>{i.message}</p></div>
                  </div>
                ))}
              </section>
            )}

            {result.metadata.repairs?.length > 0 && (
              <Collapsible title={`Pipeline changed ${result.metadata.repairs.length} thing(s)`}>
                <ul className="ls-list">
                  {result.metadata.repairs.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Collapsible>
            )}

            <section className="ls-card">
              <h3>{selected ? "Selected node" : "Nodes"}</h3>
              {selected && nodeById[selected] ? (
                <div className="ls-fields">
                  <label>
                    <span>Name</span>
                    <input
                      value={nodeById[selected].name}
                      onChange={(e) => updateSelected({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Type</span>
                    <select
                      value={nodeById[selected].type}
                      onChange={(e) => updateSelected({ type: e.target.value })}
                    >
                      {NODE_TYPES.map((t) => (
                        <option key={t} value={t}>{TYPE_META[t].label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Capacity</span>
                    <input
                      type="number" min="1" value={nodeById[selected].capacity}
                      onChange={(e) => updateSelected({ capacity: Math.max(1, +e.target.value || 1) })}
                    />
                  </label>
                  <p className="ls-meta">
                    {Math.round(nodeById[selected].x)}, {Math.round(nodeById[selected].y)} ·
                    {" "}{degrees[selected] ?? 0} connection(s)
                  </p>
                  <button className="ls-btn ghost sm" onClick={() => setSelected(null)}>Deselect</button>
                </div>
              ) : (
                <>
                  <p className="ls-muted">Click a node to rename or retype it.</p>
                  <div className="ls-legend">
                    {NODE_TYPES.map((t) => {
                      const { color, Icon, label } = TYPE_META[t];
                      const count = venue?.nodes.filter((n) => n.type === t).length ?? 0;
                      return (
                        <div key={t} className="ls-legend-row">
                          <span className="ls-dot" style={{ background: color }} />
                          <Icon size={13} />
                          <span>{label}</span>
                          <strong>{count}</strong>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            <section className="ls-card">
              <button
                className="ls-btn primary full"
                onClick={confirm}
                disabled={confirming || !venue?.nodes.length}
              >
                {confirming
                  ? <><Loader2 size={15} className="ls-spin" /> Validating…</>
                  : <><Check size={15} /> Confirm map</>}
              </button>

              {confirmState && (
                confirmState.ready ? (
                  <div className="ls-ok">
                    <Check size={14} />
                    <span>Validated. This graph is ready for the simulation.</span>
                  </div>
                ) : (
                  <div className="ls-issue error mt">
                    <TriangleAlert size={14} />
                    <div><p>Errors remain — fix them above, then confirm again.</p></div>
                  </div>
                )
              )}

              <button
                className="ls-btn full mt"
                disabled={!confirmState?.ready}
                onClick={() => onConfirmed?.(venue)}
                title={confirmState?.ready ? "" : "Confirm the map first"}
              >
                <Play size={14} /> Start simulation
              </button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Collapsible({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ls-card">
      <button className="ls-collapse" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      <div style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows .3s cubic-bezier(0.16,1,0.3,1)",
      }}>
        <div style={{ overflow: "hidden" }}>{children}</div>
      </div>
    </section>
  );
}

const STYLE = `
.ls-root{--bg:var(--cf-bg);--panel:var(--cf-panel);--card:var(--cf-card);
  --line:var(--cf-line);--line2:var(--cf-line2);
  --ink:var(--cf-ink);--dim:var(--cf-dim);--dim2:var(--cf-dim2);
  --red:var(--cf-coral);--orange:var(--cf-attention);
  --amber:var(--cf-attention);--green:var(--cf-way-out);--blue:var(--cf-flow);
  background:var(--bg);color:var(--ink);min-height:100vh;
  font-family:Karla,system-ui,sans-serif;padding:2rem 1.5rem;}
.ls-shell{max-width:1400px;margin:0 auto;}
.ls-narrow{max-width:640px;}
.ls-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.16em;color:var(--dim2);}
.ls-head h1{font-family:'Big Shoulders Display',sans-serif;font-weight:800;text-transform:uppercase;
  font-size:2.2rem;letter-spacing:-.01em;margin:.35rem 0 .5rem;}
.ls-head p{color:var(--dim);line-height:1.6;font-size:.92rem;max-width:56ch;}
.ls-head-row{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1.25rem;}
.ls-sub{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--dim2);}
.ls-drop{margin:1.5rem 0 1rem;border:2px dashed var(--line2);border-radius:16px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;
  padding:3.5rem 1.5rem;cursor:pointer;color:var(--dim);transition:border-color .2s,background .2s;}
.ls-drop:hover,.ls-drop:focus-visible{border-color:var(--orange);background:rgba(255,106,0,.05);outline:none;}
.ls-drop strong{color:var(--ink);font-size:.95rem;}
.ls-drop span{font-size:.78rem;color:var(--dim2);}
.ls-drop.has-file{padding:1rem;}
.ls-preview{max-height:300px;width:100%;object-fit:contain;border-radius:10px;}
.ls-row{display:flex;gap:.6rem;}
.ls-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  border-radius:11px;padding:.8rem 1.3rem;font-family:'Big Shoulders Display',sans-serif;
  font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:.9rem;
  border:1px solid var(--line2);background:var(--card);color:var(--ink);cursor:pointer;
  transition:filter .2s,transform .15s,border-color .2s;}
.ls-btn:hover:not(:disabled){border-color:var(--dim);transform:translateY(-1px);}
.ls-btn:disabled{opacity:.45;cursor:not-allowed;}
.ls-btn.primary{background:linear-gradient(100deg,var(--red),var(--orange));border-color:transparent;color:#fff;}
.ls-btn.primary:hover:not(:disabled){filter:brightness(1.1);}
.ls-btn.ghost{background:transparent;}
.ls-btn.full{width:100%;}
.ls-btn.sm{padding:.5rem .9rem;font-size:.8rem;}
.ls-btn.mt{margin-top:.6rem;}
.ls-error{display:flex;align-items:center;gap:.5rem;color:var(--red);font-size:.85rem;margin:.5rem 0;}
.ls-hint{color:var(--dim2);font-size:.8rem;margin-top:.8rem;line-height:1.5;}
/* ---- mode chooser + mask tuning ---------------------------------------- */
.ls-modes{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:1.1rem 0;}
@media(max-width:560px){.ls-modes{grid-template-columns:1fr;}}
.ls-mode{display:flex;flex-direction:column;align-items:flex-start;gap:.35rem;
  padding:.95rem 1rem;border-radius:14px;text-align:left;cursor:pointer;
  background:var(--card);border:1px solid var(--line);color:var(--ink);
  transition:border-color .18s ease,transform .18s ease,background .18s ease;}
.ls-mode:hover{transform:translateY(-1px);border-color:var(--line2);}
.ls-mode.active{border-color:var(--orange);background:rgba(255,106,0,.07);}
.ls-mode strong{font-size:.9rem;font-weight:650;}
.ls-mode span{font-size:.78rem;color:var(--dim);line-height:1.45;}
.ls-mode.active svg{color:var(--orange);}

.ls-tune{background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:1rem 1.1rem;display:flex;flex-direction:column;gap:1rem;}
.ls-check{display:flex;gap:.6rem;align-items:flex-start;cursor:pointer;}
.ls-check input{margin-top:.2rem;accent-color:var(--orange);width:15px;height:15px;flex:none;}
.ls-check strong{display:block;font-size:.85rem;font-weight:600;}
.ls-check em{display:block;font-style:normal;font-size:.76rem;color:var(--dim2);
  line-height:1.45;margin-top:.15rem;}
.ls-slider{display:flex;flex-direction:column;gap:.3rem;}
.ls-slider-top{display:flex;justify-content:space-between;align-items:baseline;
  font-size:.8rem;color:var(--dim);}
.ls-slider-top b{font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--orange);}
.ls-slider input[type=range]{width:100%;accent-color:var(--orange);}
.ls-slider em{font-style:normal;font-size:.73rem;color:var(--dim2);line-height:1.4;}

.ls-mask{border-top:1px solid var(--line);padding-top:.9rem;}
.ls-mask-head{display:flex;align-items:center;justify-content:space-between;
  font-size:.68rem;letter-spacing:.14em;color:var(--dim2);margin-bottom:.55rem;}
.ls-mask img{display:block;width:100%;height:auto;border-radius:10px;
  border:1px solid var(--line);background:#fff;}
.ls-mask-legend{display:flex;flex-wrap:wrap;gap:.4rem 1rem;align-items:center;
  font-size:.72rem;color:var(--dim2);margin-top:.55rem;}
.ls-mask-legend i{display:inline-block;width:11px;height:11px;border-radius:3px;
  margin-right:.3rem;vertical-align:-1px;}

.ls-banner{display:flex;gap:.7rem;align-items:flex-start;padding:.9rem 1.1rem;border-radius:12px;
  font-size:.85rem;line-height:1.55;margin-bottom:1.25rem;}
.ls-banner.warn{background:rgba(255,176,32,.09);border:1px solid rgba(255,176,32,.32);color:var(--amber);}
.ls-banner.info{background:rgba(77,141,240,.09);border:1px solid rgba(77,141,240,.30);color:var(--blue);}
.ls-grid{display:grid;grid-template-columns:1fr 20rem;gap:1.25rem;align-items:start;}
@media(max-width:1040px){.ls-grid{grid-template-columns:1fr;}}
.ls-map-wrap{position:relative;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#070B12;}
.ls-map{display:block;width:100%;height:auto;touch-action:none;}
.ls-map.tool-add-node{cursor:crosshair;}
.ls-map.tool-delete{cursor:not-allowed;}
.ls-toolbar{position:absolute;top:.75rem;left:.75rem;z-index:2;display:flex;gap:.3rem;align-items:center;
  background:rgba(11,16,24,.92);border:1px solid var(--line);border-radius:11px;padding:.3rem;
  backdrop-filter:blur(8px);}
.ls-tool{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;border:none;
  background:transparent;color:var(--dim);cursor:pointer;transition:background .15s,color .15s;}
.ls-tool:hover{background:var(--card);color:var(--ink);}
.ls-tool.active{background:rgba(255,106,0,.16);color:var(--orange);}
.ls-tool-sep{width:1px;height:20px;background:var(--line);margin:0 .2rem;}
.ls-tool-hint{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--orange);padding:0 .5rem;}
.ls-side{display:flex;flex-direction:column;gap:.9rem;}
.ls-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.1rem;}
.ls-card h3{font-family:'Big Shoulders Display',sans-serif;font-weight:700;text-transform:uppercase;
  font-size:.85rem;letter-spacing:.06em;margin:0 0 .8rem;}
.ls-muted{color:var(--dim);font-size:.82rem;line-height:1.5;margin:0 0 .8rem;}
.ls-legend{display:flex;flex-direction:column;gap:.45rem;}
.ls-legend-row{display:flex;align-items:center;gap:.5rem;font-size:.82rem;color:var(--dim);}
.ls-legend-row strong{margin-left:auto;font-family:'JetBrains Mono',monospace;color:var(--ink);font-size:.78rem;}
.ls-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.ls-fields{display:flex;flex-direction:column;gap:.7rem;}
.ls-fields label{display:flex;flex-direction:column;gap:.3rem;}
.ls-fields label span{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;color:var(--dim2);}
.ls-fields input,.ls-fields select{background:rgba(5,7,11,.6);border:1px solid var(--line);
  border-radius:9px;padding:.55rem .7rem;color:var(--ink);font-size:.85rem;font-family:inherit;}
.ls-fields input:focus,.ls-fields select:focus{outline:none;border-color:var(--orange);
  box-shadow:0 0 0 3px rgba(255,106,0,.14);}
.ls-meta{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--dim2);margin:.2rem 0;}
.ls-issue{display:flex;gap:.6rem;align-items:flex-start;padding:.7rem .8rem;border-radius:10px;
  font-size:.8rem;line-height:1.5;margin-bottom:.5rem;}
.ls-issue.mt{margin-top:.6rem;}
.ls-issue strong{display:block;text-transform:uppercase;font-size:.7rem;letter-spacing:.06em;margin-bottom:.15rem;}
.ls-issue p{margin:0;color:var(--dim);}
.ls-issue.error{background:rgba(169,74,50,.10);border:1px solid rgba(169,74,50,.34);color:var(--red);}
.ls-issue.warn{background:rgba(255,176,32,.08);border:1px solid rgba(255,176,32,.28);color:var(--amber);}
.ls-ok{display:flex;gap:.5rem;align-items:center;margin-top:.7rem;padding:.6rem .8rem;border-radius:10px;
  background:rgba(0,200,83,.1);border:1px solid rgba(0,200,83,.3);color:var(--green);
  font-size:.8rem;line-height:1.45;}
.ls-collapse{display:flex;width:100%;justify-content:space-between;align-items:center;gap:.6rem;
  background:none;border:none;color:var(--dim);cursor:pointer;font-size:.82rem;padding:0;
  font-family:inherit;text-align:left;}
.ls-collapse svg{transition:transform .3s;flex-shrink:0;}
.ls-list{margin:.8rem 0 0;padding-left:1.1rem;color:var(--dim);font-size:.78rem;line-height:1.6;}
.ls-list li{margin-bottom:.4rem;}
.ls-spin{animation:ls-spin 1s linear infinite;}
@keyframes ls-spin{to{transform:rotate(360deg);}}
@media(prefers-reduced-motion:reduce){.ls-spin{animation:none;}.ls-btn:hover{transform:none;}}
`;
