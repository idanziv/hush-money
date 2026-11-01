// HUSH MONEY - touch.js black-box tests (v1.1 mobile controls). Owner: QA.
// touch.js is a DOM file, so each test loads it into its own vm context with a fake window/document/canvas
// and drives it with synthetic pointer events in GAME coordinates (mapped through the canvas rect).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('./spec.js');

module.exports = (t, PE) => {
  const FILE = path.join(t.ROOT, 'js', 'touch.js');
  const GW = 960, GH = 540, R = 64, DEAD = 0.22;
  const has = () => { if (!fs.existsSync(FILE)) t.skip('SKIPPED (file missing: js/touch.js)'); };

  // ---------- fakes ----------
  function fakeCtx(log) {
    const store = {};
    return new Proxy({}, {
      get(o, p) {
        if (p === Symbol.toPrimitive) return () => 0;
        if (p in store) return store[p];
        if (p === 'measureText') return (s) => ({ width: String(s).length * 7 });
        return (...a) => { if (log) log.push({ fn: p, a }); };
      },
      set(o, p, v) { store[p] = v; return true; },
    });
  }

  // opts: { coarse, rect:{left,top,width,height}, w, h (window size), state }
  function rig(opts) {
    opts = opts || {};
    const L = { win: {}, doc: {} };
    const counters = { createElement: 0, fullscreen: 0 };
    const add = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
    const doc = {
      createElement: () => { counters.createElement++; const c = { width: 0, height: 0 }; const x = fakeCtx(null); c.getContext = () => x; return c; },
      addEventListener: add(L.doc),
      documentElement: { requestFullscreen: () => { counters.fullscreen++; return Promise.resolve(); } },
      fullscreenElement: null,
    };
    const sb = {
      document: doc, console, PE: {},
      innerWidth: opts.w || 740, innerHeight: opts.h || 360,
      addEventListener: add(L.win),
      matchMedia: opts.matchMediaThrows ? () => { throw new Error('nope'); } : (q) => ({ matches: /coarse/.test(q) ? !!opts.coarse : false, media: q }),
      performance: { now: () => 1000 },
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb, { filename: FILE });
    const rect = opts.rect || { left: 0, top: 0, width: GW, height: GH };
    const canvas = { width: GW, height: GH, getBoundingClientRect: () => rect };
    const api = {
      st: opts.state || 'playing', calls: [],
      state() { return this.st; },
      shoot() { this.calls.push('shoot'); },
      pause() { this.calls.push('pause'); this.st = 'paused'; },
      resume() { this.calls.push('resume'); this.st = 'playing'; },
      start() { this.calls.push('start'); this.st = 'playing'; },
      mute() { this.calls.push('mute'); },
    };
    const T = sb.PE.touch;
    const r = { sb, T, api, L, counters, rect };
    r.init = () => { T.init(canvas, { state: () => api.state(), shoot: () => api.shoot(), pause: () => api.pause(), resume: () => api.resume(), start: () => api.start(), mute: () => api.mute() }); return r; };
    r.fire = (type, x, y, id, pointerType) => {
      const e = {
        type, pointerId: id == null ? 1 : id, pointerType: pointerType || 'touch', cancelable: true, defaultPrevented: false,
        clientX: rect.left + x * rect.width / GW, clientY: rect.top + y * rect.height / GH,
        preventDefault() { this.defaultPrevented = true; },
      };
      for (const fn of L.win[type] || []) fn(e);
      return e;
    };
    r.down = (x, y, id, pt) => r.fire('pointerdown', x, y, id, pt);
    r.move = (x, y, id, pt) => r.fire('pointermove', x, y, id, pt);
    r.up = (x, y, id, pt) => r.fire('pointerup', x, y, id, pt);
    r.cancel = (x, y, id, pt) => r.fire('pointercancel', x, y, id, pt);
    r.tap = (x, y, id, pt) => { r.down(x, y, id, pt); r.up(x, y, id, pt); };
    r.read = (base) => { const inp = Object.assign({ up: false, down: false, left: false, right: false, sprint: false, photo: false }, base || {}); T.read(inp); return inp; };
    r.dirs = (inp) => ['up', 'down', 'left', 'right'].filter((k) => inp[k]).join('+') || 'none';
    return r;
  }
  const setup = (opts) => { has(); return rig(opts).init(); };
  // stick finger: down at (bx,by), then move to angle (deg, screen coords: 0 = right, 90 = down) at distance d
  const BX = 200, BY = 300;
  const push = (r, deg, d, id) => {
    const a = deg * Math.PI / 180;
    r.down(BX, BY, id || 1);
    r.move(BX + Math.cos(a) * d, BY + Math.sin(a) * d, id || 1);
  };

  // ---------------------------------------------------------------- load / init
  t.test('touch.js loads headlessly (no DOM at load) and exposes PE.touch init/read/draw/drawPause/release', () => {
    has();
    const sb = { console, PE: {} };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(FILE, 'utf8'), sb, { filename: FILE }); // no window, no document
    const T = sb.PE.touch;
    t.ok(T, 'PE.touch');
    for (const k of ['init', 'read', 'draw', 'drawPause', 'release']) t.eq(typeof T[k], 'function', 'PE.touch.' + k);
    t.eq(T.enabled, false, 'enabled false before init');
    const inp = { up: false, down: false, left: false, right: false, sprint: false };
    T.read(inp);
    t.eq(inp, { up: false, down: false, left: false, right: false, sprint: false }, 'read() before init is a no-op');
  });

  t.test('init: enabled follows matchMedia("(pointer: coarse)"), survives a throwing matchMedia, listens on window', () => {
    t.eq(setup({ coarse: true }).T.enabled, true, 'coarse pointer -> enabled');
    t.eq(setup({ coarse: false }).T.enabled, false, 'fine pointer -> disabled');
    t.eq(setup({ matchMediaThrows: true }).T.enabled, false, 'matchMedia throws -> disabled, no crash');
    const r = setup({ coarse: true });
    for (const ty of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) t.ok((r.L.win[ty] || []).length >= 1, 'window ' + ty + ' listener');
  });

  // ---------------------------------------------------------------- stick
  t.test('stick: 8 directions (digital, like WASD), no jog below the rim', () => {
    const want = { 0: 'right', 45: 'down+right', 90: 'down', 135: 'down+left', 180: 'left', 225: 'up+left', 270: 'up', 315: 'up+right' };
    for (const deg of Object.keys(want)) {
      const r = setup({ coarse: true });
      push(r, +deg, R * 0.7);
      const inp = r.read();
      t.eq(r.dirs(inp), want[deg], 'stick at ' + deg + ' deg');
      t.eq(inp.sprint, false, 'no jog at 0.7 R (' + deg + ' deg)');
      t.eq(r.api.calls, [], 'stick finger never shoots/pauses');
    }
  });

  t.test('stick: sector edges (20 deg = straight, 25 deg = diagonal) and every angle maps to a valid 8-way combo', () => {
    const r1 = setup({ coarse: true }); push(r1, 20, R * 0.8); t.eq(r1.dirs(r1.read()), 'right', '20 deg');
    const r2 = setup({ coarse: true }); push(r2, 25, R * 0.8); t.eq(r2.dirs(r2.read()), 'down+right', '25 deg');
    const r3 = setup({ coarse: true }); push(r3, -25, R * 0.8); t.eq(r3.dirs(r3.read()), 'up+right', '-25 deg');
    const ok = new Set(['up', 'down', 'left', 'right', 'up+left', 'up+right', 'down+left', 'down+right']);
    const r = setup({ coarse: true });
    r.down(BX, BY, 1);
    for (let deg = 0; deg < 360; deg += 3) {
      const a = deg * Math.PI / 180;
      r.move(BX + Math.cos(a) * 50, BY + Math.sin(a) * 50, 1);
      const d = r.dirs(r.read());
      t.ok(ok.has(d), 'valid combo at ' + deg + ' deg (got ' + d + ')');
    }
  });

  t.test('stick: dead zone 0.22 R (14 px) gives no input; just outside it walks', () => {
    for (const deg of [0, 90, 200, 300]) {
      const a = setup({ coarse: true }); push(a, deg, R * DEAD - 0.5);
      t.eq(a.dirs(a.read()), 'none', 'inside dead zone at ' + deg + ' deg');
      const b = setup({ coarse: true }); push(b, deg, R * DEAD + 0.5);
      t.ok(b.dirs(b.read()) !== 'none', 'outside dead zone at ' + deg + ' deg walks');
    }
  });

  t.test('stick: pushing to the rim (>= R) jogs; beyond the rim still jogs in the same direction', () => {
    const a = setup({ coarse: true }); push(a, 0, R - 1); t.eq(a.read().sprint, false, 'R-1: no jog');
    const b = setup({ coarse: true }); push(b, 0, R); const ib = b.read(); t.eq([b.dirs(ib), ib.sprint], ['right', true], 'R: jog right');
    const c = setup({ coarse: true }); push(c, 135, R * 2.5); const ic = c.read(); t.eq([c.dirs(ic), ic.sprint], ['down+left', true], '2.5 R: jog down-left');
  });

  t.test('stick: read() merges into existing input and never clears keyboard keys', () => {
    const r = setup({ coarse: true });
    t.eq(r.read({ up: true, sprint: true }), { up: true, down: false, left: false, right: false, sprint: true, photo: false }, 'no stick: input untouched');
    push(r, 0, R * 0.5);
    const inp = r.read({ up: true });
    t.ok(inp.up && inp.right, 'keyboard up kept + stick right added');
  });

  t.test('stick: a fresh touch without dragging does not walk (anywhere on the left half, incl. near the edges)', () => {
    const bad = [];
    for (const [x, y] of [[200, 300], [100, 200], [30, 300], [200, 20], [200, 520], [20, 520], [470, 520], [450, 30]]) {
      const r = setup({ coarse: true });
      r.down(x, y, 1);
      const inp = r.read();
      if (r.dirs(inp) !== 'none' || inp.sprint) bad.push('finger down at (' + x + ',' + y + ') -> ' + r.dirs(inp) + (inp.sprint ? ' +jog' : '') + ' without any drag');
    }
    t.none(bad, 'stick base must spawn under the finger');
  });

  t.test('stick: only the first left-half finger owns the stick; a second finger cannot steal or move it', () => {
    const r = setup({ coarse: true });
    push(r, 0, R * 0.6, 1);
    r.down(300, 200, 2);
    r.move(100, 200, 2); // would be "left" if it had taken over
    t.eq(r.dirs(r.read()), 'right', 'stick still follows finger 1');
    r.up(100, 200, 2);
    t.eq(r.dirs(r.read()), 'right', 'finger 2 lifting does not drop the stick');
  });

  t.test('stick: pointerup, pointercancel and release() all drop it; later moves of that finger are ignored', () => {
    const a = setup({ coarse: true }); push(a, 0, R * 0.6); a.up(BX + 40, BY, 1); t.eq(a.dirs(a.read()), 'none', 'after pointerup');
    const b = setup({ coarse: true }); push(b, 90, R * 0.6); b.cancel(BX, BY + 40, 1); t.eq(b.dirs(b.read()), 'none', 'after pointercancel');
    b.move(BX, BY + 60, 1); t.eq(b.dirs(b.read()), 'none', 'move after cancel ignored');
    const c = setup({ coarse: true }); push(c, 180, R); c.T.release();
    t.eq(c.dirs(c.read()), 'none', 'after release()'); t.eq(c.read().sprint, false, 'no jog after release()');
    c.move(BX - 60, BY, 1); t.eq(c.dirs(c.read()), 'none', 'move of the released finger ignored');
    c.down(BX, BY, 3); c.move(BX, BY - 40, 3); t.eq(c.dirs(c.read()), 'up', 'a new finger can take the stick again');
  });

  // ---------------------------------------------------------------- shutter
  t.test('shoot: tap on the right half (y > 52) shoots once per pointerdown; prevents default', () => {
    const r = setup({ coarse: true });
    const e = r.down(700, 300, 7);
    t.eq(r.api.calls, ['shoot'], 'shoot on pointerdown');
    t.ok(e.defaultPrevented, 'touch pointerdown preventDefault');
    r.move(720, 310, 7); r.up(720, 310, 7);
    t.eq(r.api.calls, ['shoot'], 'move/up of the shutter finger do nothing more');
    r.down(481, 300, 8); t.eq(r.api.calls.length, 2, 'x 481 is the right half');
    r.down(800, 53, 9); t.eq(r.api.calls.length, 3, 'y 53 is below the top band');
    const l = setup({ coarse: true }); l.down(479, 300, 1); t.eq(l.api.calls, [], 'x 479 is the stick half (no shot)');
  });

  t.test('shoot: no shot from the top band (y <= 52) over the score / CASE plates', () => {
    const r = setup({ coarse: true });
    for (const [x, y] of [[700, 10], [500, 52], [900, 30], [600, 0]]) r.down(x, y, 20 + x);
    t.eq(r.api.calls, [], 'no shoot/pause from the top band away from the pause button');
  });

  t.test('shoot while walking: stick held on the left + tap on the right both work (multi-touch)', () => {
    const r = setup({ coarse: true });
    push(r, 270, R * 0.6, 1);
    r.down(750, 400, 2);
    t.eq(r.api.calls, ['shoot'], 'shot');
    t.eq(r.dirs(r.read()), 'up', 'still walking up');
  });

  // ---------------------------------------------------------------- mouse / pen / mapping
  t.test('mouse pointers are ignored everywhere (desktop clicks never shoot, walk, pause or start)', () => {
    const r = setup({ coarse: false });
    const e = r.down(700, 300, 1, 'mouse'); r.up(700, 300, 1, 'mouse');
    r.down(200, 300, 2, 'mouse'); r.move(260, 300, 2, 'mouse');
    r.down(930, 70, 3, 'mouse');
    t.eq(r.api.calls, [], 'no api calls from mouse');
    t.eq(r.dirs(r.read()), 'none', 'no stick from mouse');
    t.eq(e.defaultPrevented, false, 'mouse events not prevented');
    for (const st of ['title', 'results', 'paused']) {
      const m = setup({ coarse: false, state: st });
      m.tap(480, 300, 1, 'mouse');
      t.eq(m.api.calls, [], 'mouse tap on ' + st + ' does nothing');
    }
    t.eq(r.T.enabled, false, 'mouse does not flip enabled');
  });

  t.test('pen counts as touch; a touch on a fine-pointer device enables the touch UI', () => {
    const r = setup({ coarse: false });
    r.down(700, 300, 1, 'pen');
    t.eq(r.api.calls, ['shoot'], 'pen shoots');
    t.eq(r.T.enabled, true, 'first touch/pen enables');
  });

  t.test('coordinates map through canvas.getBoundingClientRect() (letterboxed, scaled canvas)', () => {
    const r = setup({ coarse: true, rect: { left: 140, top: 37, width: 480, height: 270 } });
    r.down(700, 300, 1); t.eq(r.api.calls, ['shoot'], 'right half after scaling');
    r.down(930, 70, 2); t.eq(r.api.calls, ['shoot', 'pause'], 'pause button after scaling');
    const s = setup({ coarse: true, rect: { left: 140, top: 37, width: 480, height: 270 } });
    push(s, 90, R * 0.6); t.eq(s.dirs(s.read()), 'down', 'stick after scaling');
  });

  // ---------------------------------------------------------------- pause button / menus
  t.test('pause button at (930,70), hit radius 34: pauses instead of shooting; outside the radius shoots', () => {
    const a = setup({ coarse: true }); a.down(930, 70, 1); t.eq(a.api.calls, ['pause'], 'centre');
    const b = setup({ coarse: true }); b.down(930 - 33, 70, 1); t.eq(b.api.calls, ['pause'], '33 px left');
    const c = setup({ coarse: true }); c.down(930, 70 + 33, 1); t.eq(c.api.calls, ['pause'], '33 px below');
    const d = setup({ coarse: true }); d.down(930, 70 + 36, 1); t.eq(d.api.calls, ['shoot'], '36 px below: a normal shot');
  });

  t.test('pause button drops a held stick', () => {
    const r = setup({ coarse: true });
    push(r, 0, R * 0.8, 1);
    r.down(930, 70, 2);
    t.eq(r.api.calls, ['pause'], 'paused');
    t.eq(r.dirs(r.read()), 'none', 'stick dropped on pause');
  });

  t.test('menuId guard: the finger that pressed pause does not resume on its pointerup; a new tap does', () => {
    const r = setup({ coarse: true });
    r.down(930, 70, 5);
    t.eq(r.api.st, 'paused', 'paused on pointerdown');
    r.up(930, 70, 5);
    t.eq(r.api.calls, ['pause'], 'pause finger lifting does not resume');
    t.eq(r.api.st, 'paused', 'still paused');
    r.tap(300, 250, 6);
    t.eq(r.api.calls, ['pause', 'resume'], 'a fresh tap resumes');
  });

  t.test('menuId guard: the finger that took the last photo does not start a new run when results open', () => {
    const r = setup({ coarse: true });
    r.down(700, 300, 4);              // last shot while playing...
    r.api.st = 'results';             // ...the run ends before the finger lifts
    r.up(700, 300, 4);
    t.eq(r.api.calls, ['shoot'], 'lifting that finger on results does nothing');
    r.tap(480, 300, 5);
    t.eq(r.api.calls, ['shoot', 'start'], 'a real tap on results starts');
  });

  t.test('menus act on pointerup only (a tap), a pointercancel never acts, and a cancelled/foreign pointerup is ignored', () => {
    const r = setup({ coarse: true, state: 'title' });
    r.down(480, 300, 1);
    t.eq(r.api.calls, [], 'title: nothing on pointerdown');
    r.up(480, 300, 1);
    t.eq(r.api.calls, ['start'], 'title: start on pointerup');
    t.ok(r.counters.fullscreen >= 1, 'title tap requests fullscreen');
    const c = setup({ coarse: true, state: 'results' });
    c.down(480, 300, 1); c.cancel(480, 300, 1);
    t.eq(c.api.calls, [], 'results: pointercancel does nothing');
    c.down(480, 300, 2); c.up(480, 300, 3);
    t.eq(c.api.calls, [], 'results: pointerup of a different pointer does nothing');
  });

  t.test('pause screen: RESTART x 315..465 / SOUND x 495..645 (y 478..518); elsewhere resumes', () => {
    const cases = [
      [390, 498, ['start']], [315, 478, ['start']], [465, 518, ['start']],
      [570, 498, ['mute']], [495, 478, ['mute']], [645, 518, ['mute']],
      [480, 498, ['resume']], [314, 498, ['resume']], [646, 498, ['resume']], [390, 476, ['resume']], [390, 520, ['resume']],
      [480, 200, ['resume']], [930, 70, ['resume']],
    ];
    for (const [x, y, want] of cases) {
      const r = setup({ coarse: true, state: 'paused' });
      r.tap(x, y, 1);
      t.eq(r.api.calls, want, 'tap at (' + x + ',' + y + ')');
    }
    const m = setup({ coarse: true, state: 'paused' });
    m.tap(570, 498, 1); m.tap(570, 498, 2);
    t.eq(m.api.calls, ['mute', 'mute'], 'SOUND toggles each tap and keeps the game paused');
    t.eq(m.api.st, 'paused', 'still paused after SOUND');
  });

  t.test('portrait with touch on: canvas input is blocked behind #rotate; rotating to portrait pauses', () => {
    const r = setup({ coarse: true, state: 'paused', w: 390, h: 740 });
    r.tap(480, 200, 1); r.tap(390, 498, 2); r.tap(570, 498, 3);
    t.eq(r.api.calls, [], 'portrait pause screen: no resume / RESTART / SOUND (overlay covers the buttons)');
    const g = setup({ coarse: true, state: 'playing', w: 390, h: 740 });
    g.down(700, 300, 1); g.down(200, 300, 2); g.move(260, 300, 2);
    t.eq([g.api.calls, g.dirs(g.read())], [[], 'none'], 'portrait playing: no shot, no stick');
    const ti = setup({ coarse: true, state: 'title', w: 390, h: 740 });
    ti.tap(480, 300, 1);
    t.eq(ti.api.calls, [], 'portrait title: no start yet');
    t.ok(ti.counters.fullscreen >= 1, 'portrait title tap still asks for fullscreen (landscape lock)');
    const p = setup({ coarse: true, w: 740, h: 360 });
    p.sb.innerWidth = 360; p.sb.innerHeight = 740;
    for (const fn of p.L.win.resize || []) fn({ type: 'resize' });
    t.eq(p.api.calls, ['pause'], 'resize to portrait while enabled pauses');
    p.sb.innerWidth = 740; p.sb.innerHeight = 360;
    p.tap(480, 200, 5);
    t.eq(p.api.calls, ['pause', 'resume'], 'back in landscape a tap resumes');
    const d = setup({ coarse: false, w: 740, h: 360 });
    d.sb.innerWidth = 360; d.sb.innerHeight = 740;
    for (const fn of d.L.win.resize || []) fn({ type: 'resize' });
    t.eq(d.api.calls, [], 'desktop (touch disabled) resize does not pause');
  });

  // ---------------------------------------------------------------- drawing
  t.test('draw/drawPause: nothing when disabled; pre-rendered sprites only (no canvas created per frame)', () => {
    const off = setup({ coarse: false });
    const log0 = []; off.T.draw(fakeCtx(log0), 2); off.T.drawPause(fakeCtx(log0), false);
    t.eq(log0.filter((c) => c.fn === 'drawImage').length, 0, 'disabled: no drawing');
    const r = setup({ coarse: true });
    const made = r.counters.createElement;
    const log = [];
    for (let i = 0; i < 50; i++) { r.T.draw(fakeCtx(log), i % 3); }
    push(r, 45, R * 1.2);
    for (let i = 0; i < 50; i++) r.T.draw(fakeCtx(log), 2);
    const pl = [];
    r.T.drawPause(fakeCtx(pl), false);
    const sOn = pl.filter((c) => c.fn === 'drawImage').map((c) => c.a[0]);
    const pm = [];
    r.T.drawPause(fakeCtx(pm), true);
    const sOff = pm.filter((c) => c.fn === 'drawImage').map((c) => c.a[0]);
    t.eq(r.counters.createElement, made, 'no canvases created while drawing');
    t.ok(log.filter((c) => c.fn === 'drawImage').length >= 300, 'shutter, pause button and stick drawn each frame');
    t.eq([sOn.length, sOff.length], [2, 2], 'pause screen draws RESTART + SOUND');
    t.ok(sOn[0] === sOff[0] && sOn[1] !== sOff[1], 'SOUND sprite switches with muted, RESTART stays');
    const p0 = [], p2 = [];
    r.T.draw(fakeCtx(p0), 0); r.T.draw(fakeCtx(p2), 2);
    t.ok(p0[0].a[0] !== p2[0].a[0], 'shutter sprite reflects proximity (grey vs in range)');
  });

  // ---------------------------------------------------------------- static + data
  t.test('static: touch.js boilerplate, no Math.random, no shadowBlur/filter, no #39FF14, no regex or allocation in draw/read', () => {
    has();
    const src = fs.readFileSync(FILE, 'utf8');
    const code = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    t.ok(/\(function \(PE\) \{\s*'use strict';/.test(src), 'boilerplate head');
    t.ok(/\}\)\(globalThis\.PE = globalThis\.PE \|\| \{\}\);\s*$/.test(src), 'boilerplate tail');
    t.ok(!/Math\.random\s*\(/.test(code), 'no Math.random');
    t.ok(!/shadowBlur|\.filter\s*=/.test(code), 'no shadowBlur / ctx.filter');
    t.ok(!/39FF14/i.test(src), 'no #39FF14 (scandal-only colour)');
    const body = (name) => {
      const i = code.indexOf('T.' + name + ' = function');
      if (i < 0) return '';
      const j = code.indexOf('\n  };', i);
      return code.slice(i, j < 0 ? undefined : j);
    };
    for (const fn of ['read', 'draw', 'drawPause']) {
      const b = body(fn);
      t.ok(b.length > 0, 'found T.' + fn);
      t.ok(!/new\s+[A-Z]|createElement|\[\s*\]|\{\s*\}|\/[^/*\n]+\/[gimsuy]*\.test|RegExp/.test(b), 'T.' + fn + ': no allocation / regex per call');
    }
  });

  t.test('data: PE.TEXT_TOUCH overrides only known PE.TEXT keys with valid strings', () => {
    t.needs('data');
    const TT = PE.TEXT_TOUCH;
    t.ok(TT && typeof TT === 'object', 'PE.TEXT_TOUCH exists');
    const bad = [];
    const leafs = (v, tag) => {   // every leaf (string / array item / nested object value) must be a clean string
      if (Array.isArray(v)) v.forEach((x, i) => leafs(x, tag + '[' + i + ']'));
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) leafs(v[k], tag + '.' + k);
      else if (typeof v !== 'string' || !v.trim()) bad.push(tag + ' empty');
      else if (S.HEBREW_RE.test(v) || S.EMOJI_RE.test(v)) bad.push(tag + ' has Hebrew/emoji');
    };
    const shape = (v) => (Array.isArray(v) ? 'array' : typeof v);
    for (const k of Object.keys(TT)) {
      if (!(k in PE.TEXT)) bad.push('TEXT_TOUCH.' + k + ' is not a PE.TEXT key');
      else if (shape(PE.TEXT[k]) !== shape(TT[k])) bad.push('TEXT_TOUCH.' + k + ' type differs from PE.TEXT.' + k);
      leafs(TT[k], 'TEXT_TOUCH.' + k);
    }
    for (const k of ['controls', 'start']) if (!(k in TT)) bad.push('TEXT_TOUCH.' + k + ' missing (touch players need touch wording)');
    if (TT.start && /enter|space|key/i.test(TT.start)) bad.push('TEXT_TOUCH.start mentions keys: "' + TT.start + '"');
    t.none(bad, 'TEXT_TOUCH');
  });
};
