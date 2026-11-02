// HUSH MONEY v2 "night" - data-shape, stealth-rule, scoring and block-criteria tests (docs/06). Owner: QA.
// Expected values come from docs/06 (tests/night.spec.js). The API is the one eng-lead pinned in js/stealth.js
// and design-writer pinned in js/night-data.js. Night files load into a fresh vm context (tests/night-lib.js).
// Anything not built yet SKIPS ("file missing" / "contract pending") so the suite stays green while v2 is built.
'use strict';
const fs = require('fs');
const path = require('path');
const NL = require('./night-lib.js');
const S0 = require('./spec.js');
const { NIGHT, LEVELS, mOf } = require('./night.spec.js');

module.exports = (t) => {
  const ROOT = t.ROOT, JS = path.join(ROOT, 'js');
  const exists = (f) => fs.existsSync(path.join(JS, f + '.js'));
  const need = (...files) => { const miss = files.filter((f) => !exists(f)); if (miss.length) t.skip('SKIPPED (file missing: ' + miss.map((f) => 'js/' + f + '.js').join(', ') + ')'); };
  let ctx = null;
  const night = () => {
    if (!ctx) ctx = NL.load(ROOT);
    const bad = Object.keys(ctx.status).filter((k) => /^error/.test(ctx.status[k]));
    if (bad.length) t.fail('night context failed to load: ' + bad.map((k) => k + ' ' + ctx.status[k]).join('; '));
    return ctx.PE;
  };
  const pending = (what) => t.skip('SKIPPED (contract pending: ' + what + ')');
  const TILE = 32, tc = (v) => v * TILE + 16;

  // --------------------------------------------------------------- adapters
  function cityNight(PE) {
    const c = PE.city;
    if (!c || typeof c.init !== 'function') pending('city.init');
    c.init({ night: true });
    if (!Array.isArray(c.lights)) pending('city.lights after city.init({night:true})');
    return c;
  }
  const inDistrict = (s) => { const D = NIGHT.DISTRICT; return s.x >= D.x0 * TILE && s.x < (D.x1 + 1) * TILE && s.y >= D.y0 * TILE && s.y < (D.y1 + 1) * TILE; };
  // stealth.js (eng-lead): init(city,cfg), los(a,b), lightAt(x,y,env), seen(w,p,env), inCone(w,x,y,fov,range),
  // suspicionStep(s,dt,info,tab), suspicionState(s), angleScore(o). Module state: one world per init().
  function stealthApi(PE) {
    const S = PE.stealth;
    if (!S) pending('PE.stealth');
    for (const f of ['init', 'los', 'lightAt', 'seen', 'suspicionStep', 'angleScore']) if (typeof S[f] !== 'function') pending('stealth.' + f);
    return S;
  }
  function world(solids, cover, lights) {
    const w = 20, h = 12, tile = new Uint8Array(w * h), solid = new Uint8Array(w * h);
    for (const [x, y] of solids || []) solid[y * w + x] = 1;
    for (const c of cover || []) for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) solid[y * w + x] = 1;
    return { grid: { w, h, tile, solid }, cover: cover || [], lights: lights || [] };
  }
  const W0 = { x: tc(5), y: tc(6), dir: 2 };          // watcher facing east (dir 2 = E)
  const at = (deg, d) => ({ x: W0.x + Math.cos(deg * Math.PI / 180) * d, y: W0.y + Math.sin(deg * Math.PI / 180) * d });
  const ENV = (amb, lamp, caseNo) => ({ ambient: amb, ambientColor: '#000000', lampLevel: lamp == null ? 1 : lamp, caseNo: caseNo == null ? 6 : caseNo });

  // =============================================================== night-data.js (design-writer)
  t.test('night data: CASES ramp (ambient 0.90/0.75/0.55/0.35/0.20/0.12, lamps from case 3, watchers 1/1/1/2/2/2), CFG RISE 13 FALL 8 spawn 14-28', () => {
    need('night-data');
    const N = night().NIGHT;
    if (!N || !Array.isArray(N.CASES)) pending('PE.NIGHT.CASES');
    t.eq(N.CASES.map((c) => c.ambient), NIGHT.AMBIENT_BY_CASE.slice(), 'ambient by case');
    t.eq(N.CASES.map((c) => c.watchers), NIGHT.WATCHERS_BY_CASE.slice(), 'watchers by case');
    t.eq(1 + N.CASES.findIndex((c) => c.lampLevel > 0), NIGHT.LAMPS_FROM_CASE, 'lamps on from case');
    t.ok(N.CASES.every((c) => c.lampLevel >= 0 && c.lampLevel <= 1 && /^#[0-9a-fA-F]{6}$/.test(c.ambientColor)), 'lampLevel 0..1, ambientColor #rrggbb');
    t.eq([N.CFG.RISE, N.CFG.FALL, N.CFG.SPAWN_MIN_TILES, N.CFG.SPAWN_MAX_TILES], [NIGHT.RISE, NIGHT.FALL, NIGHT.SPAWN_MIN_TILES, NIGHT.SPAWN_MAX_TILES], 'CFG overrides');
    for (let c = 1; c <= 6; c++) t.eq(N.envForCase(c).ambient, NIGHT.AMBIENT_BY_CASE[c - 1], 'envForCase(' + c + ')');
    t.eq(N.envForCase(0).ambient, NIGHT.AMBIENT_BY_CASE[0], 'envForCase clamps low'); t.eq(N.envForCase(9).ambient, NIGHT.AMBIENT_BY_CASE[5], 'envForCase clamps high');
  });

  t.test('night data: DETECT / SUSPICION / ANGLE tables match 06 dec. 4-5 (and the stealth.js key names)', () => {
    need('night-data');
    const N = night().NIGHT;
    t.eq([N.DETECT.CONE_DEG, N.DETECT.CONE_LEN, N.DETECT.AMBIENT_LIT, N.DETECT.LIGHT_MIN], [NIGHT.CONE_DEG, NIGHT.CONE_LEN, NIGHT.AMBIENT_DAYLIKE, NIGHT.LOCAL_LIT], 'DETECT');
    t.eq([N.DETECT.fov, N.DETECT.range, N.DETECT.ambientAll, N.DETECT.litMin], [NIGHT.CONE_DEG, NIGHT.CONE_LEN, NIGHT.AMBIENT_DAYLIKE, NIGHT.LOCAL_LIT], 'DETECT aliases read by stealth.js');
    t.eq([N.SUSPICION.MAX, N.SUSPICION.UNEASY, N.SUSPICION.CAGEY, N.SUSPICION.ABORT], [100, NIGHT.SUSP_UNEASY, NIGHT.SUSP_CAGEY, 100], 'suspicion thresholds');
    t.eq(N.ANGLE.W, Object.assign({}, NIGHT.W), 'angle weights');
    t.eq([N.ANGLE.BASE, N.ANGLE.SCALE, N.ANGLE.PHOTO_CONE_DEG], [0.5, 0.5, NIGHT.PHOTO_CONE_DEG], 'M = 0.5 + 0.5*A, 70 deg photo cone');
    t.eq(N.M.w, N.ANGLE.W, 'stealth M.w is the same table');
    for (const s of [0, 34.9, 35, 64.9, 65, 99.9, 100]) t.eq(N.stateFor(s), s >= 100 ? 'abort' : s >= 65 ? 'cagey' : s >= 35 ? 'uneasy' : 'calm', 'stateFor(' + s + ')');
    const rnd = (k) => ((k * 2654435761) % 1000) / 999;
    for (let k = 1; k < 200; k++) { const c = { frame: rnd(k), los: rnd(k + 7), lit: rnd(k + 13), dist: rnd(k + 29), faces: rnd(k + 31) }; t.near(N.angleM(c), mOf(c), 1e-9, 'angleM sample ' + k); }
    t.eq(N.angleM({}), 0.5, 'angleM of nothing'); t.eq(N.angleM({ frame: 1, los: 1, lit: 1, dist: 1, faces: 1 }), 1, 'angleM perfect');
  });

  t.test('night data: STAGING for exactly the 5 night scandals, watcher entries valid, LINES and TIPS follow v1 text rules', () => {
    need('night-data');
    const PE = night(), N = PE.NIGHT, bad = [];
    t.eq(Object.keys(N.STAGING).sort(), NIGHT.SCANDALS.slice().sort(), 'STAGING ids');
    const defs = {}; for (const d of PE.SCANDALS || []) defs[d.id] = d;
    const kinds = ['fixed', 'sweep', 'patrol', 'glance'];
    for (const id of NIGHT.SCANDALS) {
      const st = N.STAGING[id], d = defs[id];
      if (!d) { bad.push(id + ': no v1 def'); continue; }
      if (!Array.isArray(st.watchers) || st.watchers.length < 2) bad.push(id + ': needs >= 2 watchers (cases 4-6 use 2)');
      (st.watchers || []).forEach((w, i) => {
        const tag = id + '.watchers[' + i + ']';
        if (typeof w.role === 'number') { if (!(w.role >= 0 && w.role < d.roles.length)) bad.push(tag + ': role ' + w.role + ' out of range'); }
        else if (!(typeof w.name === 'string' && typeof w.dx === 'number' && typeof w.dy === 'number' && Math.abs(w.dx) <= 40 && Math.abs(w.dy) <= 40)) bad.push(tag + ': extra person needs name + |dx|,|dy| <= 40');
        if (!w.scan || !kinds.includes(w.scan.kind)) bad.push(tag + ': scan.kind ' + (w.scan && w.scan.kind));
        if (w.scan && w.scan.kind === 'glance') for (const [a, b] of w.scan.spans || []) if (!(a < b && b <= NIGHT.RISE)) bad.push(tag + ': glance span ' + a + '..' + b);
      });
      const L = N.LINES[id];
      if (!L) { bad.push(id + ': no LINES'); continue; }
      for (const k of ['uneasy', 'cagey', 'abort']) {
        const l = L[k];
        if (!l || typeof l.s !== 'string') { bad.push(id + '.' + k + ' missing'); continue; }
        if ((typeof l.r === 'number') === (typeof l.w === 'number')) bad.push(id + '.' + k + ': exactly one of r / w');
        if (typeof l.r === 'number' && !(l.r >= 0 && l.r < d.roles.length)) bad.push(id + '.' + k + ': r out of range');
        if (typeof l.w === 'number' && !(l.w >= 0 && l.w < st.watchers.length)) bad.push(id + '.' + k + ': w out of range');
        if (l.s.length > 48 || S0.HEBREW_RE.test(l.s) || S0.EMOJI_RE.test(l.s) || /[^\x20-\x7E]/.test(l.s)) bad.push(id + '.' + k + ': text rules: "' + l.s + '"');
      }
      const tip = N.TIPS[id];
      if (typeof tip !== 'string' || tip.split('{area}').length !== 2 || tip.length > 40) bad.push(id + ': tip "' + tip + '" (needs one {area}, <= 40 chars)');
    }
    t.none(bad, 'night staging / text');
    for (const r of [{}, { n: 4, inFrame: 4, los: 1, lit: 1, d: 99999, facing: 4, M: 1 }, { n: 99, inFrame: 99, los: 0.333, lit: 0.666, d: 2400, facing: 99, M: 0.5 }]) {
      const s = N.breakdown(r);
      t.ok(typeof s === 'string' && s.length <= 48, 'breakdown <= 48 chars: "' + s + '"');
    }
    t.eq(N.watchersFor('bribe', 1).length, 1, 'watchersFor case 1'); t.eq(N.watchersFor('bribe', 6).length, 2, 'watchersFor case 6'); t.eq(N.watchersFor('nope', 3), [], 'watchersFor unknown');
  });

  // =============================================================== city.js night mode (world-artist)
  t.test('city night: lights shape {x,y,r,color,intensity,kind,fromCase}, >= 20 in the district, inside the map', () => {
    need('city');
    const c = cityNight(night()), bad = [];
    c.lights.forEach((L, i) => {
      for (const k of ['x', 'y', 'r', 'intensity', 'fromCase']) if (typeof L[k] !== 'number' || !isFinite(L[k])) bad.push('light ' + i + '.' + k + ' = ' + L[k]);
      if (!/^#[0-9a-fA-F]{6}$/.test(L.color)) bad.push('light ' + i + '.color ' + L.color);
      if (!NIGHT.LIGHT_KINDS.includes(L.kind)) bad.push('light ' + i + ' kind ' + L.kind);
      if (!(L.r > 0) || !(L.intensity > 0 && L.intensity <= 1)) bad.push('light ' + i + ' r/intensity out of range');
      if (!(Number.isInteger(L.fromCase) && L.fromCase >= 1 && L.fromCase <= 6)) bad.push('light ' + i + ' fromCase ' + L.fromCase);
      if (!(L.x >= 0 && L.x <= 96 * TILE && L.y >= 0 && L.y <= 64 * TILE)) bad.push('light ' + i + ' outside map');
    });
    t.none(bad, 'lights');
    const inD = c.lights.filter(inDistrict).length;
    t.ok(inD >= NIGHT.MIN_LIGHTS, 'lights in district >= ' + NIGHT.MIN_LIGHTS + ' (got ' + inD + ')');
    t.ok(c.lights.some((L) => L.fromCase >= NIGHT.LAMPS_FROM_CASE && L.kind === 'lamp'), 'street lamps come on from case 3');
  });

  t.test('city night: cover shape {x,y,w,h,kind,blocksSight} (tiles), solid in night mode only, clear of spot 3x3', () => {
    need('city');
    const PE = night(), c = cityNight(PE);
    if (!Array.isArray(c.cover)) pending('city.cover');
    const g = c.grid, spots = c.spots.filter(inDistrict), bad = [];
    c.cover.forEach((k, i) => {
      for (const f of ['x', 'y', 'w', 'h']) if (!Number.isInteger(k[f]) || (f.length === 1 && 0) ) bad.push('cover ' + i + '.' + f + ' not an integer tile value');
      if (typeof k.blocksSight !== 'boolean') bad.push('cover ' + i + '.blocksSight not boolean');
      if (typeof k.kind !== 'string') bad.push('cover ' + i + '.kind missing');
      for (let y = k.y; y < k.y + k.h; y++) for (let x = k.x; x < k.x + k.w; x++) {
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) { bad.push('cover ' + i + ' outside map'); continue; }
        if (!g.solid[y * g.w + x]) bad.push('cover ' + i + ' tile ' + x + ',' + y + ' not solid in night mode');
        for (const s of spots) { const sx = Math.floor(s.x / TILE), sy = Math.floor(s.y / TILE); if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) bad.push('cover ' + i + ' inside spot ' + s.id + ' 3x3'); }
      }
    });
    t.none(bad, 'cover');
    t.ok(c.cover.length >= NIGHT.MIN_COVER, 'cover pieces >= ' + NIGHT.MIN_COVER + ' (got ' + c.cover.length + ')');
    c.init();
    t.ok(c.cover === undefined && c.lights === undefined, 'plain init() removes the night keys');
  });

  t.test('city night: >= 8 night spots in the district, 3x3 walkable, every night scandal has >= 2 spots of its kinds, all reachable from every start', () => {
    need('city');
    const PE = night(), c = cityNight(PE), spots = c.spots.filter(inDistrict), g = c.grid, bad = [];
    t.ok(spots.length >= NIGHT.MIN_NIGHT_SPOTS, 'night spots in district >= 8 (got ' + spots.length + ' of ' + c.spots.length + ')');
    t.eq(spots.length, c.spots.length, 'all night spots inside the district');
    for (const d of (PE.SCANDALS || []).filter((x) => NIGHT.SCANDALS.includes(x.id))) {
      const n = spots.filter((s) => (d.kinds || []).includes(s.kind)).length;
      if (n < 2) bad.push(d.id + ': ' + n + ' night spots of kinds ' + JSON.stringify(d.kinds));
    }
    for (const s of spots) { const sx = Math.floor(s.x / TILE), sy = Math.floor(s.y / TILE); for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 1; x++) if (g.solid[y * g.w + x]) bad.push(s.id + ' 3x3 solid at ' + x + ',' + y); }
    const starts = c.playerStarts || [];
    t.ok(starts.length >= 1, 'night player starts');
    for (const p of starts) {
      if (!inDistrict(p)) bad.push('start ' + p.x + ',' + p.y + ' outside the district');
      const d = NL.bfs(g, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
      for (const s of spots) if (d[Math.floor(s.y / TILE) * g.w + Math.floor(s.x / TILE)] < 0) bad.push(s.id + ' unreachable from start ' + p.x + ',' + p.y);
    }
    t.none(bad, 'night spots');
  });

  t.test('city: v1 map unchanged - init() after init({night:true}) equals a fresh v1 init (no leakage)', () => {
    need('city');
    const fresh = NL.load(ROOT).PE.city;
    fresh.init();
    const snap = (c) => ({ solid: Array.from(c.grid.solid).join(''), tile: Array.from(c.grid.tile).join(','), spots: JSON.stringify(c.spots), poi: c.poi.length, starts: JSON.stringify(c.playerStarts), keys: Object.keys(c).sort().join(',') });
    const a = snap(fresh);
    const c = night().city;
    c.init({ night: true });
    c.init();
    const b = snap(c);
    for (const k of Object.keys(a)) t.ok(a[k] === b[k], 'city.' + k + ' differs after a night init then a v1 init');
  });

  // =============================================================== stealth.js rules (O1 c)
  t.test('stealth: ambient >= 0.5 - seen inside the 70 deg / 175 px cone with LOS, not outside it', () => {
    need('stealth');
    const S = stealthApi(night());
    const w = world(); S.init(w, { TILE: 32 });
    const env = ENV(0.9, 0, 1), see = (p) => !!S.seen(W0, p, env);
    t.eq(see(at(0, 96)), true, 'straight ahead, 96 px');
    t.eq(see(at(0, 173)), true, '173 px');
    t.eq(see(at(0, 178)), false, '178 px (beyond 175)');
    t.eq(see(at(33, 100)), true, '33 deg off-axis (inside +-35)');
    t.eq(see(at(-33, 100)), true, '-33 deg');
    t.eq(see(at(38, 100)), false, '38 deg off-axis (outside +-35)');
    t.eq(see(at(180, 60)), false, 'behind the watcher');
    for (let d = 0; d < 8; d++) {                      // every 8-way facing: 0 = N clockwise
      const a = (d * 45 - 90) * Math.PI / 180, p = { x: W0.x + Math.cos(a) * 100, y: W0.y + Math.sin(a) * 100 };
      t.eq(!!S.seen({ x: W0.x, y: W0.y, dir: d }, p, env), true, 'dir ' + d + ' sees straight ahead');
    }
    t.eq(!!S.seen({ x: W0.x, y: W0.y, faceA: Math.PI / 2 }, at(90, 100), env), true, 'faceA radians (south) sees south');
  });

  t.test('stealth: buildings and sight-blocking cover break LOS; low cover (blocksSight false) does not', () => {
    need('stealth');
    const S = stealthApi(night()), env = ENV(0.9, 0, 1), target = { x: tc(9), y: tc(6) };
    S.init(world([[7, 6]]), { TILE: 32 });
    t.eq(!!S.seen(W0, target, env), false, 'building tile between'); t.eq(!!S.los(W0, target), false, 'los through a building');
    S.init(world([], [{ x: 7, y: 6, w: 1, h: 1, kind: 'dumpster', blocksSight: true }]), { TILE: 32 });
    t.eq(!!S.seen(W0, target, env), false, 'blocksSight cover between');
    S.init(world([], [{ x: 7, y: 6, w: 1, h: 1, kind: 'bench', blocksSight: false }]), { TILE: 32 });
    t.eq(!!S.seen(W0, target, env), true, 'low cover does not hide');
    S.init(world(), { TILE: 32 });
    t.eq(!!S.los(W0, target), true, 'los in the open');
    t.eq(!!S.los(target, W0), true, 'los is symmetric');
  });

  t.test('stealth: night (ambient < 0.5) - in cone + LOS is seen only where local light >= 0.35', () => {
    need('stealth');
    const S = stealthApi(night()), target = at(0, 96), far = at(0, 182);
    const lamp = [{ x: target.x, y: target.y - 8, r: 96, color: '#ffd28a', intensity: 1, kind: 'lamp', fromCase: 1 }, { x: far.x, y: far.y, r: 96, color: '#ffd28a', intensity: 1, kind: 'lamp', fromCase: 1 }];
    for (const L of LEVELS.filter((l) => l.ambient < 0.5)) {
      const env = ENV(L.ambient, L.lampLevel, 6);
      S.init(world(), { TILE: 32 });
      t.eq(!!S.seen(W0, target, env), false, L.name + ': dark target unseen');
      S.init(world([], [], lamp), { TILE: 32 });
      const lv = S.lightAt(target.x, target.y, env);
      t.ok(lv >= NIGHT.LOCAL_LIT, L.name + ': lamp makes local light >= 0.35 (got ' + lv.toFixed(3) + ')');
      t.eq(!!S.seen(W0, target, env), true, L.name + ': lit target seen');
      t.ok(S.lightAt(far.x, far.y, env) >= NIGHT.LOCAL_LIT, L.name + ': far point lit'); t.eq(!!S.seen(W0, far, env), false, L.name + ': lit but beyond 175 px unseen');
    }
    S.init(world(), { TILE: 32 });
    for (const L of LEVELS.filter((l) => l.ambient >= 0.5)) t.eq(!!S.seen(W0, target, ENV(L.ambient, L.lampLevel, 3)), true, L.name + ': ambient >= 0.5 sees without lamps');
    t.eq(!!S.seen(W0, target, ENV(0.5, 0, 3)), true, 'ambient exactly 0.5 counts as lit');
    t.eq(!!S.seen(W0, target, ENV(0.49, 0, 3)), false, 'ambient 0.49 in the dark: unseen');
  });

  t.test('stealth: light grid - fromCase gating, lampLevel 0 = off, values 0..1, buildings occlude, pinned falloff i*(1-smoothstep(d/r))', () => {
    need('stealth');
    const S = stealthApi(night());
    const lamp = { x: tc(4), y: tc(6), r: 128, color: '#ffffff', intensity: 0.9, kind: 'lamp', fromCase: 3 };
    S.init(world([[8, 4], [8, 5], [8, 6], [8, 7], [8, 8]], [], [lamp]), { TILE: 32 });
    const near = S.lightAt(tc(4), tc(7), ENV(0.12, 1, 6));
    t.ok(near >= NIGHT.LOCAL_LIT && near <= 1, 'lit next to the lamp (' + near.toFixed(3) + ')');
    t.ok(S.lightAt(tc(4), tc(7), ENV(0.12, 0, 6)) < 1e-9, 'lampLevel 0: lamp off');
    t.ok(S.lightAt(tc(4), tc(7), ENV(0.12, 1, 2)) < 1e-9, 'case 2 < fromCase 3: lamp off');
    t.ok(S.lightAt(tc(4), tc(7), ENV(0.12, 1, 3)) > 0, 'case 3 >= fromCase 3: lamp on');
    t.ok(S.lightAt(tc(9), tc(6), ENV(0.12, 1, 6)) < 1e-9, 'wall occludes the lamp');
    const bad = [];
    for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) { const v = S.lightAt(tc(x), tc(y), ENV(0.12, 1, 6)); if (!(v >= 0 && v <= 1)) bad.push(x + ',' + y + ' = ' + v); }
    t.none(bad, 'light values in 0..1');
    // Dana's ruling (M1): falloff = intensity * (1 - smoothstep(d/r)) for d < r; stealth.js is the single source,
    // light.js must use the identical function (the light-agreement test checks the visual side)
    const pin = [];
    for (const [x, y] of [[4, 7], [5, 6], [6, 6], [4, 9], [6, 8]]) {
      const d = Math.hypot(tc(x) - lamp.x, tc(y) - lamp.y), u = Math.min(1, d / lamp.r), want = d < lamp.r ? lamp.intensity * (1 - u * u * (3 - 2 * u)) : 0;
      const got = S.lightAt(tc(x), tc(y), ENV(0.12, 1, 6));
      if (Math.abs(got - want) > 0.02) pin.push('tile ' + x + ',' + y + ' d=' + d.toFixed(0) + ': lightAt ' + got.toFixed(3) + ' vs pinned ' + want.toFixed(3));
    }
    t.none(pin, 'stealth falloff vs the ruled i*(1-smoothstep(d/r))');
  });

  t.test('stealth: occluders per city.js (Dana M1) - BUILDING, KIOSK and blocksSight cover block sight; other solids (trees, stalls) do not', () => {
    need('stealth', 'city');
    const PE = night(), S = stealthApi(PE), c = cityNight(PE), g = c.grid, T = c.T, W = g.w;
    S.init(c, PE.CFG);
    const across = (id) => {   // a straight run of tiles of kind id (all solid), walkable tile on both ends
      for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (g.tile[y * W + x] !== id || !g.solid[y * W + x] || g.tile[y * W + x - 1] === id) continue;
        let e = x; while (e < W - 1 && g.tile[y * W + e] === id && g.solid[y * W + e]) e++;
        if (e - x <= 8 && !g.solid[y * W + x - 1] && e < W && !g.solid[y * W + e]) return [{ x: tc(x - 1), y: tc(y) }, { x: tc(e), y: tc(y) }, x + '..' + (e - 1) + ',' + y];
      }
      for (let x = 1; x < W - 1; x++) for (let y = 1; y < g.h - 1; y++) {
        if (g.tile[y * W + x] !== id || !g.solid[y * W + x] || g.tile[(y - 1) * W + x] === id) continue;
        let e = y; while (e < g.h - 1 && g.tile[e * W + x] === id && g.solid[e * W + x]) e++;
        if (e - y <= 8 && !g.solid[(y - 1) * W + x] && e < g.h && !g.solid[e * W + x]) return [{ x: tc(x), y: tc(y - 1) }, { x: tc(x), y: tc(e) }, x + ',' + y + '..' + (e - 1)];
      }
      return null;
    };
    const blockers = [['BUILDING', true], ['KIOSK', true], ['TREE', false], ['STALL', false], ['FALAFEL', false]];
    let checked = 0;
    for (const [name, blocks] of blockers) {
      if (T[name] === undefined) continue;
      const p = across(T[name]);
      if (!p) continue;
      checked++;
      t.eq(!!S.los(p[0], p[1]), !blocks, name + ' tile at ' + p[2] + (blocks ? ' blocks' : ' does not block') + ' sight');
    }
    const sightCover = c.cover.find((k) => k.blocksSight && k.w === 1);
    if (sightCover) { const y = sightCover.y, x = sightCover.x; if (!g.solid[y * W + x - 1] && !g.solid[y * W + x + 1]) { checked++; t.eq(!!S.los({ x: tc(x - 1), y: tc(y) }, { x: tc(x + 1), y: tc(y) }), false, 'blocksSight cover at ' + x + ',' + y + ' blocks sight'); } }
    t.ok(checked >= 3, 'occluder kinds checked (' + checked + ')');
  });

  t.test('stealth: suspicion 0..100, rises only while seen (40/s near, 20/s far, +20 on a shutter), never while unseen; thresholds 35/65/100', () => {
    need('stealth', 'night-data');
    const S = stealthApi(night()), dt = 1 / 60;
    let s = 0;
    for (let i = 0; i < 60; i++) s = S.suspicionStep(s, dt, { seen: true, dist: 40, unseenFor: 0 });
    t.near(s, 40, 1e-6, '1 s seen near (<= 60 px) = 40');
    s = 0; for (let i = 0; i < 60; i++) s = S.suspicionStep(s, dt, { seen: true, dist: 120, unseenFor: 0 });
    t.near(s, 20, 1e-6, '1 s seen far (60-175 px) = 20');
    t.near(S.suspicionStep(10, 0, { seen: true, dist: 120, photo: true }), 30, 1e-6, 'shutter while seen: +20');
    t.near(S.suspicionStep(10, 0, { seen: false, dist: 120, photo: true }), 10, 1e-6, 'shutter while unseen: no bump');
    let u = 50, prev = 50, rose = 0;
    for (let i = 0; i < 600; i++) { u = S.suspicionStep(u, dt, { seen: false, unseenFor: i * dt }); if (u > prev + 1e-12) rose++; prev = u; }
    t.eq(rose, 0, 'steps where suspicion rose while unseen');
    t.near(S.suspicionStep(50, 0.5, { seen: false, unseenFor: 0.5 }), 50, 1e-9, 'no decay before 1 s unseen');
    t.near(S.suspicionStep(50, 1, { seen: false, unseenFor: 2 }), 38, 1e-6, 'decay 12/s after 1 s unseen');
    let m = 0; for (let i = 0; i < 6000; i++) m = S.suspicionStep(m, dt, { seen: true, dist: 10 });
    t.eq(m, 100, 'clamped at 100');
    t.eq(S.suspicionStep(3, 10, { seen: false, unseenFor: 10 }), 0, 'clamped at 0');
    for (const v of [0, 34.9, 35, 64.9, 65, 99.9, 100]) t.eq(S.suspicionState(v), v >= 100 ? 'abort' : v >= 65 ? 'cagey' : v >= 35 ? 'uneasy' : 'calm', 'suspicionState(' + v + ')');
  });

  t.test('stealth: angleScore - M = 0.5 + 0.5*A with the 06 weights, terms 0..1; perfect shot M = 1; dist term matches PE.NIGHT.distTerm', () => {
    need('stealth', 'night-data');
    const PE = night(), S = stealthApi(PE), N = PE.NIGHT;
    S.init(world(), { TILE: 32 });
    const env = ENV(0.9, 0, 1), cam = { x: tc(5), y: tc(6), dir: 2 };
    const pair = (dx, dirs) => [{ x: cam.x + dx, y: cam.y - 8, dir: dirs[0] }, { x: cam.x + dx, y: cam.y + 8, dir: dirs[1] }];
    const best = S.angleScore(Object.assign({ subjects: pair(90, [6, 6]), env, range: 170 }, cam));
    t.near(best.M, 1, 1e-9, 'perfect: lit, in frame, LOS, 90 px, facing the camera');
    const bad = [], keys = ['frame', 'los', 'lit', 'dist', 'faces'];
    let k = 0;
    for (const dx of [20, 50, 60, 90, 120, 140, 165]) for (const dirs of [[6, 6], [2, 2], [6, 2]]) for (const facing of [2, 0, 4]) for (const amb of [0.9, 0.12]) {
      const r = S.angleScore({ x: cam.x, y: cam.y, dir: facing, subjects: pair(dx, dirs), env: ENV(amb, 1, 6), range: 170 }); k++;
      for (const f of keys) if (!(r[f] >= 0 && r[f] <= 1)) bad.push('dx ' + dx + ': ' + f + ' = ' + r[f]);
      if (Math.abs(r.M - mOf(r)) > 1e-9) bad.push('dx ' + dx + ': M ' + r.M + ' != 0.5+0.5*A ' + mOf(r));
      if (!(r.M >= 0.5 && r.M <= 1)) bad.push('M out of range ' + r.M);
      const md = Math.hypot(dx, 8);
      if (Math.abs(r.dist - N.distTerm(md)) > 1e-6) bad.push('dist term at ' + md.toFixed(0) + ' px: stealth ' + r.dist.toFixed(3) + ' vs PE.NIGHT.distTerm ' + N.distTerm(md).toFixed(3));
    }
    t.none(bad, 'angleScore over ' + k + ' setups');
  });

  t.test('scoring (06 dec. 4): points = timing x M; PERFECT at M=1 is 1500, M in [0.5, 1], perfect time from a bad angle = 750', () => {
    const all1 = { frame: 1, los: 1, lit: 1, dist: 1, faces: 1 }, all0 = { frame: 0, los: 0, lit: 0, dist: 0, faces: 0 };
    t.near(mOf(all1), 1, 1e-12, 'M at a perfect angle');
    t.near(mOf(all0), 0.5, 1e-12, 'M at the worst angle');
    t.eq(Math.round(1500 * mOf(all1)), 1500, 'PERFECT x M(1)');
    t.eq(Math.round(1500 * mOf(all0)), 750, 'PERFECT x M(0)');
    const W = NIGHT.W;
    t.near(W.frame + W.los + W.lit + W.dist + W.faces, 1, 1e-12, 'weights sum to 1');
  });

  // =============================================================== block criteria (static)
  t.test('block: index.html (v1) is untouched - same 10 scripts, no night file', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    t.eq(scripts, ['js/data.js', 'js/logic.js', 'js/art.js', 'js/city.js', 'js/npc.js', 'js/game.js', 'js/ui.js', 'js/sfx.js', 'js/touch.js', 'js/main.js'], 'index.html scripts');
    t.ok(!/night|stealth|light\.js/.test(html), 'index.html references no night file');
  });

  t.test('block: night.html loads the night stack and not the v1 boot', () => {
    const f = path.join(ROOT, 'night.html');
    if (!fs.existsSync(f)) t.skip('SKIPPED (file missing: night.html)');
    const html = fs.readFileSync(f, 'utf8');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    for (const s of ['js/stealth.js', 'js/night-data.js', 'js/night-game.js', 'js/light.js', 'js/night-main.js']) t.ok(scripts.includes(s), 'night.html loads ' + s);
    t.ok(!scripts.includes('js/main.js'), 'night.html must not load js/main.js (v1 boot)');
    t.ok(scripts.indexOf('js/night-main.js') === scripts.length - 1, 'night-main.js loads last');
  });

  t.test('block: night logic files - boilerplate, headless at load, no Math.random, stealth.js pure (no PE.city / DOM)', () => {
    const files = ['night-data', 'stealth', 'night-game'].filter(exists);
    if (!files.length) t.skip('SKIPPED (file missing: js/night-data.js, js/stealth.js, js/night-game.js)');
    const PE = night(), bad = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(JS, f + '.js'), 'utf8'), code = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      if (!/\(function \(PE\) \{\s*'use strict';/.test(src)) bad.push(f + '.js: boilerplate head');
      if (!/\}\)\(globalThis\.PE = globalThis\.PE \|\| \{\}\);\s*$/.test(src)) bad.push(f + '.js: boilerplate tail');
      if (/Math\.random\s*\(/.test(code)) bad.push(f + '.js: Math.random');
      if (ctx.status[f] !== 'loaded') bad.push(f + '.js: ' + ctx.status[f]);
    }
    if (exists('stealth')) {
      const code = fs.readFileSync(path.join(JS, 'stealth.js'), 'utf8').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      if (/PE\.city|document\.|window\./.test(code)) bad.push('stealth.js references PE.city / document / window (must be pure, data passed in)');
      if (!PE.stealth) bad.push('stealth.js did not define PE.stealth');
    }
    t.none(bad, 'night static rules');
  });

  // =============================================================== visual vs gameplay light (06 dec. 3)
  t.test('light agreement: light.js sampling hook vs stealth light grid agree lit/dark on >= 95% of district tile centres', () => {
    need('stealth', 'light', 'city');
    const lc = NL.load(ROOT, { dom: true, files: ['light'] });
    if (lc.status.light !== 'loaded') t.fail('light.js failed to load headlessly with a fake canvas: ' + lc.status.light);
    const PE = lc.PE, Lt = PE.light, S = PE.stealth;
    const sample = NL.pick(Lt, ['sampleAt', 'sample', 'lightAt', 'brightnessAt']);
    if (!sample) pending('light sampling hook (light.sampleAt)');
    const c = cityNight(PE);
    S.init(c, PE.CFG);
    if (typeof Lt.init === 'function') Lt.init(c, 'full');
    const D = NIGHT.DISTRICT, rows = [];
    for (let caseNo = 1; caseNo <= 6; caseNo++) {
      const e = PE.NIGHT.envForCase(caseNo), env = { ambient: e.ambient, ambientColor: e.ambientColor, lampLevel: e.lampLevel, caseNo };
      let n = 0, agree = 0;
      for (let y = D.y0; y <= D.y1; y++) for (let x = D.x0; x <= D.x1; x++) {
        if (c.grid.solid[y * c.grid.w + x]) continue;
        const sv = sample(tc(x), tc(y), env), lamp = sv && typeof sv === 'object' ? sv.lamp : sv;   // lamp light only (Dana: ambient is a separate visual remap)
        const g = S.lightAt(tc(x), tc(y), env) >= NIGHT.LOCAL_LIT, v = lamp >= NIGHT.LOCAL_LIT;
        n++; if (g === v) agree++;
      }
      rows.push('case ' + caseNo + ' ' + (100 * agree / n).toFixed(1) + '%');
      t.ok(agree / n >= 0.95, 'case ' + caseNo + ': agreement ' + (100 * agree / n).toFixed(1) + '% of ' + n + ' tiles (>= 95%)');
    }
    console.log('       info: light agreement ' + rows.join(', '));
  });
};
