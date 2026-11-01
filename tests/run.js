#!/usr/bin/env node
// HUSH MONEY - headless test runner. Zero dependencies. Owner: QA.
// Usage: node tests/run.js [filter...]   (filter = substring of a test file name, e.g. "logic" or "sim")
// Loads js/data.js, logic.js, city.js, npc.js, game.js with vm.runInThisContext (missing files are
// skipped), then runs every tests/*.test.js. Exit code 0 when nothing failed (skips allowed), else 1.
// Defines nothing on `window`/`document`: any game file touching the DOM at load time fails to load.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const GAME_FILES = ['data', 'logic', 'city', 'npc', 'game'];
const PREFERRED_ORDER = ['logic.test.js', 'data.test.js', 'city.test.js', 'sim.test.js', 'static.test.js', 'touch.test.js', 'render.test.js'];

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', x: '' };

// ---------- load game files ----------
const fileStatus = {}; // name -> 'loaded' | 'missing' | 'error'
const loadErrors = {};
console.log('HUSH MONEY test runner  (root: ' + ROOT + ')');
console.log('Loading game files:');
for (const name of GAME_FILES) {
  const rel = 'js/' + name + '.js';
  const full = path.join(ROOT, 'js', name + '.js');
  if (!fs.existsSync(full)) {
    fileStatus[name] = 'missing';
    console.log('  ' + C.y + 'MISSING' + C.x + ' ' + rel + ' (file missing - dependent tests will be SKIPPED)');
    continue;
  }
  try {
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
    fileStatus[name] = 'loaded';
    console.log('  ' + C.g + 'loaded ' + C.x + ' ' + rel);
  } catch (e) {
    fileStatus[name] = 'error';
    loadErrors[name] = e;
    console.log('  ' + C.r + 'ERROR  ' + C.x + ' ' + rel + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}
const PE = globalThis.PE || {};

// ---------- assertion API ----------
class AssertionError extends Error {}
class SkipSignal extends Error {}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
  try {
    const s = JSON.stringify(v, (k, x) => (x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity'
      : ArrayBuffer.isView(x) ? Array.from(x) : x));
    return s && s.length > 300 ? s.slice(0, 300) + '...' : String(s);
  } catch (e) { return String(v); }
}

function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b; // 0 === -0
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEq(a[k], b[k])) return false;
  return true;
}

function fail(msg) { throw new AssertionError(msg); }

