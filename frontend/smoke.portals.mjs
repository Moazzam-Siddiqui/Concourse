/**
 * Render smoke test for the pieces that draw live data.
 *
 *     npx vite-node smoke.portals.mjs
 *
 * Separate from smoke.render.mjs because these need a venue and a frame rather than a
 * route. They are the components carrying the new behaviour — the traffic map, the
 * walker's route panels and the operator's safety alerts — and every one of them is fed
 * from a real AI-traced graph here, not a tidy hand-written one.
 */

import { renderToString } from 'react-dom/server';
import React from 'react';
import { readFileSync } from 'node:fs';

globalThis.window = {
  location: { hash: '#/' },
  matchMedia: () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }),
  addEventListener() {}, removeEventListener() {}, scrollTo() {},
  CSS: { supports: () => true },
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById: () => null };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { VenueMap, RouteBanner, RouteSteps, HazardAlerts } = await import('./ConcourseApp.jsx');
const { toMapVenue, applyFrame } = await import('./src/venueAdapter.js');
const { planRoute, rankHazards } = await import('./src/crowdRouting.js');

const raw = JSON.parse(readFileSync(new URL('./src/__fixtures__/tracedVenue.json', import.meta.url), 'utf8'));

// A frame with a genuinely dangerous zone in it, so the critical paths render rather
// than every component quietly taking its empty branch.
const frame = {
  nodes: raw.nodes.map((n, i) => ({
    nodeId: n.id,
    density: i % 7 === 0 ? 0.93 : i % 3 === 0 ? 0.66 : 0.12,
    status: i % 7 === 0 ? 'CRITICAL' : 'OK',
    trend: i % 2 ? 'RISING' : 'FLAT',
  })),
  metrics: { peopleInside: 1840 },
  predictedRisk: {},
};

const mapVenue = applyFrame(toMapVenue(raw), frame);
const gate = raw.nodes.find((n) => n.type === 'GATE');
const route = planRoute(raw, mapVenue, gate.id, frame);
const hazards = rankHazards(mapVenue.halls, {});

const cases = [
  ['VenueMap + traffic route', () => React.createElement(VenueMap, {
    venue: mapVenue, people: [], trafficRoute: route, showDensity: true, showPeople: false,
  })],
  ['VenueMap with crowd figures', () => React.createElement(VenueMap, {
    venue: mapVenue,
    people: raw.nodes.map((n, i) => ({ id: `p${i}`, x: n.x / 12, y: n.y / 12, hot: i % 5 === 0 })),
    crowdTotal: 1840, showDensity: true, showPeople: true,
  })],
  ['RouteBanner (clear)', () => React.createElement(RouteBanner, {
    route: planRoute(raw, mapVenue, gate.id, null), venue: mapVenue,
  })],
  ['RouteBanner (congested)', () => React.createElement(RouteBanner, { route, venue: mapVenue })],
  ['RouteSteps', () => React.createElement(RouteSteps, { route, venue: mapVenue })],
  ['HazardAlerts (critical)', () => React.createElement(HazardAlerts, { hazards })],
  ['HazardAlerts (all clear)', () => React.createElement(HazardAlerts, { hazards: [] })],
  ['RouteBanner (no route)', () => React.createElement(RouteBanner, { route: null, venue: mapVenue })],
];

const problems = [];
const originalError = console.error;
console.error = (...a) => problems.push(a.join(' '));

let failed = 0;
for (const [name, make] of cases) {
  try {
    const html = renderToString(make());
    originalError(`  ok    ${name.padEnd(28)} ${html.length} chars`);
  } catch (cause) {
    failed++;
    originalError(`  FAIL  ${name.padEnd(28)} ${cause.message}`);
  }
}
console.error = originalError;

if (problems.length) {
  console.log('\nReact reported:');
  problems.slice(0, 8).forEach((p) => console.log('  ' + p.slice(0, 240)));
}

console.log(`\nroute: ${route.path.length} zones, ${route.distance}m, worst ${Math.round(route.worstDensity * 100)}%, detoured=${route.detoured}`);
console.log(`hazards: ${hazards.length}`);
console.log(failed || problems.length ? '\nPORTAL SMOKE FAILED' : '\nAll live components render clean');
process.exit(failed || problems.length ? 1 : 0);
