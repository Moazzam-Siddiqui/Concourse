/**
 * Tests for the crowd-aware router and the venue-code check-in.
 *
 *     npm test
 *
 * Node's own runner, no framework: these are pure functions over plain objects, and the
 * one fixture is real — `__fixtures__/tracedVenue.json` is the graph the AI layout
 * pipeline actually produced from a floor plan PNG, not a hand-written stand-in. That is
 * the case worth pinning, because a traced graph has 36 junction nodes and dead ends
 * where an authored one has ten tidy zones.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  planRoute, trafficBand, congestionPenalty, rankHazards, hazardWarning,
} from './crowdRouting.js';
import { toMapVenue } from './venueAdapter.js';
import {
  normaliseCode, codeError, suggestCode, resolveSessionForCode,
} from './venueCode.js';

const traced = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/tracedVenue.json', import.meta.url)), 'utf8'),
);

/**
 * Two ways from A to Z: a short one through `jam`, a longer one through `quiet`.
 * Every routing decision worth testing is visible in this one shape.
 */
const diamond = {
  id: 'diamond',
  nodes: [
    { id: 'A', name: 'Start', type: 'GATE', capacity: 100, x: 0, y: 0 },
    { id: 'jam', name: 'Jam', type: 'WALKWAY', capacity: 100, x: 50, y: -50 },
    { id: 'quiet', name: 'Quiet', type: 'WALKWAY', capacity: 100, x: 50, y: 50 },
    { id: 'Z', name: 'Exit', type: 'EXIT', capacity: 100, x: 100, y: 0 },
  ],
  edges: [
    { from: 'A', to: 'jam', length: 10, width: 4, bidirectional: true },
    { from: 'jam', to: 'Z', length: 10, width: 4, bidirectional: true },
    { from: 'A', to: 'quiet', length: 16, width: 4, bidirectional: true },
    { from: 'quiet', to: 'Z', length: 16, width: 4, bidirectional: true },
  ],
};

const frameOf = (densities) => ({
  nodes: Object.entries(densities).map(([nodeId, density]) => ({ nodeId, density })),
});

test('routes a real AI-traced floor plan from its gate to an exit', () => {
  const map = toMapVenue(traced);
  const gate = traced.nodes.find((n) => n.type === 'GATE');

  const route = planRoute(traced, map, gate.id, null);

  assert.ok(route, 'a traced graph must be routable');
  assert.equal(route.path[0], gate.id);
  assert.equal(traced.nodes.find((n) => n.id === route.destination).type, 'EXIT');
  assert.equal(route.segments.length, route.path.length - 1);
  assert.ok(route.segments.every((s) => s.from && s.to), 'every hop must be drawable');
  assert.ok(route.distance > 0);
});

test('takes the short way when nothing is crowded', () => {
  const route = planRoute(diamond, toMapVenue(diamond), 'A', null);
  assert.ok(route.path.includes('jam'));
  assert.equal(route.detoured, false);
});

test('diverts around a jammed zone and says what that cost', () => {
  const route = planRoute(diamond, toMapVenue(diamond), 'A',
    frameOf({ jam: 0.9, quiet: 0.05 }));

  assert.ok(route.path.includes('quiet'), 'should route via the clear zone');
  assert.ok(!route.path.includes('jam'), 'should not route through the jam');
  assert.equal(route.detoured, true);
  assert.equal(route.avoided, 'jam');
  assert.equal(route.detourCost, 12); // 32m around vs 20m through
});

test('a mildly busy short route still beats a long detour', () => {
  // The failure this pins: a penalty steep enough to divert at 0.9 must not be so steep
  // that it also diverts at 0.45, or every attendee gets sent the long way round all day.
  const route = planRoute(diamond, toMapVenue(diamond), 'A',
    frameOf({ jam: 0.45, quiet: 0 }));
  assert.ok(route.path.includes('jam'));
});

test('never strands anyone when every route is blocked', () => {
  const route = planRoute(diamond, toMapVenue(diamond), 'A',
    frameOf({ jam: 0.99, quiet: 0.99 }));

  assert.ok(route, 'must still return a way out');
  assert.ok(route.path.length > 1);
  assert.equal(route.noClearRoute, true, 'and must admit none of it is clear');
});

