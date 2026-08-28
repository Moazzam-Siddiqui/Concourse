/**
 * Render smoke test — proves every route mounts without throwing.
 *
 *     npx vite-node smoke.render.mjs
 *
 * A production build only proves the module graph resolves. It cannot catch a component
 * that is `undefined` at the call site, a hook order violation, or a crash inside
 * render — all of which are blank-screen bugs in the browser. Rendering each route
 * through react-dom/server does catch them, without needing a browser or a driver.
 *
 * The map/portal routes are deliberately not rendered here: they mount `useConcourse`,
 * which opens a WebSocket, so they need a live backend and belong in an integration
 * test rather than a smoke test.
 */

import { renderToString } from 'react-dom/server';
import React from 'react';

/* --- the minimum DOM the app touches during a server render --------------- */
const listeners = new Set();
globalThis.window = {
  location: { hash: '#/' },
  matchMedia: () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }),
  addEventListener: (_, fn) => listeners.add(fn),
  removeEventListener: (_, fn) => listeners.delete(fn),
  scrollTo() {},
  CSS: { supports: () => true },
};
globalThis.document = {
  hidden: false,
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
};
globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
};
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};

const { default: ConcourseApp } = await import('./ConcourseApp.jsx');

const ROUTES = [
  '#/', '#/how', '#/platform', '#/intelligence', '#/results', '#/access',
  '#/login/walker', '#/login/client', '#/login/admin',
];

const problems = [];
const originalError = console.error;
console.error = (...args) => { problems.push(args.join(' ')); };

let failed = 0;
for (const route of ROUTES) {
  window.location.hash = route;
  try {
    const html = renderToString(React.createElement(ConcourseApp));
    if (!html || html.length < 200) throw new Error('rendered almost nothing');
    originalError(`  ok    ${route.padEnd(18)} ${html.length} chars`);
  } catch (cause) {
    failed++;
    originalError(`  FAIL  ${route.padEnd(18)} ${cause.message}`);
  }
}

console.error = originalError;

// React logs real problems (bad element type, hook misuse) through console.error, so a
// clean render that logged an error is still a failure worth surfacing.
const real = problems.filter((p) => !/useLayoutEffect|hydrat/i.test(p));
if (real.length) {
  console.log('\nReact reported:');
  real.slice(0, 10).forEach((p) => console.log('  ' + p.slice(0, 240)));
}

console.log(failed || real.length ? '\nSMOKE FAILED' : '\nAll routes render clean');
process.exit(failed || real.length ? 1 : 0);
