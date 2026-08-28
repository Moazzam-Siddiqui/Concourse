/**
 * Crowd-aware routing and the traffic colours that go with it.
 *
 * The backend already answers "shortest way out" (`GET /venues/{id}/route`), by distance
 * over the venue's own edges. That is the right answer for an empty building and the
 * wrong one for a full one: the shortest path out of a stand very often runs through the
 * concourse that is jammed, which is exactly the route nobody should be sent down.
 *
 * So this does the congestion-aware half on the client, where the live per-zone density
 * already is — it arrives on the session socket five times a second, and asking the
 * server to re-route on every frame would be a request per tick per attendee to compute
 * something both ends already have the inputs for.
 *
 * Same graph, same Dijkstra, different edge weight:
 *
 *     cost(u -> v) = length(u,v) * congestionPenalty(density(v))
 *
 * A route is therefore never "avoid red at any cost" — a short hop through a busy zone
 * still beats a long detour, which is what a real navigation app does and what an
 * evacuating crowd should do. Only genuinely crushed zones (`IMPASSABLE_DENSITY`) are
 * treated as walls.
 */

/* -------------------------------------------------------------------------- */
/*  Traffic bands — the one place density becomes a colour                    */
/* -------------------------------------------------------------------------- */

/**
 * The traffic scale, in the terms the brief asks for: red heavy, amber/orange medium,
 * blue clear.
 *
 * Blue rather than green for "clear" on the *route* layer specifically, because green
 * is already spoken for on this map — it marks entrances, and an attendee reading a
 * green line as "this is the way in" is the one misreading worth designing out. The
 * heat layer under it keeps green for low density, where nothing else competes.
 *
 * Thresholds match `HEAT_TIERS`/`densityColor` in ConcourseApp.jsx, deliberately: a
 * segment drawn amber and a zone printed 62% have to be saying the same thing.
 */
export const TRAFFIC_BANDS = [
  {
    id: 'clear',
    max: 0.5,
    color: 'rgb(77,141,240)',
    label: 'CLEAR',
    advice: 'Free-flowing',
  },
  {
    id: 'moderate',
    max: 0.7,
    color: 'rgb(255,176,32)',
    label: 'MODERATE',
    advice: 'Busy but moving',
  },
  {
    id: 'heavy',
    max: 0.85,
    color: 'rgb(255,106,0)',
    label: 'HEAVY',
    advice: 'Slow — expect queues',
  },
  {
    id: 'severe',
    max: Infinity,
    color: 'rgb(225,6,0)',
    label: 'SEVERE',
    advice: 'Congested — avoid if you can',
  },
];

/** The band a density falls in. Never returns undefined — the last band is open-ended. */
export function trafficBand(density) {
  const d = Number.isFinite(density) ? density : 0;
  return TRAFFIC_BANDS.find((b) => d <= b.max) ?? TRAFFIC_BANDS[TRAFFIC_BANDS.length - 1];
}

/** Shorthand for the colour alone, which is most of what the map wants. */
export const trafficColor = (density) => trafficBand(density).color;

/* -------------------------------------------------------------------------- */
/*  Cost model                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Above this, a zone is not routed through at all.
 *
 * Set below 1.0 on purpose. Density is occupancy/capacity, so 1.0 is "at the number the
 * fire officer signed off", not "physically full" — by the time a zone reaches it, it is
 * already the place you would not send another person. Leaving a little headroom means
 * the router stops feeding a zone slightly before it is the worst it will get.
 */
export const IMPASSABLE_DENSITY = 0.94;

/**
 * How much a zone's crowding multiplies the cost of walking into it.
 *
 * Quartic, not linear. A linear penalty barely reorders anything — a 90%-full zone costs
 * 1.9x a empty one, so any detour longer than about double still loses, and the router
 * keeps recommending the jam. The steep curve leaves quiet zones almost untouched
 * (10% full ≈ 1.0x) while making a severe one expensive enough (85% ≈ 6.2x) that a real
 * alternative wins, without ever declaring it impossible.
 */
export function congestionPenalty(density) {
  const d = Math.max(0, Math.min(1, Number.isFinite(density) ? density : 0));
  return 1 + 9 * d ** 4;
}

/* -------------------------------------------------------------------------- */
/*  Graph + Dijkstra                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Adjacency from the raw backend venue, with live density folded in per node.
 *
 * Takes the *raw* venue (nodes/edges) rather than the map venue, because edge lengths
 * are the real metres the graph was authored in; the map venue's polygons are a
 * projection of it and their centre-to-centre pixel distance is not the same ordering.
 */
