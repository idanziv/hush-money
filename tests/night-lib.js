// HUSH MONEY v2 "night" - shared test helpers (not a *.test.js file). Owner: QA.
// Loads v1 logic files + night files into a FRESH vm context (never the runner's global PE),
// so night additions can never leak into the 139 v1 tests.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V1 = ['data', 'logic', 'city', 'npc', 'game'];
const NIGHT_FILES = ['night-data', 'stealth', 'night-game'];

function fakeCtx() {
  const store = {};
  return new Proxy({}, {
    get(o, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p in store) return store[p];
      if (p === 'measureText') return (s) => ({ width: String(s).length * 7 });
      if (p === 'getImageData' || p === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)), width: w, height: h });
      if (/^create(Linear|Radial|Conic)Gradient$|^createPattern$/.test(String(p))) return () => ({ addColorStop() {} });
      return () => {};
    },
    set(o, p, v) { store[p] = v; return true; },
  });
}
function fakeCanvas() { const c = { width: 0, height: 0, style: {} }, x = fakeCtx(); c.getContext = () => x; return c; }

// Load into a fresh context. opts.dom: provide a fake document (for light.js); opts.files: extra files.
function load(root, opts) {
  opts = opts || {};
  const js = path.join(root, 'js');
  const status = {};
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout };
  if (opts.dom) {
    sb.document = { createElement: fakeCanvas, getElementById: () => null, addEventListener() {} };
    sb.addEventListener = () => {};
    sb.performance = { now: () => Date.now() };
  }
  sb.window = sb;
  vm.createContext(sb);
  for (const f of V1.concat(NIGHT_FILES, opts.files || [])) {
    const p = path.join(js, f + '.js');
    if (!fs.existsSync(p)) { status[f] = 'missing'; continue; }
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: p }); status[f] = 'loaded'; } catch (e) { status[f] = 'error: ' + e.message; }
  }
  return { sb, PE: sb.PE || {}, status };
}

// First function found under any of the names (API not pinned yet in 06; pinned in M1 reports).
function pick(obj, names) {
  if (!obj) return null;
  for (const n of names) if (typeof obj[n] === 'function') return obj[n].bind(obj);
  return null;
}

// 4-neighbour BFS over !solid (oracle, same as tests/spec.js)
function bfs(grid, sx, sy, blocked) {
  const w = grid.w, h = grid.h, n = w * h, d = new Int32Array(n).fill(-1);
  const s = sy * w + sx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || grid.solid[s] || (blocked && blocked[s])) return d;
  const q = new Int32Array(n); let qh = 0, qt = 0; d[s] = 0; q[qt++] = s;
  while (qh < qt) {
    const c = q[qh++], cx = c % w;
    const nb = [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, c - w, c + w];
    for (const k of nb) if (k >= 0 && k < n && d[k] < 0 && !grid.solid[k] && !(blocked && blocked[k])) { d[k] = d[c] + 1; q[qt++] = k; }
  }
  return d;
}

// Dijkstra on tiles with per-tile extra cost (shadow-route bot). cost(i) >= 0. Returns {dist, prev}.
function dijkstra(grid, sx, sy, cost, blocked) {
  const w = grid.w, n = w * grid.h, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const s = sy * w + sx; dist[s] = 0;
  const heap = [[0, s]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [dc, c] = pop();
    if (dc > dist[c]) continue;
    const cx = c % w;
    for (const k of [cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, c - w, c + w]) {
      if (k < 0 || k >= n || grid.solid[k] || (blocked && blocked[k])) continue;
      const nd = dc + 1 + cost(k);
      if (nd < dist[k]) { dist[k] = nd; prev[k] = c; push([nd, k]); }
    }
  }
  return { dist, prev };
}

module.exports = { load, pick, bfs, dijkstra, fakeCtx, fakeCanvas, V1, NIGHT_FILES };
