// HUSH MONEY - black-box tests for PE.logic (spec v0.3 RC sections 4-7, 14.5). Owner: QA.
// Uses the spec oracle (tests/spec.js), never values read from data.js.
'use strict';
const S = require('./spec.js');

module.exports = (t, PE) => {
  const CFG = S.CFG;
  const L = () => { t.needs('logic'); return PE.logic; };
  const label = (r) => r; // v0.2: gradeFor/rankFor return label strings
  const tc = (x) => x * 32 + 16; // tile center px

  // ---------------- glow curve ----------------
  t.test('intensityAt: spec sample table (sec 4)', () => {
    const l = L();
    const samples = [[0, 0.10], [5.5, 0.325], [8.25, 0.60625], [10, 0.8438], [11, 1.0], [12.75, 0.5625], [14.5, 0.25], [16.25, 0.0625], [18, 0]];
    for (const [tt, v] of samples) t.near(l.intensityAt(tt, CFG), v, 1e-3, 'intensityAt(' + tt + ')');
  });

  t.test('intensityAt: exact formula on a fine grid, range 0..1, rise monotonic up, fall monotonic down', () => {
    const l = L();
    const bad = [];
    let prev = -1;
    for (let i = 0; i <= 1800; i++) {
      const tt = i / 100;
      const exp = tt <= 11 ? 0.1 + 0.9 * (tt / 11) * (tt / 11) : Math.pow(1 - (tt - 11) / 7, 2);
      const got = l.intensityAt(tt, CFG);
      if (!(Math.abs(got - exp) < 1e-9)) bad.push('t=' + tt + ' expected ' + exp + ' got ' + got);
      if (!(got >= 0 && got <= 1)) bad.push('t=' + tt + ' out of 0..1: ' + got);
      if (tt <= 11 && got < prev - 1e-12) bad.push('not rising at t=' + tt);
      if (tt > 11 && got > prev + 1e-12) bad.push('not falling at t=' + tt);
      prev = got;
    }
    t.none(bad, 'intensity curve');
  });

  t.test('intensityAt: edges t<0 and t>18 are 0', () => {
    const l = L();
    for (const tt of [-0.0001, -1, -100, 18.0001, 18.5, 30, 1e6]) t.eq(l.intensityAt(tt, CFG), 0, 'intensityAt(' + tt + ')');
    t.near(l.intensityAt(18, CFG), 0, 1e-12, 'intensityAt(18)');
    t.near(l.intensityAt(0, CFG), 0.10, 1e-12, 'intensityAt(0) = MIN_GLOW');
  });

  t.test('intensityAt: reads RISE/FALL/MIN_GLOW from cfg (not hardcoded)', () => {
    const l = L();
    const c = Object.assign({}, CFG, { RISE: 10, FALL: 5, MIN_GLOW: 0.2 });
    t.near(l.intensityAt(0, c), 0.2, 1e-9, 't=0');
    t.near(l.intensityAt(10, c), 1, 1e-9, 't=RISE');
    t.near(l.intensityAt(12.5, c), 0.25, 1e-9, 't=RISE+FALL/2');
    t.eq(l.intensityAt(15.01, c), 0, 't>RISE+FALL');
  });

  t.test('isLive: 0 <= t <= 18 inclusive', () => {
    const l = L();
    for (const tt of [0, 0.001, 7, 11, 17.99, 18]) t.eq(!!l.isLive(tt, CFG), true, 'isLive(' + tt + ')');
    for (const tt of [-0.001, -5, 18.001, 19, 100]) t.eq(!!l.isLive(tt, CFG), false, 'isLive(' + tt + ')');
    t.eq(typeof l.isLive(5, CFG), 'boolean', 'isLive returns bool');
  });

  // ---------------- scoring ----------------
  const shot = (l, tt, c) => l.scorePhoto({ t: tt, live: true, inRange: true }, c || CFG);

  t.test('scorePhoto: spec check values (sec 6)', () => {
    const l = L();
    const cases = [[10, 826], [8, 529], [12, 735], [13, 510], [0, 50], [18, 50], [11, 1500], [11.4, 889],
      [14.5, 250], [4, 132], [17.9, 50], [10.64, 936], [11.36, 900], [10.74, 953], [11.3, 916], [11.26, 927]];
    for (const [tt, pts] of cases) {
      const r = shot(l, tt);
      t.eq(r.kind, 'scored', 'kind at t=' + tt);
      t.eq(r.points, pts, 'points at t=' + tt);
      t.near(r.dt, tt - 11, 1e-9, 'dt at t=' + tt);
    }
  });

  t.test('scorePhoto: PERFECT window boundaries 0.25 in, 0.26 out (both sides)', () => {
    const l = L();
    for (const tt of [10.75, 10.8, 11, 11.2, 11.25]) {
      const r = shot(l, tt);
      t.eq(r.points, 1500, 'perfect points at t=' + tt);
      t.eq(r.label, 'PERFECT SHOT', 'perfect label at t=' + tt);
    }
    for (const tt of [10.74, 11.26, 10.65, 11.35]) {
      const r = shot(l, tt);
      t.ok(r.points < 1500, 'not perfect at t=' + tt + ' (points ' + r.points + ')');
      t.eq(r.label, 'FRONT PAGE', 'label at t=' + tt);
    }
  });

  t.test('scorePhoto: label of a scored photo = gradeFor(points)', () => {
    const l = L();
    for (let tt = 0; tt <= 18; tt += 0.25) {
      const r = shot(l, tt);
      t.eq(r.label, label(l.gradeFor(r.points, CFG)), 'label at t=' + tt);
      t.ok(r.points >= 50 && r.points <= 1500 && Number.isInteger(r.points), 'integer points 50..1500 at t=' + tt + ' got ' + r.points);
    }
    t.eq(shot(l, 10).label, 'FRONT PAGE', 't=10');
    t.eq(shot(l, 8).label, 'JUICY', 't=8');
    t.eq(shot(l, 14.5).label, 'TABLOID FILLER', 't=14.5');
    t.eq(shot(l, 4).label, 'BLURRY GOSSIP', 't=4');
  });

  t.test('scorePhoto: penalties and evaluation order', () => {
    const l = L();
    const a = l.scorePhoto({ t: 11, live: false, inRange: true }, CFG);
    t.eq([a.kind, a.points, a.label], ['no_scandal', -150, 'WASTED FILM'], 'not live, in range');
    const b = l.scorePhoto({ t: 11, live: false, inRange: false }, CFG);
    t.eq([b.kind, b.points, b.label], ['no_scandal', -150, 'WASTED FILM'], 'not live + out of range -> rule 1 wins');
    const c = l.scorePhoto({ t: 11, live: true, inRange: false }, CFG);
    t.eq([c.kind, c.points, c.label], ['too_far', -100, 'TOO FAR'], 'live, out of range at the exact peak');
    const d = l.scorePhoto({ t: 0, live: false, inRange: false }, CFG);
    t.eq(d.kind, 'no_scandal', 'no scandal (t ignored)');
  });

  t.test('scorePhoto: uses cfg.RISE (peak moves with cfg)', () => {
    const l = L();
    const c = Object.assign({}, CFG, { RISE: 10 });
    const r = shot(l, 10, c);
    t.eq(r.points, 1500, 'perfect at custom RISE');
    t.near(r.dt, 0, 1e-9, 'dt at custom RISE');
  });

  t.test('gradeFor: boundaries', () => {
    const l = L();
    const cases = [[9999, 'PERFECT SHOT'], [1500, 'PERFECT SHOT'], [1499, 'FRONT PAGE'], [750, 'FRONT PAGE'], [749, 'JUICY'],
      [400, 'JUICY'], [399, 'TABLOID FILLER'], [150, 'TABLOID FILLER'], [149, 'BLURRY GOSSIP'], [50, 'BLURRY GOSSIP'],
      [0, 'BLURRY GOSSIP']];
    for (const [p, lab] of cases) t.eq(l.gradeFor(p, CFG), lab, 'gradeFor(' + p + ') (string)');
  });

  t.test('rankFor: boundaries incl. negative totals', () => {
    const l = L();
    const cases = [[9000, 'Kingpin of Kompromat'], [7500, 'Kingpin of Kompromat'], [7499, 'Professional Sleazeball'],
      [5000, 'Professional Sleazeball'], [4999, 'Paparazzo with Debts'], [2500, 'Paparazzo with Debts'],
      [2499, 'Tourist with a Camera'], [0, 'Tourist with a Camera'], [-1, 'Owes the Tabloids Money'],
      [-150, 'Owes the Tabloids Money'], [-100000, 'Owes the Tabloids Money']];
    for (const [p, lab] of cases) t.eq(l.rankFor(p, CFG), lab, 'rankFor(' + p + ') (string)');
  });

  // ---------------- geometry ----------------
  t.test('dist: Euclidean', () => {
    const l = L();
    t.near(l.dist(0, 0, 3, 4), 5, 1e-12);
    t.near(l.dist(10, 10, 10, 10), 0, 1e-12);
    t.near(l.dist(-3, -4, 0, 0), 5, 1e-12);
  });

  t.test('proximity: 2 in range <=170, 1 near <=272, else 0', () => {
    const l = L();
    const cases = [[0, 2], [100, 2], [170, 2], [170.01, 1], [200, 1], [272, 1], [272.01, 0], [1000, 0]];
    for (const [d, p] of cases) t.eq(l.proximity(d, CFG), p, 'proximity(' + d + ')');
  });

  t.test('dirFromVector: all 8 directions (0=N clockwise), scale-invariant', () => {
    const l = L();
    const v = [[0, -1, 0], [1, -1, 1], [1, 0, 2], [1, 1, 3], [0, 1, 4], [-1, 1, 5], [-1, 0, 6], [-1, -1, 7]];
    for (const [dx, dy, d] of v) {
      t.eq(l.dirFromVector(dx, dy), d, 'dir(' + dx + ',' + dy + ')');
      t.eq(l.dirFromVector(dx * 37.5, dy * 37.5), d, 'dir scaled (' + dx + ',' + dy + ')');
    }
    // sector edges: 20 deg off north still N, 25 deg is NE
    const deg = (a) => [Math.sin(a * Math.PI / 180), -Math.cos(a * Math.PI / 180)];
    t.eq(l.dirFromVector(...deg(20)), 0, '20 deg');
    t.eq(l.dirFromVector(...deg(-20)), 0, '-20 deg');
    t.eq(l.dirFromVector(...deg(25)), 1, '25 deg');
    t.eq(l.dirFromVector(...deg(200)), 4, '200 deg');
    t.eq(l.dirFromVector(...deg(250)), 6, '250 deg');
    for (let i = 0; i < 360; i++) {
      const r = l.dirFromVector(...deg(i));
      t.ok(Number.isInteger(r) && r >= 0 && r <= 7, 'integer 0..7 at ' + i + ' deg');
      t.eq(r, (Math.round(i / 45) + 8) % 8, 'formula at ' + i + ' deg');
    }
  });

  // ---------------- BFS ----------------
  t.test('bfsTiles: hand-made grid distances, walls, unreachable pocket', () => {
    const l = L();
    const g = S.gridFrom([
      '...#....',
      '.#.#.##.',
      '.#...#..',
      '.####.#.',
      '......#.',
      '#####.##',
      '..#.....',
    ]);
    // pocket at (0,6),(1,6) is walled off by row 5 and (2,6).
    const d = l.bfsTiles(g, 0, 0, 1000);
    t.ok(d instanceof Int16Array, 'returns Int16Array');
    t.eq(d.length, g.w * g.h, 'length w*h');
    const at = (x, y) => d[y * g.w + x];
    t.eq(at(0, 0), 0, 'start');
    t.eq(at(2, 0), 2, '(2,0)');
    t.eq(at(2, 2), 4, '(2,2)');
    t.eq(at(4, 0), 8, '(4,0) around the wall');
    t.eq(at(7, 0), 11, '(7,0)');
    t.eq(at(0, 4), 4, '(0,4)');
    t.eq(at(5, 4), 9, '(5,4) via row 4');
    t.eq(at(5, 6), 11, '(5,6)');
    t.eq(at(3, 6), 13, '(3,6)');
    t.eq(at(3, 0), -1, 'solid tile is -1');
    t.eq(at(0, 6), -1, 'walled pocket unreachable');
    t.eq(at(1, 6), -1, 'walled pocket unreachable');
    // full comparison against oracle
    const o = S.bfs(g, 0, 0);
    const bad = [];
    for (let i = 0; i < o.length; i++) if (o[i] !== d[i]) bad.push('tile ' + (i % g.w) + ',' + Math.floor(i / g.w) + ' oracle ' + o[i] + ' got ' + d[i]);
    t.none(bad, 'bfs vs oracle');
  });

  t.test('bfsTiles: maxSteps limits the search (farther tiles -> -1)', () => {
    const l = L();
    const g = S.gridFrom(['..........', '..........', '..........']);
    const d = l.bfsTiles(g, 0, 0, 4);
    const bad = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 10; x++) {
      const exp = x + y <= 4 ? x + y : -1;
      if (d[y * 10 + x] !== exp) bad.push(x + ',' + y + ' exp ' + exp + ' got ' + d[y * 10 + x]);
    }
    t.none(bad, 'maxSteps=4');
  });

  t.test('bfsTiles: 300 random grids match oracle', () => {
    const l = L();
    const rng = l.mulberry32(777);
    const bad = [];
    for (let k = 0; k < 300 && bad.length < 5; k++) {
      const w = 5 + Math.floor(rng() * 40), h = 5 + Math.floor(rng() * 30);
      const rows = [];
      for (let y = 0; y < h; y++) { let s = ''; for (let x = 0; x < w; x++) s += rng() < 0.3 ? '#' : '.'; rows.push(s); }
      const sx = Math.floor(rng() * w), sy = Math.floor(rng() * h);
      rows[sy] = rows[sy].slice(0, sx) + '.' + rows[sy].slice(sx + 1);
      const g = S.gridFrom(rows);
      const max = rng() < 0.5 ? 10000 : Math.floor(rng() * 30);
      const d = l.bfsTiles(g, sx, sy, max), o = S.bfs(g, sx, sy, max);
      for (let i = 0; i < o.length; i++) if (o[i] !== d[i]) { bad.push('grid ' + k + ' tile ' + i + ' oracle ' + o[i] + ' got ' + d[i]); break; }
    }
    t.none(bad, 'random bfs');
  });

  // ---------------- movement / collision ----------------
  function overlapsSolid(g, x, y, r, tile) {
    const x0 = Math.floor((x - r) / tile), x1 = Math.floor((x + r) / tile);
    const y0 = Math.floor((y - r) / tile), y1 = Math.floor((y + r) / tile);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) continue;
      if (!g.solid[ty * g.w + tx]) continue;
      const cx = Math.max(tx * tile, Math.min(x, (tx + 1) * tile));
      const cy = Math.max(ty * tile, Math.min(y, (ty + 1) * tile));
      const dd = Math.hypot(x - cx, y - cy);
      if (dd < r - 0.01) return tx + ',' + ty;
    }
    return null;
  }

  t.test('moveAndCollide: open space moves exactly; returns fresh {x,y}', () => {
    const l = L();
    const g = S.gridFrom(['..........', '..........', '..........', '..........']);
    const r = l.moveAndCollide(g, 100, 60, 3, 4, 7, 32);
    t.near(r.x, 103, 1e-9, 'x'); t.near(r.y, 64, 1e-9, 'y');
    const z = l.moveAndCollide(g, 100, 60, 0, 0, 7, 32);
    t.near(z.x, 100, 1e-9, 'x zero move'); t.near(z.y, 60, 1e-9, 'y zero move');
  });

  t.test('moveAndCollide: axis-separated - slides along a wall', () => {
    const l = L();
    const rows = [];
    for (let y = 0; y < 10; y++) rows.push('.....#....');
    const g = S.gridFrom(rows); // wall column at tile x=5 -> px 160..192
    let p = { x: 144, y: 40 };
    for (let i = 0; i < 10; i++) p = l.moveAndCollide(g, p.x, p.y, 5, 5, 7, 32);
    t.ok(p.x <= 160 - 7 + 0.01, 'never into wall, x=' + p.x);
    t.ok(p.x >= 148, 'moved toward the wall, x=' + p.x);
    t.near(p.y, 90, 1e-6, 'y kept sliding');
  });

  t.test('moveAndCollide: clamps to map bounds', () => {
    const l = L();
    const g = S.gridFrom(['..........', '..........', '..........', '..........', '..........']); // 320x160
    let p = { x: 50, y: 50 };
    for (let i = 0; i < 200; i++) p = l.moveAndCollide(g, p.x, p.y, -5, -5, 7, 32);
    t.ok(p.x >= 0 && p.y >= 0, 'top-left clamp (' + p.x + ',' + p.y + ')');
    for (let i = 0; i < 300; i++) p = l.moveAndCollide(g, p.x, p.y, 5, 5, 7, 32);
    t.ok(p.x <= 320 && p.y <= 160, 'bottom-right clamp (' + p.x + ',' + p.y + ')');
  });

  t.test('moveAndCollide: fuzz 10k random moves never overlap a solid tile, stay in map', () => {
    const l = L();
    const rng = l.mulberry32(4242);
    const bad = [];
    let moves = 0;
    for (let k = 0; k < 10 && bad.length < 5; k++) {
      const w = 24, h = 16, rows = [];
      for (let y = 0; y < h; y++) { let s = ''; for (let x = 0; x < w; x++) s += rng() < 0.28 ? '#' : '.'; rows.push(s); }
      const sx = 1 + Math.floor(rng() * (w - 2)), sy = 1 + Math.floor(rng() * (h - 2));
      // clear a 3x3 around the start so the start itself is legal
      for (let y = sy - 1; y <= sy + 1; y++) rows[y] = rows[y].slice(0, sx - 1) + '...' + rows[y].slice(sx + 2);
      const g = S.gridFrom(rows);
      let p = { x: tc(sx), y: tc(sy) };
      for (let i = 0; i < 1000; i++, moves++) {
        const m = rng();
        const dx = m < 0.1 ? 0 : (rng() * 2 - 1) * 10, dy = m > 0.9 ? 0 : (rng() * 2 - 1) * 10;
        const q = l.moveAndCollide(g, p.x, p.y, dx, dy, 7, 32);
        if (!q || !isFinite(q.x) || !isFinite(q.y)) { bad.push('non-finite result ' + JSON.stringify(q)); break; }
        const hit = overlapsSolid(g, q.x, q.y, 7, 32);
        if (hit) { bad.push('grid ' + k + ' move ' + i + ': (' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ')+(' + dx.toFixed(2) + ',' + dy.toFixed(2) + ') -> (' + q.x.toFixed(2) + ',' + q.y.toFixed(2) + ') overlaps solid ' + hit); break; }
        if (q.x < 0 || q.y < 0 || q.x > w * 32 || q.y > h * 32) { bad.push('left the map: ' + q.x + ',' + q.y); break; }
        p = q;
      }
    }
    t.none(bad, 'collision fuzz');
    t.eq(moves, 10000, 'moves executed');
  });

  t.test('moveAndCollide: optional out param is written and returned (no allocation)', () => {
    const l = L();
    const g = S.gridFrom(['..........', '..........', '..........', '..........']);
    const out = { x: -1, y: -1 };
    const r = l.moveAndCollide(g, 100, 60, 3, 4, 7, 32, out);
    t.ok(r === out, 'returns the out object');
    t.near(out.x, 103, 1e-9, 'out.x'); t.near(out.y, 64, 1e-9, 'out.y');
    const r2 = l.moveAndCollide(g, out.x, out.y, -3, -4, 7, 32, out); // aliasing: reads x,y before writing
    t.ok(r2 === out, 'returns out again');
    t.near(out.x, 100, 1e-9, 'out.x after aliased call'); t.near(out.y, 60, 1e-9, 'out.y after aliased call');
    const fresh = l.moveAndCollide(g, 100, 60, 1, 1, 7, 32);
    t.ok(fresh && fresh !== out, 'without out a fresh object is returned');
  });

  t.test('moveAndCollide: body starting inside solid is pushed to the nearest free tile center, then never re-enters solid', () => {
    const l = L();
    const g = S.gridFrom([
      '........',
      '........',
      '...#....',
      '........',
      '........',
    ]);
    // centre of the single solid tile (3,2)
    const r = l.moveAndCollide(g, tc(3), tc(2), 0, 0, 7, 32);
    const tx = Math.floor(r.x / 32), ty = Math.floor(r.y / 32);
    t.ok(!g.solid[ty * g.w + tx], 'ends on a free tile (' + tx + ',' + ty + ')');
    t.ok(Math.max(Math.abs(tx - 3), Math.abs(ty - 2)) === 1, 'free tile is a neighbour of the start tile (nearest), got ' + tx + ',' + ty);
    t.ok(!overlapsSolid(g, r.x, r.y, 7, 32), 'body box clear of solid');
    // deep inside a 3x3 block: nearest free tile is 2 tiles away
    const g2 = S.gridFrom(['.........', '..#####..', '..#####..', '..#####..', '..#####..', '..#####..', '.........']);
    const r2 = l.moveAndCollide(g2, tc(4), tc(3), 2, 0, 7, 32);
    const t2x = Math.floor(r2.x / 32), t2y = Math.floor(r2.y / 32);
    t.ok(!g2.solid[t2y * g2.w + t2x], 'deep start ends free (' + t2x + ',' + t2y + ')');
    t.ok(Math.max(Math.abs(t2x - 4), Math.abs(t2y - 3)) <= 3, 'nearest-ish free tile, got ' + t2x + ',' + t2y);
    // fuzz: random starts inside solid, then 200 random moves each - never overlap again
    const rng = l.mulberry32(31337);
    const bad = [];
    for (let k = 0; k < 200 && bad.length < 5; k++) {
      const rows = [];
      for (let y = 0; y < 14; y++) { let s2 = ''; for (let x = 0; x < 20; x++) s2 += rng() < 0.3 ? '#' : '.'; rows.push(s2); }
      const gg = S.gridFrom(rows);
      const solids = [];
      for (let i = 0; i < gg.solid.length; i++) if (gg.solid[i]) solids.push(i);
      const si = solids[Math.floor(rng() * solids.length)];
      let p = { x: (si % 20) * 32 + 4 + rng() * 24, y: Math.floor(si / 20) * 32 + 4 + rng() * 24 };
      for (let i = 0; i < 200; i++) {
        const q = l.moveAndCollide(gg, p.x, p.y, (rng() * 2 - 1) * 8, (rng() * 2 - 1) * 8, 7, 32);
        const hit = overlapsSolid(gg, q.x, q.y, 7, 32);
        if (hit) { bad.push('grid ' + k + ' move ' + i + (i === 0 ? ' (push-out)' : '') + ': (' + q.x.toFixed(1) + ',' + q.y.toFixed(1) + ') overlaps ' + hit); break; }
        p = q;
      }
    }
    t.none(bad, 'push-out fuzz');
  });

  // ---------------- edge arrow ----------------
  t.test('edgeArrow: on-screen targets', () => {
    const l = L();
    const cam = { x: 1000, y: 500, w: 960, h: 540 };
    const a = l.edgeArrow(cam, 1480, 770, 28);
    t.eq(a.onScreen, true, 'center on-screen');
    t.near(a.x, 480, 1, 'center x'); t.near(a.y, 270, 1, 'center y');
    const b = l.edgeArrow(cam, 1100, 600, 28);
    t.eq(b.onScreen, true, '(100,100) on-screen');
    t.near(b.x, 100, 1, 'x'); t.near(b.y, 100, 1, 'y');
  });

  t.test('edgeArrow: off-screen targets clamp to edge band and point at the target', () => {
    const l = L();
    const cam = { x: 1000, y: 500, w: 960, h: 540 };
    const check = (tx, ty, ex, ey, name) => {
      const a = l.edgeArrow(cam, tx, ty, 28);
      t.eq(a.onScreen, false, name + ' off-screen');
      t.ok(a.x >= 0 && a.x <= 960 && a.y >= 0 && a.y <= 540, name + ' inside view (' + a.x + ',' + a.y + ')');
      t.ok(Math.min(a.x, 960 - a.x, a.y, 540 - a.y) <= 29, name + ' on the edge band (' + a.x + ',' + a.y + ')');
      const n = Math.hypot(ex, ey);
      t.near(Math.cos(a.angle), ex / n, 0.05, name + ' angle cos'); t.near(Math.sin(a.angle), ey / n, 0.05, name + ' angle sin');
    };
    check(1000 + 480 + 50000, 770, 1, 0, 'far east');
    check(1000 + 480 - 50000, 770, -1, 0, 'far west');
    check(1480, 770 + 50000, 0, 1, 'far south');
    check(1480, 770 - 50000, 0, -1, 'far north');
    check(1480 + 50000, 770 + 25000, 2, 1, 'far ESE');
    check(1480 - 40000, 770 - 40000, -1, -1, 'far NW');
    // just outside the view and within the 24px inset are both "off-screen"
    t.eq(l.edgeArrow(cam, 1000 + 965, 770, 28).onScreen, false, '5px outside right edge');
    t.eq(l.edgeArrow(cam, 1000 + 950, 770, 28).onScreen, false, '10px inside right edge (within 24px inset)');
    t.eq(l.edgeArrow(cam, 1480, 500 + 8, 28).onScreen, false, '8px inside top edge');
    t.eq(l.edgeArrow(cam, 1000 + 900, 770, 28).onScreen, true, '60px inside right edge');
  });

  t.test('edgeArrow: clampInset (default = inset) and angle = atan2(dy,dx) from view centre', () => {
    const l = L();
    const cam = { x: 1000, y: 500, w: 960, h: 540 };
    const E = l.edgeArrow(cam, 1480 + 60000, 770, 24, 28);
    t.eq(E.onScreen, false, 'far east off-screen');
    t.near(E.x, 960 - 28, 0.51, 'clamped at clampInset 28 (x)'); t.near(E.y, 270, 0.51, 'centre row (y)');
    const D = l.edgeArrow(cam, 1480 + 60000, 770, 24);
    t.near(D.x, 960 - 24, 0.51, 'default clampInset = inset 24');
    const S2 = l.edgeArrow(cam, 1480, 770 + 60000, 24, 28);
    t.near(S2.y, 540 - 28, 0.51, 'south clamp y'); t.near(S2.x, 480, 0.51, 'south clamp x');
    t.eq(l.edgeArrow(cam, 1000 + 960 - 26, 770, 24, 28).onScreen, true, '26 px inside the edge is on-screen with inset 24');
    t.eq(l.edgeArrow(cam, 1000 + 960 - 20, 770, 24, 28).onScreen, false, '20 px inside the edge is off-screen with inset 24');
    const rng = l.mulberry32(8);
    for (let i = 0; i < 50; i++) {
      const a = rng() * Math.PI * 2, R = 5000 + rng() * 5000;
      const tx = 1480 + Math.cos(a) * R, ty = 770 + Math.sin(a) * R;
      const r = l.edgeArrow(cam, tx, ty, 24, 28);
      const ea = Math.atan2(ty - 770, tx - 1480);
      t.near(Math.cos(r.angle), Math.cos(ea), 0.06, 'angle cos at ' + a.toFixed(2)); t.near(Math.sin(r.angle), Math.sin(ea), 0.06, 'angle sin at ' + a.toFixed(2));
      t.ok(Math.abs(r.angle) <= Math.PI + 1e-9, 'angle in atan2 range [-PI, PI], got ' + r.angle);
      t.ok(r.x >= 28 - 0.51 && r.x <= 932.51 && r.y >= 27.49 && r.y <= 512.51, 'inside the 28 px clamp rect (' + r.x.toFixed(1) + ',' + r.y.toFixed(1) + ')');
    }
  });

  // ---------------- rng / shuffle / misc ----------------
  t.test('mulberry32: deterministic, in [0,1), seeds differ', () => {
    const l = L();
    const a = l.mulberry32(123), b = l.mulberry32(123), c = l.mulberry32(124);
    const sa = [], sb = [], sc = [];
    for (let i = 0; i < 1000; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
    t.eq(sa, sb, 'same seed same sequence');
    t.ok(sa.some((v, i) => v !== sc[i]), 'different seed different sequence');
    const r = l.mulberry32(9);
    let sum = 0, bad = 0;
    for (let i = 0; i < 20000; i++) { const v = r(); if (!(v >= 0 && v < 1)) bad++; sum += v; }
    t.eq(bad, 0, 'values outside [0,1)');
    t.near(sum / 20000, 0.5, 0.02, 'mean');
  });

  t.test('mulberry32: matches the reference algorithm', () => {
    const l = L();
    const ref = (a) => () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (const seed of [0, 1, 42, 123456789]) {
      const g = l.mulberry32(seed), r = ref(seed);
      for (let i = 0; i < 20; i++) t.eq(g(), r(), 'seed ' + seed + ' value ' + i);
    }
  });

  t.test('shuffle: permutation, new array, input untouched, deterministic, actually shuffles', () => {
    const l = L();
    const src = Array.from({ length: 30 }, (_, i) => ({ i }));
    const copy = src.slice();
    const out = l.shuffle(src, l.mulberry32(5));
    t.ok(Array.isArray(out) && out !== src, 'returns a new array');
    t.eq(src.length, 30, 'input length'); t.ok(src.every((v, i) => v === copy[i]), 'input order untouched');
    t.eq(out.length, 30, 'output length');
    t.eq(out.map((o) => o.i).sort((a, b) => a - b), copy.map((o) => o.i), 'permutation of the same elements');
    t.ok(out.every((o) => copy.includes(o)), 'same object identities');
    t.eq(l.shuffle(src, l.mulberry32(5)).map((o) => o.i), out.map((o) => o.i), 'deterministic for same rng seed');
    let moved = 0;
    for (let s = 1; s <= 20; s++) if (l.shuffle(copy, l.mulberry32(s)).some((o, i) => o !== copy[i])) moved++;
    t.ok(moved >= 19, 'shuffles change order (' + moved + '/20)');
    t.eq(l.shuffle([], l.mulberry32(1)), [], 'empty');
    // every position reachable for element 0 over many seeds (not a biased rotate)
    const seen = new Set();
    for (let s = 0; s < 400; s++) seen.add(l.shuffle([0, 1, 2, 3, 4], l.mulberry32(s)).indexOf(0));
    t.eq(seen.size, 5, 'element 0 lands in every slot');
  });

  t.test('tickBubble: ttl counts down, null at <= 0, null bubble ok', () => {
    const l = L();
    const p = { bubble: { text: 'yalla', ttl: 1, style: 'ambient' } };
    l.tickBubble(p, 0.4);
    t.ok(p.bubble, 'still there'); t.near(p.bubble.ttl, 0.6, 1e-9, 'ttl');
    l.tickBubble(p, 0.6);
    t.eq(p.bubble, null, 'null at ttl 0');
    l.tickBubble(p, 0.1);
    t.eq(p.bubble, null, 'null stays null');
    const q = { bubble: { text: 'x', ttl: 0.1, style: 'player' } };
    l.tickBubble(q, 1);
    t.eq(q.bubble, null, 'overshoot -> null');
  });

  t.test('formatShekels: thousands separators and negatives', () => {
    const l = L();
    const cases = [[2340, '₪ 2,340'], [0, '₪ 0'], [12, '₪ 12'], [999, '₪ 999'], [1000, '₪ 1,000'], [9000, '₪ 9,000'],
      [1234567, '₪ 1,234,567'], [-150, '-₪ 150'], [-2340, '-₪ 2,340'], [-1000000, '-₪ 1,000,000']];
    for (const [n, s] of cases) t.eq(l.formatShekels(n), s, 'formatShekels(' + n + ')');
  });

  // ---------------- spawn picking ----------------
  const corridor = (w, h) => { const rows = []; for (let y = 0; y < h; y++) rows.push('.'.repeat(w)); return S.gridFrom(rows); };
  const spot = (id, kind, tx, ty) => ({ id, name: id, kind, x: tc(tx), y: tc(ty) });
  const FAR = { x: -100000.5, y: -100000.5, w: 960, h: 540 };

  t.test('pickSpawnSpot: strict pick (distance 18..34, off-screen, kind filter)', () => {
    const l = L();
    const g = corridor(100, 5);
    const spots = [5, 10, 20, 30, 38, 45, 60].map((x) => spot('p' + x, 'park', x, 2)).concat([spot('b25', 'beach', 25, 2)]);
    for (let s = 0; s < 30; s++) {
      const r = l.pickSpawnSpot(g, spots, tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(s), null);
      t.ok(r && r.spot, 'returns a spot');
      t.eq(r.relax, 0, 'strict');
      t.ok(['p20', 'p30'].includes(r.spot.id), 'strict candidate, got ' + r.spot.id);
      t.eq(r.pathTiles, (r.spot.x - 16) / 32 - 2, 'pathTiles');
    }
    const b = l.pickSpawnSpot(g, spots, tc(2), tc(2), FAR, ['beach'], CFG, l.mulberry32(1), null);
    t.eq(b && b.spot.id, 'b25', 'kind filter');
    t.eq(b.pathTiles, 23, 'beach pathTiles');
  });

  t.test('pickSpawnSpot: path length is BFS tiles, not Euclidean', () => {
    const l = L();
    const rows = [];
    for (let y = 0; y < 9; y++) rows.push(y < 8 ? '..........#.............................' : '........................................');
    const g = S.gridFrom(rows);
    const r = l.pickSpawnSpot(g, [spot('s', 'park', 14, 1)], tc(2), tc(1), FAR, ['park'], CFG, l.mulberry32(1), null);
    t.ok(r, 'found');
    t.eq(r.pathTiles, 26, 'detour path length (Manhattan would be 12)');
    t.eq(r.relax, 0, 'strict');
  });

  t.test('pickSpawnSpot: relax 1 drops the off-screen rule only', () => {
    const l = L();
    const g = corridor(100, 5);
    const spots = [spot('a', 'park', 20, 2), spot('b', 'park', 30, 2), spot('far', 'park', 60, 2)];
    const r = l.pickSpawnSpot(g, spots, tc(2), tc(2), { x: 0, y: 0, w: 960, h: 540 }, ['park'], CFG, l.mulberry32(3), null);
    t.ok(r, 'found');
    t.eq(r.relax, 1, 'relax level');
    t.ok(r.spot.id === 'a' || r.spot.id === 'b', 'in 18..34, got ' + r.spot.id);
    // off-screen margin: 40px beyond the right edge is still "on screen" (+64 expansion); 100px is off.
    const one = [spot('a', 'park', 20, 2)]; // x = 656
    const near = l.pickSpawnSpot(g, one, tc(2), tc(2), { x: 656 - 960 - 40, y: 0, w: 960, h: 540 }, ['park'], CFG, l.mulberry32(3), null);
    t.eq(near && near.relax, 1, 'spot 40px outside view is within the 64px margin');
    const off = l.pickSpawnSpot(g, one, tc(2), tc(2), { x: 656 - 960 - 100, y: 0, w: 960, h: 540 }, ['park'], CFG, l.mulberry32(3), null);
    t.eq(off && off.relax, 0, 'spot 100px outside view is off-screen');
  });

  t.test('pickSpawnSpot: relax 2 widens distance to 8..40', () => {
    const l = L();
    const g = corridor(100, 5);
    const spots = [spot('n1', 'park', 3, 2), spot('a', 'park', 12, 2), spot('b', 'park', 41, 2), spot('n2', 'park', 50, 2)];
    for (let s = 0; s < 20; s++) {
      const r = l.pickSpawnSpot(g, spots, tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(s), null);
      t.ok(r, 'found');
      t.eq(r.relax, 2, 'relax level');
      t.ok(r.spot.id === 'a' || r.spot.id === 'b', 'in 8..40, got ' + r.spot.id);
      t.ok(r.pathTiles >= 8 && r.pathTiles <= 40, 'pathTiles ' + r.pathTiles);
    }
    const edge = l.pickSpawnSpot(g, [spot('e8', 'park', 10, 2)], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), null);
    t.eq(edge && edge.pathTiles, 8, 'exactly 8 tiles accepted');
    const edge40 = l.pickSpawnSpot(g, [spot('e40', 'park', 42, 2)], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), null);
    t.eq(edge40 && edge40.pathTiles, 40, 'exactly 40 tiles accepted');
  });

  t.test('pickSpawnSpot: null when nothing qualifies / unreachable / wrong kind / empty', () => {
    const l = L();
    const g = corridor(100, 5);
    const spots = [spot('n1', 'park', 3, 2), spot('n2', 'park', 9, 2), spot('n3', 'park', 43, 2), spot('n4', 'park', 70, 2)];
    t.eq(l.pickSpawnSpot(g, spots, tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), null), null, 'distances 1,7,41,68');
    t.eq(l.pickSpawnSpot(g, [], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), null), null, 'no spots');
    t.eq(l.pickSpawnSpot(g, [spot('a', 'park', 20, 2)], tc(2), tc(2), FAR, ['beach'], CFG, l.mulberry32(1), null), null, 'no spot of kind');
    const rows = [];
    for (let y = 0; y < 5; y++) rows.push('...............#' + '.'.repeat(84));
    const walled = S.gridFrom(rows);
    t.eq(l.pickSpawnSpot(walled, [spot('a', 'park', 20, 2), spot('b', 'park', 30, 2)], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), null), null, 'unreachable behind a wall');
  });

  t.test('pickSpawnSpot: kinds null means any kind (utility)', () => {
    const l = L();
    const g = corridor(100, 5);
    const r = l.pickSpawnSpot(g, [spot('a', 'beach', 20, 2), spot('b', 'alley', 25, 2)], tc(2), tc(2), FAR, null, CFG, l.mulberry32(1), null);
    t.ok(r && (r.spot.id === 'a' || r.spot.id === 'b'), 'a spot of any kind');
    t.eq(r.relax, 0, 'strict');
  });

  t.test('pickSpawnSpot: excludeId is never returned', () => {
    const l = L();
    const g = corridor(100, 5);
    for (let s = 0; s < 30; s++) {
      const r = l.pickSpawnSpot(g, [spot('a', 'park', 20, 2), spot('b', 'park', 30, 2)], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(s), 'a');
      t.eq(r && r.spot.id, 'b', 'excluded a');
    }
    t.eq(l.pickSpawnSpot(g, [spot('a', 'park', 20, 2), spot('z', 'park', 70, 2)], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), 'a'), null, 'only candidate excluded -> null');
  });

  t.test('pickSpawnSpot: 300 random worlds agree with the spec oracle', () => {
    const l = L();
    const rng = l.mulberry32(99);
    const kindsAll = S.SPOT_KINDS;
    const bad = [];
    let seenRelax = [0, 0, 0, 0];
    for (let k = 0; k < 300 && bad.length < 5; k++) {
      const w = 60, h = 40, rows = [];
      for (let y = 0; y < h; y++) { let s = ''; for (let x = 0; x < w; x++) s += rng() < 0.22 ? '#' : '.'; rows.push(s); }
      const g = S.gridFrom(rows);
      const free = [];
      for (let i = 0; i < w * h; i++) if (!g.solid[i]) free.push(i);
      const pick = () => free[Math.floor(rng() * free.length)];
      const pi = pick(), ptx = pi % w, pty = Math.floor(pi / w);
      const spots = [];
      for (let i = 0; i < 25; i++) { const si = pick(); spots.push(spot('s' + i, kindsAll[Math.floor(rng() * 8)], si % w, Math.floor(si / w))); }
      const kinds = kindsAll.filter(() => rng() < 0.5);
      const cam = { x: Math.floor(rng() * 1500) - 400 + 0.5, y: Math.floor(rng() * 900) - 300 + 0.5, w: 960, h: 540 };
      const excl = rng() < 0.5 ? spots[Math.floor(rng() * spots.length)].id : null;
      const d = S.bfs(g, ptx, pty);
      const off = (sp) => sp.x < cam.x - 64 || sp.x > cam.x + cam.w + 64 || sp.y < cam.y - 64 || sp.y > cam.y + cam.h + 64;
      const pd = (sp) => d[Math.floor(sp.y / 32) * w + Math.floor(sp.x / 32)];
      const base = spots.filter((sp) => kinds.includes(sp.kind) && sp.id !== excl && pd(sp) >= 0);
      const lv = [
        base.filter((sp) => pd(sp) >= 18 && pd(sp) <= 34 && off(sp)),
        base.filter((sp) => pd(sp) >= 18 && pd(sp) <= 34),
        base.filter((sp) => pd(sp) >= 8 && pd(sp) <= 40),
      ];
      const expRelax = lv[0].length ? 0 : lv[1].length ? 1 : lv[2].length ? 2 : null;
      const r = l.pickSpawnSpot(g, spots, tc(ptx) + 5, tc(pty) - 3, cam, kinds, CFG, l.mulberry32(k), excl);
      seenRelax[expRelax == null ? 3 : expRelax]++;
      if (expRelax == null) { if (r !== null) bad.push('world ' + k + ': expected null, got ' + JSON.stringify(r && r.spot)); continue; }
      if (!r) { bad.push('world ' + k + ': expected relax ' + expRelax + ', got null'); continue; }
      if (r.relax !== expRelax) bad.push('world ' + k + ': relax ' + r.relax + ' expected ' + expRelax);
      if (!lv[expRelax].includes(r.spot)) bad.push('world ' + k + ': spot ' + r.spot.id + ' not a level-' + expRelax + ' candidate');
      if (r.pathTiles !== pd(r.spot)) bad.push('world ' + k + ': pathTiles ' + r.pathTiles + ' oracle ' + pd(r.spot));
    }
    t.none(bad, 'oracle mismatch');
    t.ok(seenRelax.every((n) => n > 0), 'fuzz covered all outcomes (strict/relax1/relax2/null = ' + seenRelax.join('/') + ')');
  });

  t.test('pickSpawnSpot / bfsTiles are pure: no PE.city access', () => {
    const l = L();
    const saved = Object.getOwnPropertyDescriptor(PE, 'city');
    let touched = false;
    Object.defineProperty(PE, 'city', { configurable: true, get() { touched = true; return saved && saved.value; } });
    try {
      const g = corridor(60, 5);
      l.bfsTiles(g, 0, 0, 100);
      l.pickSpawnSpot(g, [spot('a', 'park', 22, 2)], tc(2), tc(2), FAR, ['park'], CFG, l.mulberry32(1), null);
      l.moveAndCollide(g, 50, 50, 3, 3, 7, 32);
    } finally {
      if (saved) Object.defineProperty(PE, 'city', saved); else delete PE.city;
    }
    t.ok(!touched, 'logic read PE.city');
  });
};
