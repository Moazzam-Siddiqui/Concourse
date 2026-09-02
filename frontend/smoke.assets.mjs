/**
 * Every local asset the app references must exist on disk.
 *
 *     npm run test:assets
 *
 * This exists because a find-and-replace that renamed `.png` to `.webp` across the
 * whole file caught the map sprites as collateral, and nothing noticed. The build
 * still passed, the tests still passed, every route still rendered - a missing image
 * is not a JavaScript error. It only showed up as broken-image icons scattered across
 * the venue map.
 *
 * Static asset paths are cheap to verify and this is the check that would have caught
 * it in the second it took to run.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, 'public');

const SOURCES = ['ConcourseApp.jsx', 'src/LayoutStudio.jsx', 'index.html'];

// Absolute, root-relative paths with a file extension: "/sprites/gate.png".
const REF = /["'`](\/[A-Za-z0-9_\-./]+\.(?:png|webp|jpg|jpeg|svg|gif|json|woff2?|mp4))["'`]/g;

let checked = 0;
const missing = [];

for (const file of SOURCES) {
  const path = join(here, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(REF)) {
    const ref = m[1];
    // Vite serves /src/... from the project root, not from public/.
    if (ref.startsWith('/src/')) continue;
    checked++;
    if (!existsSync(join(PUBLIC, ref))) missing.push(`${file}  ->  ${ref}`);
  }
}

const unique = [...new Set(missing)];
console.log(`checked ${checked} asset reference(s)`);

if (unique.length) {
  console.log('\nMISSING:');
  for (const m of unique) console.log('  ' + m);
  console.log(`\n${unique.length} referenced asset(s) do not exist`);
  process.exit(1);
}

console.log('every referenced asset exists');
