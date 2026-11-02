// HUSH MONEY v1.2 - speech option (all / marks / off), persistence, OPTIONS menu, ship set. Owner: QA.
// Boots the shipped v1 file set (exactly what index.html loads) in a vm with a fake DOM + manual rAF.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('./spec.js');

module.exports = (t) => {
  const ROOT = t.ROOT, JS = path.join(ROOT, 'js');
  const SHIP = ['data', 'logic', 'art', 'city', 'npc', 'game', 'ui', 'sfx', 'touch', 'main'];
  const has = () => { for (const f of SHIP) if (!fs.existsSync(path.join(JS, f + '.js'))) t.skip('SKIPPED (file missing: js/' + f + '.js)'); };

  function fakeCtx(log) {
    const store = {};
    return new Proxy({}, {
      get(o, p) {
        if (p === Symbol.toPrimitive) return () => 0;
        if (p in store) return store[p];
        if (p === 'measureText') return (s) => ({ width: String(s).length * 7 });
        if (p === 'getImageData' || p === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(0), width: w, height: h });
        if (/^create(Linear|Radial)Gradient$|^createPattern$/.test(String(p))) return () => ({ addColorStop() {} });
        if (p === 'drawImage' && log) return (img, ...a) => log.push({ img, a });
        return () => {};
      },
      set(o, p, v) { store[p] = v; return true; },
    });
  }
  // Seeded RNG (QA flake fix): the test and the sandbox Math.random both draw from mulberry32, never the host Math.random.
  const mulberry32 = (a) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const qaRand = mulberry32(0x5EEC4);
  // opts: { coarse, storage: 'ok'|'absent'|'throw', stored: value for hushmoney.speech }
  function boot(opts) {
    opts = opts || {};
    const L = {}, add = (ty, f) => { (L[ty] = L[ty] || []).push(f); };
    const draws = [];
    let created = 0;
    const mk = () => { created++; const c = { width: 0, height: 0, style: {} }, x = fakeCtx(null); c.getContext = () => x; c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 }); return c; };
    const game = { width: 960, height: 540, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }), addEventListener() {}, focus() {} };
    const gctx = fakeCtx(draws); game.getContext = () => gctx;
    let raf = null, now = 0;
    const errs = [], store = {};
    if (opts.stored !== undefined) store['hushmoney.speech'] = opts.stored;
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    const lsThrow = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
    const doc = { readyState: 'complete', hidden: false, createElement: mk, getElementById: (id) => (id === 'game' ? game : { style: {} }), querySelector: () => game, addEventListener: add, documentElement: { requestFullscreen: () => Promise.resolve() } };
    const sb = {
      document: doc, location: { search: '?seed=7' }, addEventListener: add, innerWidth: opts.coarse ? 740 : 1280, innerHeight: opts.coarse ? 360 : 720,
      matchMedia: (q) => ({ matches: /coarse/.test(q) ? !!opts.coarse : false }), requestAnimationFrame: (cb) => { raf = cb; return 1; },
      performance: { now: () => now }, setTimeout: (f) => { f(); return 1; }, clearTimeout() {},
      console: { log() {}, warn() {}, error: (e) => errs.push(String((e && e.message) || e)) },
    };
    if (opts.storage === 'throw') Object.defineProperty(sb, 'localStorage', { get() { throw new Error('SecurityError: storage disabled'); } });
    else if (opts.storage !== 'absent') sb.localStorage = ls;
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext('Math', sb).random = mulberry32(0xC0FFEE);   // deterministic sandbox (seeded, like the game rng)
    for (const f of SHIP) { const p = path.join(JS, f + '.js'); vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: p }); }
    const PE = sb.PE;
    const key = (c) => { for (const fn of L.keydown || []) fn({ code: c, key: c, repeat: false, preventDefault() {} }); for (const fn of L.keyup || []) fn({ code: c, key: c, preventDefault() {} }); };
    const frame = (ms) => { now += ms || 1000 / 60; const cb = raf; raf = null; if (!cb) throw new Error('no rAF requested'); draws.length = 0; cb(now); };
    const fire = (type, x, y, id) => { const e = { type, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, cancelable: true, preventDefault() {} }; for (const fn of L[type] || []) fn(e); };
    const tap = (x, y, id) => { fire('pointerdown', x, y, id); fire('pointerup', x, y, id); };
    const keyEdge = (c, down) => { const e = { code: c, key: c, repeat: false, preventDefault() {} }; for (const fn of L[down ? 'keydown' : 'keyup'] || []) fn(e); };
    return { sb, PE, key, keyEdge, frame, draws, errs, store, tap, created: () => created };
  }
  const state = (g) => g.PE.main.getState();
  const start = (g) => { g.frame(); g.frame(); g.key('Enter'); g.frame(); };
  // a live scandal with one actor bubble, plus a player quip and an ambient line next to the player
  function stage(g) {
    start(g);
    for (let i = 0; i < 60 * 4 && !(g.PE.game.state.scandal && g.PE.game.state.scandal.status === 'live'); i++) g.frame();
    const gs = g.PE.game.state, sc = gs.scandal;
    if (!sc) t.fail('no scandal spawned');
    gs.player.x = sc.focus.x - 120; gs.player.y = sc.focus.y;          // harness teleport: scandal on screen
    const amb = g.PE.npc.people.find((q) => q.look !== 'dog');
    amb.x = gs.player.x + 40; amb.y = gs.player.y + 40;
    return { gs, sc, amb };
  }
  function sayAll(g, x) {
    const N = g.PE.npc, s = qaRand().toString(36).slice(2);               // fresh text = fresh bubble objects (no cached sprite)
    N.say(x.sc.actors[0], 'QA mark line ' + s, 'scandal', 2, 'Mark');
    N.say(x.gs.player, 'QA player quip ' + s, 'player', 2);
    N.say(x.amb, 'QA ambient line ' + s, 'ambient', 2);
    return { mark: x.sc.actors[0].bubble, player: x.gs.player.bubble, amb: x.amb.bubble };
  }
  const drawn = (g, b) => !!(b && b._spr && g.draws.some((d) => d.img === b._spr));

  // ================================================================ filter
  t.test('speech filter: all = every bubble, marks = scandal bubbles only (incl. whisper), off = none; hidden bubbles build no sprite', () => {
    has();
    const want = { all: [true, true, true], marks: [true, false, false], off: [false, false, false] };
    for (const mode of ['all', 'marks', 'off']) {
      const g = boot(), x = stage(g);
      t.eq(g.PE.ui.setSpeech(mode), mode, 'setSpeech(' + mode + ')');
      const b = sayAll(g, x);
      g.frame();
      t.eq([drawn(g, b.mark), drawn(g, b.player), drawn(g, b.amb)], want[mode], mode + ': [mark, player, ambient] drawn');
      if (!want[mode][1]) t.ok(b.player && b.player._spr === undefined, mode + ': hidden player quip built no sprite');
      if (!want[mode][2]) t.ok(b.amb && b.amb._spr === undefined, mode + ': hidden ambient line built no sprite');
      if (!want[mode][0]) t.ok(b.mark && b.mark._spr === undefined, mode + ': hidden mark line built no sprite');
      t.eq(g.errs, [], mode + ': no errors');
    }
    const g = boot(), x = stage(g);                                    // night whisper style counts as a mark
    g.PE.ui.setSpeech('marks');
    x.sc.actors[0].bubble = { text: 'QA whisper ' + qaRand().toString(36).slice(2), ttl: 2, style: 'whisper', name: 'Mark' };   // night-game emits whisper; v1 npc.say would coerce it
    g.frame();
    t.ok(drawn(g, x.sc.actors[0].bubble), 'marks: whisper bubble drawn');
  });

  t.test('speech filter: switching back to all shows bubbles again; v1 layout unchanged in all mode (mark placed first, HUD/SNAP no-go intact)', () => {
    has();
    const g = boot(), x = stage(g);
    g.PE.ui.setSpeech('off'); let b = sayAll(g, x); g.frame();
    t.eq([drawn(g, b.mark), drawn(g, b.amb)], [false, false], 'off: nothing');
    g.PE.ui.setSpeech('all'); g.frame();
    t.eq([drawn(g, b.mark), drawn(g, b.player), drawn(g, b.amb)], [true, true, true], 'back to all: the same bubbles reappear');
    const order = g.draws.map((d) => d.img);
    t.ok(order.indexOf(b.mark._spr) < order.indexOf(b.player._spr) && order.indexOf(b.player._spr) < order.indexOf(b.amb._spr), 'draw order mark -> player -> ambient');
  });

  // ================================================================ persistence
  t.test('speech persistence: saved to localStorage, restored on boot, invalid value -> all', () => {
    has();
    const g = boot();
    t.eq(g.PE.settings.speech, 'all', 'default all');
    start(g);
    g.PE.ui.setSpeech('marks');
    t.eq(g.store['hushmoney.speech'], 'marks', 'stored');
    t.eq(boot({ stored: 'off' }).PE.settings.speech, 'off', 'restored off');
    t.eq(boot({ stored: 'marks' }).PE.settings.speech, 'marks', 'restored marks');
    t.eq(boot({ stored: 'loud' }).PE.settings.speech, 'all', 'invalid stored value ignored');
    t.eq(g.PE.ui.setSpeech('nonsense'), 'marks', 'invalid setSpeech ignored');
  });

  t.test('speech persistence: localStorage absent or throwing never breaks boot, menus or play', () => {
    has();
    for (const storage of ['absent', 'throw']) {
      const g = boot({ storage });
      start(g);
      t.eq(state(g), 'playing', storage + ': run started');
      g.key('KeyP'); g.key('KeyO'); t.eq(state(g), 'options', storage + ': options reachable');
      g.key('Enter'); t.eq(g.PE.settings.speech, 'marks', storage + ': cycles in memory');
      g.key('Escape'); g.key('KeyP');
      for (let i = 0; i < 300; i++) g.frame();
      t.eq(g.errs, [], storage + ': no errors');
    }
  });

  // ================================================================ OPTIONS menu
  t.test('OPTIONS by keyboard: pause -> O -> options; Enter/Space cycle all -> marks -> off -> all; Esc / O / Backspace back; O does nothing while playing', () => {
    has();
    const g = boot();
    start(g);
    g.key('KeyO'); t.eq(state(g), 'playing', 'O while playing does nothing');
    g.key('KeyP'); t.eq(state(g), 'paused', 'paused');
    g.key('KeyO'); t.eq(state(g), 'options', 'O opens options');
    const seq = [];
    for (const k of ['Enter', 'Space', 'Enter']) { g.key(k); seq.push(g.PE.settings.speech); }
    t.eq(seq, ['marks', 'off', 'all'], 'cycle order');
    g.key('Escape'); t.eq(state(g), 'paused', 'Escape from options');
    for (const k of ['KeyO', 'Backspace', 'Escape']) { g.key('KeyO'); t.eq(state(g), 'options', 'O reopens options'); g.key(k); t.eq(state(g), 'paused', k + ' goes back to pause'); }
    g.key('KeyP'); t.eq(state(g), 'playing', 'resume');
    const gs = g.PE.game.state, t0 = gs.time;
    g.key('KeyP'); g.key('KeyO'); for (let i = 0; i < 60; i++) g.frame();
    t.eq(gs.time, t0, 'the game is frozen while in options');
    t.eq(g.errs, [], 'no errors');
  });

  t.test('OPTIONS by touch: pause button -> OPTIONS (x 675..825) -> SPEECH row cycles, BACK returns, other taps do nothing', () => {
    has();
    const g = boot({ coarse: true });
    g.frame(); g.frame(); g.tap(480, 300, 1); g.frame();
    t.eq(state(g), 'playing', 'tap starts');
    g.tap(930, 70, 2); t.eq(state(g), 'paused', 'II pauses');
    g.tap(750, 498, 3); t.eq(state(g), 'options', 'OPTIONS button');
    g.tap(480, 254, 4); t.eq(g.PE.settings.speech, 'marks', 'SPEECH row cycles');
    g.tap(480, 254, 5); t.eq(g.PE.settings.speech, 'off', 'cycles again');
    g.tap(100, 100, 6); t.eq(state(g), 'options', 'empty area does nothing');
    g.tap(480, 328, 7); t.eq(state(g), 'paused', 'BACK');
    g.tap(674, 498, 8); t.eq(state(g), 'playing', 'x 674 is outside OPTIONS (resumes, like any other tap)');
    g.tap(930, 70, 9); g.tap(825, 498, 10); t.eq(state(g), 'options', 'x 825 is inside OPTIONS');
    let drew = false;
    g.tap(480, 328, 11); g.frame();
    drew = g.draws.length > 0;
    t.ok(drew, 'pause screen draws');
    t.eq(g.errs, [], 'no errors');
  });

  // ================================================================ ship set
  t.test('ship set: the 10 index.html files boot and play a whole run with no night file present, in every speech mode', () => {
    has();
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    t.eq([...html.matchAll(/<script\s+src="js\/([^"]+)\.js"/g)].map((m) => m[1]), SHIP, 'index.html loads exactly the ship set');
    for (const mode of ['all', 'marks', 'off']) {
      const g = boot({ stored: mode });
      t.eq(g.PE.NIGHT === undefined && g.PE.stealth === undefined && g.PE.light === undefined && g.PE.nightGame === undefined, true, 'no night module in the ship set');
      start(g);
      const gs = () => g.PE.game.state;
      let scRef = null, field = null, target = null, shot = false;
      const down = new Set();   // keyboard bot (as in the v1 render harness): BFS walk, shoot at RISE
      for (let i = 0; i < 60 * 150 && state(g) !== 'results'; i++) {
        const s = gs(), sc = s.scandal, p = s.player, grid = g.PE.city.grid, W = grid.w, want = new Set();
        if (sc && sc.status === 'live') {
          if (sc !== scRef) { scRef = sc; field = S.bfs(grid, Math.floor(sc.focus.x / 32), Math.floor(sc.focus.y / 32)); target = null; shot = false; }
          const d = Math.hypot(p.x - sc.focus.x, p.y - sc.focus.y);
          if (d > 150) {
            if (!target) target = { tx: Math.floor(p.x / 32), ty: Math.floor(p.y / 32) };
            let ex = target.tx * 32 + 16 - p.x, ey = target.ty * 32 + 16 - p.y;
            if (Math.abs(ex) <= 3 && Math.abs(ey) <= 3) { const dc = field[target.ty * W + target.tx]; for (const [ox, oy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const k = (target.ty + oy) * W + target.tx + ox; if (field[k] === dc - 1) { target = { tx: target.tx + ox, ty: target.ty + oy }; break; } } ex = target.tx * 32 + 16 - p.x; ey = target.ty * 32 + 16 - p.y; }
            if (ex > 3) want.add('KeyD'); if (ex < -3) want.add('KeyA'); if (ey > 3) want.add('KeyS'); if (ey < -3) want.add('KeyW');
          } else if (!shot && sc.t >= g.PE.CFG.RISE - 1 / 60) { g.key('Space'); shot = true; }
        }
        for (const c of down) if (!want.has(c)) { g.keyEdge(c, false); down.delete(c); }
        for (const c of want) if (!down.has(c)) { g.keyEdge(c, true); down.add(c); }
        g.frame();
      }
      t.eq(state(g), 'results', mode + ': run reached results');
      t.eq(gs().results.map((r) => r.label), Array(6).fill('PERFECT SHOT'), mode + ': 6 x PERFECT');
      t.eq(g.errs, [], mode + ': no errors');
    }
  });
};
