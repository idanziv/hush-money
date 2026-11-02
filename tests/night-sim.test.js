// HUSH MONEY v2 "night" - stealth bots, determinism, photo scoring, spot photographability (docs/06, QA O1/O3). Owner: QA.
// (a) shadow-route bot: Dijkstra with cost 1 + 20*predicted exposure (sweep/glance/patrol/deal-glance forecast), wins every case unseen;
// (e) close bot: shoots from <= 120 px at the best predicted angle (M1 ruling 3);  (b) beeline bot: v1 straight
// walk, must get caught at night;  (d) determinism.  Rule tests (c) live in night.test.js.
// Env: HUSH_NIGHT_SEEDS (default 40; HUSH_NIGHT_FULL=1 = 200), QA_TRACE=<seed> (shadow trace), HUSH_NIGHT_BUDGET_MS (default 180000).  Skips until night-game.js lands.
'use strict';
const fs = require('fs');
const path = require('path');
const NL = require('./night-lib.js');
const { NIGHT, mOf } = require('./night.spec.js');

module.exports = (t) => {
  const ROOT = t.ROOT, JS = path.join(ROOT, 'js');
  const SEEDS = Math.max(1, +process.env.HUSH_NIGHT_SEEDS || (process.env.HUSH_NIGHT_FULL ? 200 : 40));   // full O1 run: HUSH_NIGHT_FULL=1
  const BUDGET = Math.max(2000, +process.env.HUSH_NIGHT_BUDGET_MS || 180000);   // forecast bots: ~60 s shadow at 40 seeds
  const DT = 1 / 60, TILE = 32, RANGE = 170;
  const exists = (f) => fs.existsSync(path.join(JS, f + '.js'));
  const pending = (w) => t.skip('SKIPPED (contract pending: ' + w + ')');
  let ctx = null, t0 = 0;
  const deadline = () => t0 + BUDGET;

  function setup() {
    const miss = ['stealth', 'night-game', 'night-data'].filter((f) => !exists(f));
    if (miss.length) t.skip('SKIPPED (file missing: ' + miss.map((f) => 'js/' + f + '.js').join(', ') + ')');
    if (!ctx) {
      t0 = Date.now();
      ctx = NL.load(ROOT);
      const bad = Object.keys(ctx.status).filter((k) => /^error/.test(ctx.status[k]));
      if (bad.length) t.fail('night context failed to load: ' + bad.map((k) => k + ' ' + ctx.status[k]).join('; '));
      // Math.random spy (seeded RNG only)
      const M = require('vm').runInContext('Math', ctx.sb), orig = M.random; ctx.rand = 0; ctx.inGame = false;
      M.random = function () { if (ctx.inGame) ctx.rand++; return orig(); };
    }
    const PE = ctx.PE, G = PE.nightGame || PE.ngame, S = PE.stealth;
    if (!G || typeof G.newRun !== 'function' || typeof G.update !== 'function') pending('PE.nightGame.newRun/update');
    if (!S) pending('PE.stealth');
    if (PE.city && PE.city.grid && !PE.city.night) PE.city.init({ night: true });   // night.html boots the night map
    // stealth.js API as pinned by eng-lead: los(a,b), seen(w,p,env), lightAt(x,y,env); world = last stealth.init(city)
    for (const f of ['los', 'seen', 'lightAt', 'init']) if (typeof S[f] !== 'function') pending('stealth.' + f);
    const A = { los: (g, cover, x0, y0, x1, y1) => S.los({ x: x0, y: y0 }, { x: x1, y: y1 }), canSee: (w, p, wd) => S.seen(w, p, wd.env) };
    return { PE, G, S, A };
  }

  // ---- state readers (night-game is a fork of v1 game; shapes per 06 "Key data shapes", pinned in M1 reports)
  const env = (s) => Object.assign({ ambient: 1, lampLevel: 0, caseNo: s.caseNo }, s.env || {});
  const watchers = (s) => s.watchers || (s.scandal && s.scandal.watchers) || [];
  const suspicion = (s) => +(s.suspicion != null ? s.suspicion : (s.scandal && s.scandal.suspicion) || 0);
  const lightGrid = () => null;   // stealth.js keeps its own grid (env-keyed cache)
  const KEYS = [['up'], ['up', 'right'], ['right'], ['down', 'right'], ['down'], ['down', 'left'], ['left'], ['up', 'left']];
  const IDLE = () => ({ up: false, down: false, left: false, right: false, sprint: false, photo: false });

  const CONE = NIGHT.CONE_LEN, TURN = 4.2, PSTEP = 0.1, HORIZON = 1.2;   // TURN = night-game TURN_RATE (rad/s)
  function exposed(W, x, y, ctxw) {   // would a person standing at (x,y) be seen by any (real or forecast) watcher?
    for (const w of W) { if (w.coneOn === false) continue; const dx = x - w.x, dy = y - w.y; if (dx * dx + dy * dy > CONE * CONE) continue; if (ctxw.A.canSee(w, { x, y }, ctxw.world)) return true; }
    return false;
  }
  // Forecast every watcher over the next HORIZON s (mirrors night-game stepWatchers: sweep + hold, glance spans,
  // patrol loop, DEAL_GLANCE turn to the deal, TURN_RATE head turn, x1.5 scan when uneasy). Returns fake cone-on watchers.
  function forecast(sc, PE, H) {
    const out = [], ND = PE.NIGHT || {}, G0 = ND.DEAL_GLANCE || { START: -1, DUR: 1.2, DUR_MIN: 1, DUR_MAX: 1.5 };
    const mult = sc.suspState === 'calm' || !sc.suspState ? 1 : +((ND.SUSPICION || {}).UNEASY_SCAN_MULT || 1.5);
    const ang = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    for (const w of sc.watchers || []) {
      const sk = w.scan || {}, kind = sk.kind || 'sweep', p = w.person || w;
      let fa = PE.stealth.facingAngle(w), sp = +w.sweepPos || 0, dir = w.sweepDir || 1, hold = +w.holdT || 0, u = +w.patrolU || 0, x = w.x, y = w.y, hd = w.base;
      const dur = Math.max(G0.DUR_MIN, Math.min(G0.DUR_MAX, w.dealGlance != null ? w.dealGlance : G0.DUR)), g0 = NIGHT.RISE + G0.START;
      if (w.coneOn !== false) out.push({ x, y, faceA: fa });
      for (let tau = PSTEP; tau <= H + 1e-9; tau += PSTEP) {
        const t = sc.t + tau; let target = w.base;
        if (kind === 'glance') { const on = (sk.spans || []).some((q) => t >= q[0] && t < q[1]); if (!on) { fa = PE.stealth.facingAngle(p); continue; } }
        else if (kind === 'sweep') {
          const half = (sk.arc != null ? sk.arc : 80) / 2;
          if (hold > 0) hold -= PSTEP;
          else { sp += dir * (sk.speed != null ? sk.speed : 20) * mult * PSTEP; if (sp >= half) { sp = half; dir = -1; hold = sk.hold || 0; } else if (sp <= -half) { sp = -half; dir = 1; hold = sk.hold || 0; } }
          target = w.base + sp * Math.PI / 180;
        } else if (kind === 'patrol' && !w.isActor && (sk.pts || []).length > 1) {
          const pts = sk.pts, n = pts.length; let tot = 0;
          for (let i = 0; i < n; i++) tot += Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
          u = (u + PSTEP * mult / Math.max(0.5, sk.period || 8)) % 1; let dd = u * tot;
          for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (dd <= L || i === n - 1) { const k = L > 0 ? Math.min(1, dd / L) : 0; x = sc.spot.x + a[0] + (b[0] - a[0]) * k; y = sc.spot.y + a[1] + (b[1] - a[1]) * k; hd = Math.atan2(b[1] - a[1], b[0] - a[0]); break; } dd -= L; }
          target = hd;
        }
        if (t >= g0 && t < g0 + dur) target = Math.atan2(sc.focus.y - y, sc.focus.x - x);
        const d = ang(target - fa), mt = TURN * PSTEP; fa += d > mt ? mt : (d < -mt ? -mt : d);
        out.push({ x, y, faceA: fa });
      }
    }
    return out;
  }

  // mode 'shadow' (O1 a), 'beeline' (O1 b) or 'close' (M1 ruling 3). Returns per-case records.
  function play(seed, mode, X) {
    const { PE, G, A } = X;
    ctx.inGame = true; G.newRun(seed); ctx.inGame = false;
    const city = PE.city, grid = city.grid, Wd = grid.w;
    const cases = [], stepsMax = Math.round(200 / DT);
    let sc0 = null, rec = null, route = null, replanT = 0, shot = false, faceSteps = 0, goal = -1, goalM = 0, FW = null;
    const sneaky = mode !== 'beeline';
    for (let i = 0; i < stepsMax; i++) {
      if ((i & 255) === 0 && Date.now() > deadline()) throw new Error('night sim budget exceeded');
      const s = G.state, sc = s.scandal, p = s.player, input = IDLE();
      if (sc && sc.status === 'live') {
        if (sc !== sc0) { sc0 = sc; rec = { def: sc.def.id, spot: sc.spot && sc.spot.id, ambient: env(s).ambient, maxSusp: 0, seenSteps: 0, steps: 0, litCone: 0, result: null, aborted: false }; cases.push(rec); route = null; shot = false; faceSteps = 0; goal = -1; goalM = 0; replanT = 0; FW = null; }
        const lg = lightGrid(s, PE, A);
        const ctxw = { A, world: { grid, cover: city.cover || [], light: lg, lightGrid: lg, env: env(s) } };
        const W = watchers(s), f = sc.focus;
        { // telemetry for staging: share of live time in an active cone (70 deg / CONE_LEN, LOS ignored) AND lit (night: lamp >= LOCAL_LIT)
          rec.steps++; const e = env(s);
          if ((e.ambient >= NIGHT.AMBIENT_DAYLIKE || X.S.lightAt(p.x, p.y, e) >= NIGHT.LOCAL_LIT) && W.some((w) => w.coneOn !== false && X.S.inCone(w, p.x, p.y, NIGHT.CONE_DEG, CONE))) rec.litCone++;
        }
        const reach = mode === 'close' ? 120 : RANGE - 12;
        const tx_ = (k) => (k % Wd) * TILE + 16, ty_ = (k) => Math.floor(k / Wd) * TILE + 16;
        const canShootFrom = (k) => { const x = tx_(k), y = ty_(k); return Math.hypot(x - f.x, y - f.y) <= reach && A.los(grid, city.cover || [], x, y, f.x, f.y); };
        const here = Math.floor(p.y / TILE) * Wd + Math.floor(p.x / TILE);
        if (sneaky && (replanT <= 0 || !FW)) FW = forecast(sc, PE, HORIZON);
        const memo = new Map(), risky = (k) => { let v = memo.get(k); if (v === undefined) { v = exposed(FW, tx_(k), ty_(k), ctxw); memo.set(k, v); } return v; };
        const camM = (k) => { const x = tx_(k), y = ty_(k), dir = PE.logic.dirFromVector(f.x - x, f.y - y); return PE.stealth.angleScore({ x, y, dir, subjects: sc.actors, env: env(s), range: RANGE }).M; };
        const atGoal = () => here === goal && Math.abs(p.x - tx_(here)) <= 2.5 && Math.abs(p.y - ty_(here)) <= 2.5;
        let hereOk = mode === 'close' ? atGoal() : canShootFrom(here) && !(sneaky && sc.t < NIGHT.RISE - 0.3 && exposed(FW, p.x, p.y, ctxw));
        if (!hereOk || (sneaky && replanT <= 0)) {
          if (!route || replanT <= 0) {
            replanT = 0.4;
            const cost = sneaky ? (k) => (risky(k) ? 20 : 0) : () => 0;
            const r = NL.dijkstra(grid, Math.floor(p.x / TILE), Math.floor(p.y / TILE), cost);
            let best = -1, bestV = -Infinity, hide = -1;
            for (let k = 0; k < r.dist.length; k++) {
              if (!(r.dist[k] < Infinity)) continue;
              if (!canShootFrom(k)) { if (mode === 'shadow' && !risky(k) && (hide < 0 || r.dist[k] < r.dist[hide])) hide = k; continue; }
              // beeline: cheapest shooting tile; shadow: forecast-safe first, then angle (M) vs path; close: best M (safe first)
              const v = mode === 'close' ? camM(k) - (risky(k) ? 0.5 : 0) - r.dist[k] * 1e-4 : mode === 'shadow' ? 100 * camM(k) - r.dist[k] - (risky(k) ? 1e4 : 0) : -r.dist[k];
              if (v > bestV) { bestV = v; best = k; }
            }
            // no safe shooting tile right now: wait in the nearest safe tile (until 1.5 s before the peak, then take the best shot)
            if (mode === 'shadow' && bestV < -5000 && hide >= 0 && sc.t < NIGHT.RISE - 1.5) best = hide;
            if (mode === 'close') { if (goal < 0 || bestV > goalM + 0.02 || !canShootFrom(goal)) { goal = best; goalM = bestV; } else best = goal; hereOk = atGoal(); }
            route = [];
            for (let k = best; k >= 0 && k !== here; k = r.prev[k]) route.unshift(k);
            if (best === here && !hereOk) route = [here];
          }
        }
        replanT -= DT;
        if (!hereOk && route && route.length) {
          let nx = route[0];
          const tx = (nx % Wd) * TILE + 16, ty = Math.floor(nx / Wd) * TILE + 16;
          if (Math.abs(tx - p.x) <= 2.5 && Math.abs(ty - p.y) <= 2.5) route.shift();
          const ex = tx - p.x, ey = ty - p.y;
          input.right = ex > 2.5; input.left = ex < -2.5; input.down = ey > 2.5; input.up = ey < -2.5;
        } else if (!shot) {
          // face the focus (facing = last move direction, 06 dec. 6), then shoot at the peak
          const want = PE.logic.dirFromVector(f.x - p.x, f.y - p.y);
          input.face = want;   // turn in place (touch facing input, night-game) - walking keys would step off the tile
          if (sc.t >= NIGHT.RISE - DT) { input.photo = true; shot = true; }
        }
      }
      const prevSc = sc;
      ctx.inGame = true; G.update(DT, input); ctx.inGame = false;
      const s2 = G.state;
      if (rec && prevSc && prevSc.status === 'live') {
        const v = suspicion(s2);
        if (process.env.QA_TRACE && v > rec.maxSusp + 1e-9 && +process.env.QA_TRACE === seed && mode === 'shadow') console.log('         trace ' + rec.def + ' t ' + prevSc.t.toFixed(2) + ' susp ' + v.toFixed(1) + ' p ' + Math.round(s2.player.x) + ',' + Math.round(s2.player.y) + ' focus ' + Math.round(prevSc.focus.x) + ',' + Math.round(prevSc.focus.y) + ' photo ' + !!input.photo + ' W ' + watchers(s2).map((w) => (w.scan || {}).kind + (w.coneOn === false ? '-off' : '') + '@' + Math.round(w.x) + ',' + Math.round(w.y) + '/' + Math.round(X.S.facingAngle(w) * 57.3)).join(' '));
        if (v > rec.maxSusp) rec.maxSusp = v;
      }
      if (process.env.QA_TRACE && +process.env.QA_TRACE === seed && mode === 'shadow' && rec && prevSc && prevSc.status === 'live' && (input.photo || Math.abs(prevSc.t - NIGHT.RISE + 3) < DT / 2)) console.log('         trace ' + rec.def + ' t ' + prevSc.t.toFixed(2) + ' photo ' + !!input.photo + ' shot ' + shot + ' p ' + Math.round(s2.player.x) + ',' + Math.round(s2.player.y) + ' d ' + Math.round(Math.hypot(s2.player.x - prevSc.focus.x, s2.player.y - prevSc.focus.y)) + ' route ' + (route ? route.length : '-') + ' ev ' + JSON.stringify((s2.events || []).map((e) => e.type + ':' + (e.result ? e.result.kind : ''))));
      for (const e of s2.events || []) {
        if (e.type === 'photo' && rec && e.result && e.result.kind === 'scored') rec.result = e.result;
        if ((e.type === 'abort' || (e.type === 'resolve' && e.status === 'aborted')) && rec) rec.aborted = true;
      }
      if (s2.phase === 'over' || s2.over) break;
    }
    return { cases, results: (G.state.results || []).map((r) => ({ id: r.defId, points: r.points, label: r.label })), score: G.state.score };
  }

  const bucket = (amb) => (amb >= 0.75 ? 'dusk' : amb >= 0.5 ? 'mid' : 'night');
  const runs = { shadow: [], beeline: [], close: [] };
  // per-spot table for staging: beeline abort % at night + share of live time lit & coned
  function spotTable(rs, title) {
    const T = {};
    for (const r of rs) for (const c of r.cases) { const k = c.spot || '?', b = bucket(c.ambient), o = T[k] || (T[k] = { n: 0, nn: 0, ab: 0, lc: 0, st: 0, lcn: 0, stn: 0, defs: new Set() }); o.n++; o.defs.add(c.def); o.lc += c.litCone; o.st += c.steps; if (b === 'night') { o.nn++; o.lcn += c.litCone; o.stn += c.steps; if (c.aborted) o.ab++; } }
    console.log('       info: ' + title + ' per spot: spot  night-abort%(n)  lit+coned% night/all  defs');
    for (const k of Object.keys(T).sort()) { const o = T[k]; console.log('         ' + k.padEnd(18) + ((o.nn ? (100 * o.ab / o.nn).toFixed(0) + '%' : '-') + '(' + o.nn + ')').padEnd(10) + ((o.stn ? (100 * o.lcn / o.stn).toFixed(0) : '-') + '/' + (o.st ? (100 * o.lc / o.st).toFixed(0) : '-') + '%').padEnd(10) + [...o.defs].join(',')); }
  }
  let done = 0, budgetHit = '';

  const resetBudget = () => { t0 = Date.now(); };
  t.test('night bot (O1 a): shadow-route bot wins every case unseen (suspicion < 50, no abort, M >= 0.8) at every light level', () => {
    const X = setup();
    const bad = [], combos = new Set();
    for (let seed = 1; seed <= SEEDS; seed++) {
      let r;
      try { r = play(seed, 'shadow', X); } catch (e) { if (/budget/.test(e.message)) { budgetHit = e.message; break; } throw e; }
      runs.shadow.push(r); done++;
      for (const c of r.cases) {
        combos.add(c.def + '/' + bucket(c.ambient));
        const tag = 'seed ' + seed + ' ' + c.def + ' (' + bucket(c.ambient) + ') @' + c.spot;
        if (c.aborted) bad.push(tag + ': ABORTED');
        else if (!c.result) bad.push(tag + ': no scored photo');
        else if (c.maxSusp >= 50) bad.push(tag + ': suspicion reached ' + c.maxSusp.toFixed(0));
        else if (c.result.M != null && c.result.M < 0.8) bad.push(tag + ': M ' + (+c.result.M).toFixed(2) + ' < 0.8 [' + ['frame', 'los', 'lit', 'dist', 'faces'].map((k) => k + ' ' + (+c.result[k]).toFixed(2)).join(', ') + ', d ' + Math.round((c.result.angle || {}).d) + ']');
      }
    }
    const why = {}; for (const x of bad) { const m = /^seed \d+ (\S+) \((\w+)\)( @\S+)?: (\w+)/.exec(x); if (m) { const k = m[4] + ' ' + m[1] + '/' + m[2] + (m[3] || ''); why[k] = (why[k] || 0) + 1; } }
    if (bad.length) console.log('       info: shadow failures by kind: ' + JSON.stringify(why));
    spotTable(runs.shadow, 'shadow');
    console.log('       info: shadow bot ' + done + '/' + SEEDS + ' seeds; scandal x light combos covered: ' + combos.size + '/15');
    t.none(bad, 'shadow bot');
    for (const id of NIGHT.SCANDALS) for (const b of ['dusk', 'mid', 'night']) if (!combos.has(id + '/' + b)) t.fail('combo never exercised: ' + id + '/' + b + ' (staging or seeds)');
    if (done < SEEDS) t.fail('only ' + done + '/' + SEEDS + ' seeds within HUSH_NIGHT_BUDGET_MS=' + BUDGET + ' (' + budgetHit + ')');
  });

  // Dana M1 ruling (option b, docs/06): night beeline 43% accepted for the prototype; the client playtest decides. Pass line =
  // accepted floor 40%; the 60% design goal stays in the output (fix if too easy: Noa's 'every shortest walk-in lit').
  const BEELINE_FLOOR = 0.40, BEELINE_GOAL = 0.60;
  t.test('night bot (O1 b): beeline bot (no hiding) is aborted in >= 40% of night cases (accepted floor; goal 60%) and shows suspicion >= 35 in >= 25% at dusk', () => {
    const X = setup(); resetBudget();
    const n = Math.min(SEEDS, Math.max(20, done || 50));
    const per = { dusk: [0, 0], mid: [0, 0], night: [0, 0] };
    for (let seed = 1; seed <= n; seed++) {
      let r;
      try { r = play(seed, 'beeline', X); } catch (e) { if (/budget/.test(e.message)) break; throw e; }
      runs.beeline.push(r);
      for (const c of r.cases) { const b = bucket(c.ambient); per[b][1]++; if (b === 'night' ? c.aborted : c.maxSusp >= NIGHT.SUSP_UNEASY) per[b][0]++; }
    }
    const pct = (b) => (per[b][1] ? per[b][0] / per[b][1] : 0);
    spotTable(runs.beeline, 'beeline');
    console.log('       info: beeline caught: night ' + (100 * pct('night')).toFixed(0) + '% aborted (' + per.night[1] + ' cases), dusk ' + (100 * pct('dusk')).toFixed(0) + '% >= 35 suspicion, mid ' + (100 * pct('mid')).toFixed(0) + '%');
    console.log('       info: night beeline abort ' + (100 * pct('night')).toFixed(0) + '% - accepted floor ' + 100 * BEELINE_FLOOR + '%, design goal ' + 100 * BEELINE_GOAL + '% ' + (pct('night') >= BEELINE_GOAL ? 'MET' : 'NOT MET (Dana ruling: accepted for prototype)'));
    t.ok(per.night[1] > 0 && pct('night') >= BEELINE_FLOOR, 'night: beeline aborted in ' + (100 * pct('night')).toFixed(0) + '% (>= ' + 100 * BEELINE_FLOOR + '% accepted floor)');
    t.ok(per.dusk[1] > 0 && pct('dusk') >= 0.25, 'dusk: beeline suspicion >= 35 in ' + (100 * pct('dusk')).toFixed(0) + '% (>= 25%)');
  });

  t.test('night (O1 d): determinism - same seed gives identical results, suspicion and score; no Math.random', () => {
    const X = setup(); resetBudget();
    const fp = (r) => JSON.stringify({ c: r.cases.map((c) => [c.def, +c.maxSusp.toFixed(6), c.aborted, c.result && c.result.points]), res: r.results, score: r.score });
    const a = fp(play(3, 'shadow', X)); play(4, 'beeline', X); const b = fp(play(3, 'shadow', X));
    t.ok(a === b, 'seed 3 differs:\n         A ' + a.slice(0, 300) + '\n         B ' + b.slice(0, 300));
    t.eq(ctx.rand, 0, 'Math.random calls during night newRun/update');
  });

  t.test('night bot (M1 ruling 3): close bot (<= 120 px) reaches M >= 0.95 at every spot and M = 1 at some', () => {
    const X = setup(); resetBudget();
    const n = Math.min(SEEDS, Math.max(10, done || 40)), per = {}, bad = [];
    for (let seed = 1; seed <= n; seed++) {
      let r;
      try { r = play(seed, 'close', X); } catch (e) { if (/budget/.test(e.message)) break; throw e; }
      runs.close.push(r);
      for (const c of r.cases) { const o = per[c.spot] || (per[c.spot] = { n: 0, shots: 0, min: 2, max: 0, one: 0, sumM: 0 }); o.n++; if (!c.result) continue; const M = +c.result.M; o.shots++; o.sumM += M; o.min = Math.min(o.min, M); o.max = Math.max(o.max, M); if (M > 1 - 1e-9) o.one++; }
    }
    console.log('       info: close bot per spot: spot  shots/cases  best M  mean M  min M  M=1');
    for (const k of Object.keys(per).sort()) { const o = per[k]; console.log('         ' + String(k).padEnd(18) + (o.shots + '/' + o.n).padEnd(8) + o.max.toFixed(3).padEnd(8) + (o.shots ? o.sumM / o.shots : 0).toFixed(3).padEnd(8) + (o.shots ? o.min.toFixed(3) : '-').padEnd(7) + o.one); if (!(o.max >= 0.95)) bad.push(k + ': best M ' + o.max.toFixed(3) + ' < 0.95'); }
    t.ok(Object.keys(per).length > 0, 'close bot played some cases');
    t.none(bad, 'close bot M >= 0.95 per spot');
    t.ok(Object.values(per).some((o) => o.one > 0), 'M = 1 reached at some spot');
  });

  t.test('night scoring (06 dec. 4): every photo = v1 timing points x M, M = 0.5 + 0.5*A in [0.5, 1], PERFECT at M=1 is 1500', () => {
    const X = setup();
    if (!runs.shadow.length) t.skip('SKIPPED (no shadow-bot runs)');
    const all = runs.shadow.concat(runs.beeline, runs.close), bad = [];
    let n = 0, perfect1 = 0;
    for (const r of all) for (const c of r.cases) {
      const R = c.result; if (!R) continue; n++;
      const comp = R.angle || R.components || R;
      const keys = ['frame', 'los', 'lit', 'dist', 'faces'];
      if (!keys.every((k) => typeof comp[k] === 'number')) { bad.push(c.def + ': photo result lacks angle components ' + JSON.stringify(Object.keys(comp))); continue; }
      for (const k of keys) if (!(comp[k] >= 0 && comp[k] <= 1)) bad.push(c.def + ': ' + k + ' = ' + comp[k]);
      const M = mOf(comp);
      if (R.M != null && Math.abs(R.M - M) > 1e-6) bad.push(c.def + ': M ' + R.M + ' != 0.5+0.5*A = ' + M);
      if (!(M >= NIGHT.M_MIN - 1e-9 && M <= NIGHT.M_MAX + 1e-9)) bad.push(c.def + ': M ' + M + ' out of [0.5,1]');
      const timing = X.PE.logic.scorePhoto({ t: NIGHT.RISE + (+R.dt || 0), live: true, inRange: true }, Object.assign({}, X.PE.CFG, { RISE: NIGHT.RISE, FALL: NIGHT.FALL })).points;
      if (Math.abs(R.points - Math.round(timing * M)) > 1) bad.push(c.def + ': points ' + R.points + ' != round(' + timing + ' x ' + M.toFixed(3) + ')');
      if (timing === 1500 && Math.abs(M - 1) < 1e-9 && R.points !== 1500) bad.push(c.def + ': PERFECT at M=1 scored ' + R.points);
      if (timing === 1500 && Math.abs(M - 1) < 1e-9) perfect1++;
    }
    console.log('       info: ' + n + ' scored night photos checked, ' + perfect1 + ' PERFECT at M=1');
    t.ok(n > 0, 'some photos were scored');
    t.none(bad, 'night scoring');
  });

  t.test('block: every night spot is photographable - a reachable walkable tile within 158 px has clear LOS to it', () => {
    if (!exists('stealth')) t.skip('SKIPPED (file missing: js/stealth.js)');
    const PE = NL.load(ROOT).PE, S = PE.stealth, c = PE.city;
    if (!S || typeof S.los !== 'function') pending('stealth.los');
    c.init({ night: true });
    if (!Array.isArray(c.lights)) pending('city.init({night:true})');
    S.init(c, PE.CFG);
    const A = { los: (g, cover, x0, y0, x1, y1) => S.los({ x: x0, y: y0 }, { x: x1, y: y1 }) };
    const D = NIGHT.DISTRICT, g = c.grid, Wd = g.w;
    const spots = (Array.isArray(c.nightSpots) ? c.nightSpots : c.spots).filter((s) => s.x >= D.x0 * TILE && s.x < (D.x1 + 1) * TILE && s.y >= D.y0 * TILE && s.y < (D.y1 + 1) * TILE);
    if (!spots.length) pending('night spots');
    const st = (c.nightStarts || c.playerStarts || [])[0];
    const reach = st ? NL.bfs(g, Math.floor(st.x / TILE), Math.floor(st.y / TILE)) : null;
    const bad = [];
    for (const s of spots) {
      let ok = false;
      for (let k = 0; k < g.solid.length && !ok; k++) {
        if (g.solid[k] || (reach && reach[k] < 0)) continue;
        const x = (k % Wd) * TILE + 16, y = Math.floor(k / Wd) * TILE + 16;
        if (Math.hypot(x - s.x, y - s.y) <= RANGE - 12 && A.los(g, c.cover || [], x, y, s.x, s.y)) ok = true;
      }
      if (!ok) bad.push(s.id + ' (' + s.kind + ') cannot be photographed with LOS from any reachable tile');
    }
    t.none(bad, 'photographable spots');
  });
};
