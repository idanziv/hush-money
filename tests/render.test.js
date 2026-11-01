// HUSH MONEY - main.js render-loop tests (v1.1.4 interpolation). Owner: QA.
// Boots the WHOLE game (all js files incl. main.js) in a vm with a fake DOM/canvas and a manual
// requestAnimationFrame, then drives frames at chosen refresh rates and watches where the player is drawn.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = (t) => {
  const JS = path.join(t.ROOT, 'js');
  const FILES = ['data', 'logic', 'art', 'city', 'npc', 'game', 'ui', 'sfx', 'touch', 'main'];
  const has = () => { for (const f of FILES) if (f !== 'touch' && !fs.existsSync(path.join(JS, f + '.js'))) t.skip('SKIPPED (file missing: js/' + f + '.js)'); };

  function fakeCtx() {
    const store = {};
    return new Proxy({}, {
      get(o, p) {
        if (p === Symbol.toPrimitive) return () => 0;
        if (p in store) return store[p];
        if (p === 'measureText') return (s) => ({ width: String(s).length * 7 });
        if (p === 'getImageData' || p === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(0), width: w, height: h });
        if (/^create(Linear|Radial)Gradient$|^createPattern$/.test(String(p))) return () => ({ addColorStop() {} });
        return () => {};
      },
      set(o, p, v) { store[p] = v; return true; },
    });
  }
  function canvas() { const c = { width: 0, height: 0, style: {} }, x = fakeCtx(); c.getContext = () => x; c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 }); c.addEventListener = () => {}; c.focus = () => {}; return c; }

  function boot() {
    const L = {}, add = (ty, f) => { (L[ty] = L[ty] || []).push(f); };
    const game = canvas(); game.width = 960; game.height = 540;
    let raf = null, now = 0;
    const errs = [];
    const doc = { readyState: 'complete', hidden: false, createElement: canvas, getElementById: (id) => (id === 'game' ? game : { style: {} }), querySelector: () => game, addEventListener: add, documentElement: {} };
    const sb = {
      document: doc, location: { search: '?seed=7' }, addEventListener: add, innerWidth: 1280, innerHeight: 720,
      matchMedia: () => ({ matches: false }), requestAnimationFrame: (cb) => { raf = cb; return 1; },
      performance: { now: () => now }, setTimeout, clearTimeout,
      console: { log() {}, warn() {}, error: (e) => errs.push(String((e && e.message) || e)) },
    };
    sb.window = sb;
    vm.createContext(sb);
    for (const f of FILES) { const p = path.join(JS, f + '.js'); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: p }); }
    const PE = sb.PE;
    const drawn = [];
    const orig = PE.art.drawCharacter;
    PE.art.drawCharacter = function (ctx, sx, sy, look) { if (look === 'detective') drawn.push(sx + PE.cam.x); return orig.apply(this, arguments); };
    const key = (c, down) => { for (const fn of L[down ? 'keydown' : 'keyup'] || []) fn({ code: c, key: c, repeat: false, preventDefault() {} }); };
    const frame = (ms) => { now += ms; const cb = raf; raf = null; if (!cb) throw new Error('main.js did not request a frame'); cb(now); };
    return { PE, key, frame, drawn, errs, L, doc };
  }

  // walk east from the seed-7 start (open boulevard) and return per-frame drawn movement
  function walk(pattern, frames) {
    const g = boot();
    g.frame(16.7); g.frame(16.7);
    g.key('Enter', true); g.key('Enter', false);
    for (let i = 0; i < 12; i++) g.frame(1000 / 60);
    t.eq(g.PE.main.getState(), 'playing', 'run started');
    const x0 = g.PE.game.state.player.x;
    g.key('KeyD', true);
    const from = g.drawn.length;
    let simMs = 0;
    for (let i = 0; i < frames; i++) { const ms = pattern(i); simMs += ms; g.frame(ms); }
    g.key('KeyD', false);
    const seq = g.drawn.slice(from + 4), ds = [];
    for (let i = 1; i < seq.length; i++) ds.push(seq[i] - seq[i - 1]);
    const p = g.PE.game.state.player;
    return { g, ds, stalls: ds.filter((d) => Math.abs(d) < 0.01).length, maxStep: Math.max(...ds), x0, p, simMs };
  }

  t.test('render: a walking player moves on screen every frame at 60, 90, 120 Hz and jittery 60 Hz', () => {
    has();
    let s = 5;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const cases = [['60 Hz', () => 1000 / 60, 120], ['90 Hz', () => 1000 / 90, 180], ['120 Hz', () => 1000 / 120, 240],
      ['jittery 60 Hz', () => 1000 / 60 + (rnd() - 0.5) * 7, 120], ['60->120->90 Hz', (i) => (i < 60 ? 1000 / 60 : i < 150 ? 1000 / 120 : 1000 / 90), 240]];
    for (const [name, pat, n] of cases) {
      const r = walk(pat, n);
      t.eq(r.stalls, 0, name + ': frames where the walking player is drawn in the same place');
      t.ok(r.maxStep < 4, name + ': no frame jumps more than ~1.5 sim steps (max ' + r.maxStep.toFixed(2) + ' px)');
      t.eq(r.g.errs, [], name + ': no errors');
    }
  });

  t.test('render: real positions are restored after every frame (sim untouched, steps exactly DT)', () => {
    has();
    const r = walk(() => 1000 / 120, 120);
    const p = r.p;
    t.ok(p._sx === undefined, 'no interpolation scratch left on the player');
    const steps = (p.x - r.x0) / (140 / 60);
    t.near(steps, Math.round(steps), 1e-6, 'player x is a whole number of 140/60 px sim steps from the start (got ' + steps + ' steps)');
    const leaked = r.g.PE.npc.people.filter((o) => o._sx !== undefined).length;
    t.eq(leaked, 0, 'NPCs restored to real positions');
  });

  t.test('render: paused screen does not drift (same drawn position every frame)', () => {
    has();
    const r = walk(() => 1000 / 120, 30);   // stop mid-step
    const g = r.g;
    g.key('KeyP', true); g.key('KeyP', false);
    t.eq(g.PE.main.getState(), 'paused', 'paused');
    const from = g.drawn.length;
    for (let i = 0; i < 60; i++) g.frame(1000 / 120);
    t.eq(new Set(g.drawn.slice(from)).size, 1, 'one drawn position while paused');
  });
};