const has = (n) => fileStatus[String(n).replace(/^js\//, '').replace(/\.js$/, '')] === 'loaded';

function makeT(suite) {
  const t = {
    test(name, fn) { suite.tests.push({ name, fn }); },
    ok(v, msg) { if (!v) fail((msg || 'expected truthy') + ' (got ' + fmt(v) + ')'); },
    eq(a, b, msg) { if (!deepEq(a, b)) fail((msg ? msg + ': ' : '') + 'expected ' + fmt(b) + ', got ' + fmt(a)); },
    near(a, b, eps, msg) {
      if (eps == null) eps = 1e-9;
      if (typeof a !== 'number' || !isFinite(a) || Math.abs(a - b) > eps) {
        fail((msg ? msg + ': ' : '') + 'expected ' + fmt(b) + ' +-' + eps + ', got ' + fmt(a));
      }
    },
    throws(fn, msg) {
      let threw = false;
      try { fn(); } catch (e) { if (e instanceof SkipSignal) throw e; threw = true; }
      if (!threw) fail(msg || 'expected function to throw');
    },
    fail,
    // Fail with the first violations listed (for bulk data checks).
    none(violations, msg) {
      if (violations.length) {
        fail((msg || 'violations') + ' [' + violations.length + ']:\n       - ' +
          violations.slice(0, 12).join('\n       - ') + (violations.length > 12 ? '\n       ... (+' + (violations.length - 12) + ' more)' : ''));
      }
    },
    skip(reason) { throw new SkipSignal(reason || 'skipped'); },
    // Skip the current test unless all named game files loaded. e.g. t.needs('logic', 'data')
    needs(...names) {
      const bad = names.filter((n) => !has(n));
      if (bad.length) {
        const why = bad.map((n) => 'js/' + n + '.js ' + (fileStatus[n] === 'error' ? 'failed to load' : 'missing'));
        const allMissing = bad.every((n) => fileStatus[n] !== 'error');
        throw new SkipSignal(allMissing ? 'SKIPPED (file missing: ' + why.join(', ') + ')' : 'SKIPPED (' + why.join(', ') + ')');
      }
    },
    has,
    fileStatus,
    ROOT,
  };
  return t;
}

// ---------- discover & run ----------
async function main() {
  const filters = process.argv.slice(2);
  let files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js'));
  files.sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a), ib = PREFERRED_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
  });
  if (filters.length) files = files.filter((f) => filters.some((q) => f.includes(q)));

  const totals = { pass: 0, fail: 0, skip: 0 };
  const perFile = [];
  const failures = [];
  // A game file that exists but failed to load is a failure in its own right.
  for (const n of GAME_FILES) {
    if (fileStatus[n] === 'error') {
      totals.fail++;
      failures.push('[load] js/' + n + '.js: ' + (loadErrors[n] && loadErrors[n].message));
    }
  }
  const t0 = Date.now();

  for (const file of files) {
    const suite = { tests: [] };
    const t = makeT(suite);
    const counts = { file, pass: 0, fail: 0, skip: 0 };
    console.log('\n' + file);
    try {
      const mod = require(path.join(TEST_DIR, file));
      if (typeof mod !== 'function') throw new Error('test file must export a function (t, PE) => {...}');
      mod(t, PE);
    } catch (e) {
      counts.fail++; totals.fail++;
      failures.push('[' + file + '] <module>: ' + (e && e.stack || e));
      console.log('  ' + C.r + 'FAIL' + C.x + ' <module setup>: ' + (e && e.message));
      perFile.push(counts);
      continue;
    }
    for (const tc of suite.tests) {
      const ts = Date.now();
      try {
        const r = tc.fn(t, PE);
        if (r && typeof r.then === 'function') await r;
        counts.pass++; totals.pass++;
        console.log('  ' + C.g + 'PASS' + C.x + ' ' + tc.name + C.d + ' (' + (Date.now() - ts) + ' ms)' + C.x);
      } catch (e) {
        if (e instanceof SkipSignal) {
          counts.skip++; totals.skip++;
          console.log('  ' + C.y + 'SKIP' + C.x + ' ' + tc.name + ' - ' + e.message);
        } else {
          counts.fail++; totals.fail++;
          const msg = e instanceof AssertionError ? e.message : (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : String(e));
          failures.push('[' + file + '] ' + tc.name + ': ' + msg.split('\n')[0]);
          console.log('  ' + C.r + 'FAIL' + C.x + ' ' + tc.name + C.d + ' (' + (Date.now() - ts) + ' ms)' + C.x + '\n       ' + msg);
        }
      }
    }
    perFile.push(counts);
  }

  console.log('\n==================== SUMMARY ====================');
  for (const c of perFile) {
    console.log('  ' + c.file.padEnd(16) + ' pass ' + String(c.pass).padStart(3) + '  fail ' + String(c.fail).padStart(3) + '  skip ' + String(c.skip).padStart(3));
  }
  const missing = GAME_FILES.filter((n) => fileStatus[n] === 'missing');
  if (missing.length) console.log('  missing game files: ' + missing.map((n) => 'js/' + n + '.js').join(', '));
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures) console.log('   ' + C.r + 'x' + C.x + ' ' + f);
  }
  const ok = totals.fail === 0;
  console.log('\n  ' + (ok ? C.g + 'OK' : C.r + 'FAILED') + C.x + '  ' + totals.pass + ' passed, ' + totals.fail + ' failed, ' +
    totals.skip + ' skipped  (' + ((Date.now() - t0) / 1000).toFixed(2) + ' s)');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => { console.error('runner crashed:', e); process.exitCode = 1; });