function buildGraph(rawVenue, densityByNode) {
  const adjacency = new Map();
  for (const node of rawVenue?.nodes ?? []) adjacency.set(node.id, []);

  for (const edge of rawVenue?.edges ?? []) {
    const from = edge.from ?? edge.source;
    const to = edge.to ?? edge.target;
    if (!adjacency.has(from) || !adjacency.has(to)) continue;

    // A missing length would otherwise make an edge free and pull every route through
    // it. 1 is a floor, not a guess at the real distance.
    const length = Math.max(edge.length ?? 1, 0.5);

    // A wide corridor moves a crowd better than a narrow one at the same density, so
    // width divides the cost. Clamped so a hairline edge cannot blow the cost up.
    const width = Math.max(edge.width ?? 4, 0.8);
    const weight = length / Math.min(width / 4, 1.6);

    adjacency.get(from).push({ to, weight });
    // `bidirectional: false` means one-way — respect it, or the router will happily
    // send people the wrong way up a controlled entry lane.
    if (edge.bidirectional !== false) adjacency.get(to).push({ to: from, weight });
  }

  const density = (id) => densityByNode?.get?.(id) ?? 0;
  return { adjacency, density };
}

/**
 * Congestion-aware Dijkstra from one node to the cheapest of several targets.
 *
 * A plain array scan for the next node rather than a binary heap: a venue graph is tens
 * of nodes, and at that size the heap's bookkeeping costs more than the scan it saves.
 *
 * @returns {{path: string[], distance: number, cost: number}|null}
 */
function cheapestPath(graph, fromId, targetIds, { avoidCrowds = true } = {}) {
  const targets = new Set(targetIds);
  if (!graph.adjacency.has(fromId) || !targets.size) return null;

  const cost = new Map([[fromId, 0]]);
  const distance = new Map([[fromId, 0]]);
  const previous = new Map();
  const settled = new Set();

  while (settled.size < graph.adjacency.size) {
    let current = null;
    let best = Infinity;
    for (const [id, value] of cost) {
      if (!settled.has(id) && value < best) {
        best = value;
        current = id;
      }
    }
    if (current === null) break; // everything reachable has been settled
    if (targets.has(current) && current !== fromId) break; // cheapest target reached

    settled.add(current);

    for (const edge of graph.adjacency.get(current) ?? []) {
      if (settled.has(edge.to)) continue;

      const d = graph.density(edge.to);
      // A crushed zone is a wall — unless it is the destination itself, because
      // refusing to route someone to the only exit they have is worse than routing
      // them to a busy one.
      if (avoidCrowds && d >= IMPASSABLE_DENSITY && !targets.has(edge.to)) continue;

      const penalty = avoidCrowds ? congestionPenalty(d) : 1;
      const next = best + edge.weight * penalty;
      if (next < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, next);
        distance.set(edge.to, (distance.get(current) ?? 0) + edge.weight);
        previous.set(edge.to, current);
      }
    }
  }

  // The reached target with the lowest cost.
  let goal = null;
  let goalCost = Infinity;
  for (const id of targets) {
    const value = cost.get(id);
    if (value !== undefined && value < goalCost) {
      goalCost = value;
      goal = id;
    }
  }
  if (goal === null) return null;

  const path = [goal];
  while (previous.has(path[0])) path.unshift(previous.get(path[0]));
  if (path[0] !== fromId) return null;

  return { path, distance: distance.get(goal) ?? 0, cost: goalCost };
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-node density from a live frame, as a Map. Empty map when there is no frame yet,
 * which makes every route fall back to plain shortest-path — correct for a session that
 * has not started.
 */
export function densityMap(frame) {
  return new Map((frame?.nodes ?? []).map((n) => [n.nodeId, n.density ?? 0]));
}

/**
 * The route an attendee should actually walk, plus the one they would have walked
 * without congestion, so the UI can say what the diversion bought them.
 *
 * @param rawVenue   backend venue (nodes + edges)
 * @param mapVenue   adapted venue, for projecting the path into map space
 * @param fromNodeId where the attendee is
 * @param options.toNodeId  a specific destination; defaults to every EXIT
 * @returns null when there is no route at all
 */