test('routes to a chosen destination rather than the nearest exit', () => {
  const route = planRoute(diamond, toMapVenue(diamond), 'A', null, { toNodeId: 'quiet' });
  assert.equal(route.destination, 'quiet');
});

test('traffic bands map density to the documented colours', () => {
  assert.equal(trafficBand(0.2).label, 'CLEAR');
  assert.equal(trafficBand(0.2).color, 'rgb(127,160,192)'); // dusty blue
  assert.equal(trafficBand(0.6).label, 'MODERATE');
  assert.equal(trafficBand(0.6).color, 'rgb(208,149,47)');  // ochre
  assert.equal(trafficBand(0.8).label, 'HEAVY');
  assert.equal(trafficBand(0.8).color, 'rgb(200,107,78)');  // terracotta
  assert.equal(trafficBand(0.95).label, 'SEVERE');
  assert.equal(trafficBand(0.95).color, 'rgb(163,42,28)');   // deep terracotta
});

test('congestion penalty is 1 when empty and rises with density', () => {
  assert.equal(congestionPenalty(0), 1);
  assert.ok(congestionPenalty(0.9) > congestionPenalty(0.5));
  assert.ok(congestionPenalty(0.5) > congestionPenalty(0.1));
});

test('hazard ranking surfaces the dangerous zone and ignores quiet ones', () => {
  const ranked = rankHazards([
    { id: 'c', name: 'Crush Corner', density: 0.96, trend: 'RISING' },
    { id: 'b', name: 'Busy Bar', density: 0.72, trend: 'FALLING' },
    { id: 'q', name: 'Quiet Hall', density: 0.1, trend: 'FLAT' },
  ], {});

  assert.equal(ranked[0].hall.id, 'c');
  assert.ok(!ranked.some((h) => h.hall.id === 'q'), 'a quiet zone is not a hazard');
});

test('a rising zone outranks a busier falling one', () => {
  const ranked = rankHazards([
    { id: 'falling', name: 'Falling', density: 0.78, trend: 'FALLING' },
    { id: 'rising', name: 'Rising', density: 0.76, trend: 'RISING' },
  ], { rising: 0.9 });

  assert.equal(ranked[0].hall.id, 'rising');
});

test('warnings name the zone and say what to do', () => {
  const [worst] = rankHazards(
    [{ id: 'c', name: 'North Concourse', density: 0.96, trend: 'RISING' }], {});
  const warning = hazardWarning(worst);

  assert.equal(warning.severity, 'CRITICAL');
  assert.match(warning.title, /North Concourse/);
  assert.match(warning.body, /hold arrivals|divert/i);
});

test('venue codes normalise whatever an attendee types', () => {
  assert.equal(normaliseCode('wembley-01'), 'WEMBLEY-01');
  assert.equal(normaliseCode('wembley 01'), 'WEMBLEY-01');
  assert.equal(normaliseCode('  wembley_01  '), 'WEMBLEY-01');
  assert.equal(normaliseCode('we@mb!ley#01'), 'WEMBLEY01');
});

test('venue codes reject what cannot go on a sign', () => {
  assert.ok(codeError(''));
  assert.ok(codeError('AB'), 'two characters is too short to be unambiguous');
  assert.ok(codeError('X'.repeat(30)));
  assert.equal(codeError('WEMBLEY-01'), null);
});

test('suggests a short code from a venue name', () => {
  assert.equal(suggestCode('Northgate Arena — North Wing'), 'NORTHGATE-ARENA');
  assert.equal(suggestCode(''), 'VENUE-01');
});

test('a code resolves to the live session, not a stopped one', () => {
  const sessions = [
    { sessionId: 'sess-old', venueId: 'WEMBLEY-01', status: 'STOPPED' },
    { sessionId: 'sess-live', venueId: 'WEMBLEY-01', status: 'RUNNING' },
    { sessionId: 'sess-other', venueId: 'OVAL-02', status: 'RUNNING' },
  ];

  assert.equal(resolveSessionForCode(sessions, 'wembley-01').sessionId, 'sess-live');
  assert.equal(resolveSessionForCode(sessions, 'NOPE-99'), null);
  // An operator reading a session id off the admin console must still get in.
  assert.equal(resolveSessionForCode(sessions, 'sess-other').sessionId, 'sess-other');
});