export function planRoute(rawVenue, mapVenue, fromNodeId, frame, options = {}) {
  if (!rawVenue || !fromNodeId) return null;

  const byId = new Map((rawVenue.nodes ?? []).map((n) => [n.id, n]));
  if (!byId.has(fromNodeId)) return null;

  const targets = options.toNodeId
    ? [options.toNodeId]
    : (rawVenue.nodes ?? []).filter((n) => n.type === 'EXIT').map((n) => n.id);
  if (!targets.length) return null;

  const density = densityMap(frame);
  const graph = buildGraph(rawVenue, density);

  const aware = cheapestPath(graph, fromNodeId, targets, { avoidCrowds: true })
    // Every route out passes through something impassable: fall back to the plain
    // shortest path rather than telling someone in a filling building that there is no
    // way out. The UI flags this case loudly.
    ?? cheapestPath(graph, fromNodeId, targets, { avoidCrowds: false });
  if (!aware) return null;

  const direct = cheapestPath(graph, fromNodeId, targets, { avoidCrowds: false });

  const centres = new Map((mapVenue?.halls ?? []).map((h) => [h.id, h.center]));

  /** One drawable segment per hop, coloured by the density of the zone entered. */
  const segments = aware.path.slice(0, -1).map((id, i) => {
    const nextId = aware.path[i + 1];
    const d = Math.max(density.get(id) ?? 0, density.get(nextId) ?? 0);
    return {
      id: `${id}->${nextId}`,
      from: centres.get(id),
      to: centres.get(nextId),
      density: d,
      band: trafficBand(d),
    };
  }).filter((s) => s.from && s.to);

  const worst = aware.path.reduce(
    (max, id) => Math.max(max, density.get(id) ?? 0),
    0,
  );

  const detoured = !!direct && direct.path.join('>') !== aware.path.join('>');

  return {
    path: aware.path,
    points: aware.path.map((id) => centres.get(id)).filter(Boolean),
    segments,
    /** Metres over the ground, not the congestion-weighted cost. */
    distance: Math.round(aware.distance),
    worstDensity: worst,
    band: trafficBand(worst),
    destination: aware.path[aware.path.length - 1],
    detoured,
    /** Extra walking the diversion costs, in metres. 0 when the direct route won. */
    detourCost: detoured && direct ? Math.max(0, Math.round(aware.distance - direct.distance)) : 0,
    /** The zone the direct route would have sent them through, when it differs. */
    avoided: detoured && direct
      ? direct.path.find((id) => !aware.path.includes(id) && (density.get(id) ?? 0) > 0.7) ?? null
      : null,
    /** True when every option was blocked and this is a shortest-path fallback. */
    noClearRoute: worst >= IMPASSABLE_DENSITY,
    /** Walking time at 1.3 m/s, the usual planning figure for a moving crowd. */
    etaSeconds: Math.round(aware.distance / 1.3),
  };
}

/**
 * Zones ranked by how much they should worry an operator, for the client-side alerting.
 *
 * Rank is deliberately not density alone. A zone at 80% and falling is a zone that is
 * resolving itself; one at 70% and rising with the model predicting worse is the one
 * that becomes an incident, and it should sort above.
 */
export function rankHazards(halls, predictedRisk = {}) {
  return (halls ?? [])
    .map((hall) => {
      const density = hall.density ?? 0;
      const risk = predictedRisk[hall.id] ?? hall.risk ?? 0;
      const rising = hall.trend === 'RISING';
      const score = density * 0.55 + risk * 0.35 + (rising ? 0.1 : 0);
      return { hall, density, risk, rising, score, band: trafficBand(density) };
    })
    .filter((h) => h.density >= 0.5 || h.risk >= 0.6)
    .sort((a, b) => b.score - a.score);
}

/**
 * The operator-facing warning for one hazardous zone.
 *
 * Severity wording escalates with what is actually happening rather than with density
 * alone, and every line names the zone and what to do — an alert that says only
 * "critical" gives an operator nothing to act on.
 */
export function hazardWarning(hazard) {
  const name = hazard.hall.name;
  const pct = Math.round(hazard.density * 100);

  if (hazard.density >= IMPASSABLE_DENSITY) {
    return {
      severity: 'CRITICAL',
      title: `${name} is at crush density`,
      body: `${pct}% of safe capacity. Crowd pressure at this level has a real risk of injury — hold arrivals at the gates feeding it and open every adjacent route now.`,
    };
  }
  if (hazard.density >= 0.85) {
    return {
      severity: 'CRITICAL',
      title: `${name} is dangerously crowded`,
      body: `${pct}% and ${hazard.rising ? 'still rising' : 'holding'}. This is the level where movement stops and pressure builds. Divert arrivals and get stewards to the area.`,
    };
  }
  if (hazard.density >= 0.7) {
    return {
      severity: 'WARNING',
      title: `${name} is filling fast`,
      body: `${pct}%${hazard.rising ? ' and rising' : ''}. Queues will start backing into the walkways feeding it. Consider diverting the next arrivals to another route.`,
    };
  }
  if (hazard.risk >= 0.6) {
    return {
      severity: 'WARNING',
      title: `${name} is predicted to congest`,
      body: `Currently ${pct}%, but the model puts congestion risk at ${Math.round(hazard.risk * 100)}%. Acting now is cheaper than clearing it later.`,
    };
  }
  return {
    severity: 'OK',
    title: `${name} is busy`,
    body: `${pct}% of capacity. Worth watching, nothing to do yet.`,
  };
}
