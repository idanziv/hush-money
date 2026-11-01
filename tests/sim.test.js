// HUSH MONEY - headless gameplay simulation (spec v0.3 RC sections 3-7, 10, 14.8, 14.9). Owner: QA.
// A bot plays full runs through PE.game.update(dt, input) exactly like main.js would: it writes PE.cam
// (centered on the player, clamped to the map) before every step and feeds boolean key input.
// Env: HUSH_SIM_SEEDS (default 100), HUSH_SIM_BUDGET_MS (default 20000, whole sim suite).
'use strict';
const S = require('./spec.js');

module.exports = (t, PE) => {
  const C = S.CFG, DT = C.DT, TILE = 32;
  const SEEDS = Math.max(1, +process.env.HUSH_SIM_SEEDS || 100);
  const BUDGET_MS = Math.max(1000, +process.env.HUSH_SIM_BUDGET_MS || 20000);
  const MAX_STEPS = Math.round(170 / DT); // a run is <= 127 s; 170 s means a stuck state machine
  const DZ = 2.5; // steering dead zone px (player moves 2.33 px/step)
  const IDLE = Object.freeze({ up: false, down: false, left: false, right: false, sprint: false, photo: false });

  let suiteStart = 0;
  const deadline = () => suiteStart + BUDGET_MS;
  class BudgetError extends Error {}

  const need = () => {
    t.needs('data', 'logic', 'city', 'npc', 'game');
    if (!suiteStart) { suiteStart = Date.now(); installRandomSpy(); }
  };

  // ---------- Math.random spy (spec 12: no Math.random in game logic) ----------
  let inGame = false, randomCalls = 0, randomWhere = '';
  function installRandomSpy() {
    if (Math.random.__qaSpy) return;
    const orig = Math.random;
    const spy = function () {
      if (inGame) { randomCalls++; if (!randomWhere) randomWhere = (new Error().stack || '').split('\n').slice(2, 4).join(' <- ').trim(); }
      return orig();
    };
    spy.__qaSpy = true;
    Math.random = spy;
  }
  const inside = (fn) => { inGame = true; try { return fn(); } finally { inGame = false; } };

  // ---------- harness ----------
  const tileOf = (v) => Math.floor(v / TILE);
  const grid = () => PE.city.grid;
  const solidPx = (x, y) => {
    const g = grid(), tx = tileOf(x), ty = tileOf(y);
    return !(x >= 0 && y >= 0) || tx >= g.w || ty >= g.h || !!g.solid[ty * g.w + tx];
  };
  function cam() {
    if (!PE.cam || typeof PE.cam !== 'object') PE.cam = { x: 0, y: 0, w: C.VIEW_W, h: C.VIEW_H };
    return PE.cam;
  }
  function placeCam(p) {
    const c = cam();
    c.w = C.VIEW_W; c.h = C.VIEW_H;
    c.x = Math.round(Math.max(0, Math.min(C.MAP_W * TILE - C.VIEW_W, p.x - C.VIEW_W / 2)));
    c.y = Math.round(Math.max(0, Math.min(C.MAP_H * TILE - C.VIEW_H, p.y - C.VIEW_H / 2)));
    return c;
  }
  const st = () => PE.game.state;
  let updNs = 0n, updSteps = 0, updMaxNs = 0n;
  function newRun(seed) {
    cam();
    inside(() => PE.game.newRun(seed));
    placeCam(st().player);
  }
  function step(input) {
    placeCam(st().player);
    const a = process.hrtime.bigint();
    inside(() => PE.game.update(DT, input));
    const d = process.hrtime.bigint() - a;
    updNs += d; updSteps++; if (d > updMaxNs && updSteps > 600) updMaxNs = d;
    return st().events || [];
  }

  // ---------- global invariant collector (fed by every simulated run) ----------
  const INV = {
    runs: 0, steps: 0,
    oneLive: [], spawnPath: [], solid: [], bubbles: [], bubbleText: [], deckSpot: [], scState: [],
    lines: [], resolution: [], timing: [], spawnPaths: [], peak: [], action: [], oneBubble: [], dogs: [], waits: [], dupLine: [], lean: [],
  };
  const push = (arr, msg) => { if (arr.length < 40) arr.push(msg); };

  // Play one run. mode: 'peak' (bot shoots at RISE), 'none' (never shoots), 'toofar' (one too-far shot on case 1, then peak).
  // opts.shootAt: shoot when the photo step lands on this scandal time (opts.lead = steps between press and evaluation).
  function play(seed, mode, opts) {
    opts = opts || {};
    newRun(seed);
    const out = { seed, photos: [], spawns: [], resolves: [], peaks: [], overStep: -1, notInRangeAtPeak: [], steps: 0, tooFar: null };
    const g = grid(), W = g.w;
    let liveOpen = false, prevSpotId = null, defsSeen = new Set();
    let field = null, target = null, scRef = null, shot = false, prevT = -1, lineSc = null, tooFarDone = false, steering = 0;
    let pendingRemoval = null; // {actors, dueStep, status}
    let pendingLine = null; // {texts, actors, dueStep, status, seen}
    let lastLiveActors = [];
    let peakSc = null, peakCount = 0, lastLiveT = -1, inRangeAt = -1;
    const dogPrev = new Map();
    const lastSaid = new Map(); // speaker -> {b: bubble object, text}
    const shootT = opts.shootAt != null ? opts.shootAt - (opts.lead || 0) * DT - DT / 2 : C.RISE;
    const isLive = (sc) => sc && sc.status === 'live';

    for (let i = 0; i < MAX_STEPS; i++) {
      if ((i & 511) === 0 && Date.now() > deadline() && !opts.noBudget) throw new BudgetError('sim time budget ' + BUDGET_MS + ' ms exceeded (seed ' + seed + ')');
      const s = st();
      const p = s.player;
      const sc = s.scandal;
      const input = Object.assign({}, IDLE);

      if (isLive(sc) && mode !== 'none') {
        if (sc !== scRef) {
          scRef = sc; shot = false; target = null; steering = 0; inRangeAt = -1;
          field = S.bfs(g, tileOf(sc.focus.x), tileOf(sc.focus.y));
        }
        const d = Math.hypot(p.x - sc.focus.x, p.y - sc.focus.y);
        if (mode === 'toofar' && !tooFarDone && d > C.PHOTO_RANGE + 8 && !(s.photoCooldown > 0)) {
          input.photo = true; tooFarDone = true;
          out.tooFar = { scBefore: sc, score: s.score, step: i };
        } else if (d > C.PHOTO_RANGE - 2) {
          steering++;
          if (!target) target = { tx: tileOf(p.x), ty: tileOf(p.y) };
          let ex = target.tx * TILE + 16 - p.x, ey = target.ty * TILE + 16 - p.y;
          if (Math.abs(ex) <= DZ && Math.abs(ey) <= DZ) {
            const cur = target.ty * W + target.tx, dc = field[cur];
            if (dc < 0) push(INV.spawnPath, 'seed ' + seed + ': player tile ' + target.tx + ',' + target.ty + ' cannot reach focus');
            else if (dc > 0) {
              const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]];
              for (const [ox, oy] of nb) {
                const nx = target.tx + ox, ny = target.ty + oy;
                if (nx >= 0 && ny >= 0 && nx < W && ny < g.h && field[ny * W + nx] === dc - 1) { target = { tx: nx, ty: ny }; break; }
              }
              ex = target.tx * TILE + 16 - p.x; ey = target.ty * TILE + 16 - p.y;
            }
          }
          input.right = ex > DZ; input.left = ex < -DZ; input.down = ey > DZ; input.up = ey < -DZ;
          if (sc.t >= shootT && !shot && !out.notInRangeAtPeak.some((q) => q.sc === sc)) out.notInRangeAtPeak.push({ sc, d, path: field[tileOf(p.y) * W + tileOf(p.x)] });
        } else {
          if (inRangeAt < 0) inRangeAt = sc.t;
          if (sc.t >= shootT && !shot && mode !== 'none') { input.photo = true; shot = true; INV.waits.push(sc.t - inRangeAt); }
        }
      }

      const preX = p.x, preY = p.y;
      const preLive = isLive(sc);
      const preT = preLive ? sc.t : -1;
      const evs = step(input);
      out.steps++; INV.steps++;
      const s2 = st();
      const sc2 = s2.scandal;

      for (const e of evs) {
        if (e.type === 'spawn') {
          out.spawns.push({ step: i + 1, def: e.def && e.def.id });
          peakSc = sc2; peakCount = 0; lastLiveT = -1;
          if (liveOpen) push(INV.oneLive, 'seed ' + seed + ' step ' + i + ': spawn while a scandal is still live');
          liveOpen = true;
          if (!sc2 || !isLive(sc2)) { push(INV.scState, 'seed ' + seed + ': spawn event but state.scandal not live'); continue; }
          const sp = sc2.spot;
          const d = S.bfs(g, tileOf(preX), tileOf(preY));
          const pt = sp ? d[tileOf(sp.y) * W + tileOf(sp.x)] : -2;
          INV.spawnPaths.push(pt);
          if (!(pt >= C.RELAX_MIN_TILES && pt <= C.RELAX_MAX_TILES)) push(INV.spawnPath, 'seed ' + seed + ' case ' + s2.caseNo + ': spawn path ' + pt + ' tiles (spot ' + (sp && sp.id) + ')');
          if (sp && sp.id === prevSpotId) push(INV.deckSpot, 'seed ' + seed + ': spot ' + sp.id + ' reused back-to-back');
          prevSpotId = sp && sp.id;
          if (defsSeen.has(sc2.def.id)) push(INV.deckSpot, 'seed ' + seed + ': def ' + sc2.def.id + ' repeated within a run (deck of 7 for 6 cases)');
          defsSeen.add(sc2.def.id);
          if (sp && !(sc2.def.kinds || []).includes(sp.kind)) push(INV.deckSpot, 'seed ' + seed + ': def ' + sc2.def.id + ' at spot kind ' + sp.kind);
          if (!sc2.focus || !sp || sc2.focus.x !== sp.x || sc2.focus.y !== sp.y) push(INV.scState, 'seed ' + seed + ': focus != spot center');
          if (!Array.isArray(sc2.actors) || sc2.actors.length !== sc2.def.roles.length) push(INV.scState, 'seed ' + seed + ': actors.length != roles.length');
          if (e.def !== sc2.def) push(INV.scState, 'seed ' + seed + ': spawn event def != state.scandal.def');
        } else if (e.type === 'resolve') {
          out.resolves.push({ step: i + 1, status: e.status });
          if (peakSc) {
            const want = lastLiveT >= C.RISE || (sc2 && sc2.t >= C.RISE) ? 1 : 0;
            if (peakCount !== want) push(INV.peak, 'seed ' + seed + ' ' + (sc2 && sc2.def.id) + ': ' + peakCount + ' peak events (expected ' + want + ')');
            peakSc = null;
          }
          if (e.status === 'expired') {
            const pb = s2.player.bubble;
            if (!pb || !(PE.LINES.player_miss || []).includes(pb.text)) push(INV.resolution, 'seed ' + seed + ': no player_miss line on expiry (' + JSON.stringify(pb && pb.text) + ')');
          }
          if (!liveOpen) push(INV.oneLive, 'seed ' + seed + ' step ' + i + ': resolve without a live scandal');
          liveOpen = false;
          if (e.status !== 'busted' && e.status !== 'expired') push(INV.scState, 'seed ' + seed + ': resolve status ' + e.status);
          if (sc2 && sc2.def) {
            const wait = e.status === 'busted' ? C.BUSTED_FLEE_TIME : 5;
            const acts = lastLiveActors.slice();
            pendingRemoval = { actors: acts, startStep: i + Math.ceil(C.BUST_FADE / DT) + 2, dueStep: i + Math.ceil((wait + 0.25) / DT), status: e.status };
            // Expired actors may be removed at once when off-screen (sec 4) - only demand the line if one is in view.
            const c0 = cam();
            const inView = acts.some((a) => a.x >= c0.x && a.x <= c0.x + c0.w && a.y >= c0.y && a.y <= c0.y + c0.h);
            const L = e.status === 'busted' ? sc2.def.bust : sc2.def.expire;
            if (inView || e.status === 'busted') pendingLine = { texts: (L || []).map((l) => l.s), actors: acts, dueStep: i + Math.ceil(1 / DT), status: e.status, seen: false };
          }
        } else if (e.type === 'peak') {
          peakCount++; out.peaks.push({ step: i + 1, caseNo: s2.caseNo });
          if (!sc2 || sc2.status !== 'live') push(INV.peak, 'seed ' + seed + ': peak event without a live scandal');
          else if (!(sc2.t >= C.RISE && preT < C.RISE)) push(INV.peak, 'seed ' + seed + ' ' + sc2.def.id + ': peak event at t=' + sc2.t.toFixed(4) + ' (previous step t=' + preT.toFixed(4) + '), expected the first step with t >= RISE');
        } else if (e.type === 'photo') {
          out.photos.push({ step: i + 1, result: e.result, preLive, scBefore: sc });
          if (e.result && e.result.kind === 'scored' && e.result.points >= 400) {
            const pb = s2.player.bubble;
            if (!pb || !(PE.LINES.player_good || []).includes(pb.text)) push(INV.resolution, 'seed ' + seed + ': no player_good line after a ' + e.result.points + ' photo (' + JSON.stringify(pb && pb.text) + ')');
          }
        }
      }

      // --- per-step invariants ---
      if (!!(sc2 && sc2.status === 'live') !== (s2.phase === 'live')) push(INV.oneLive, 'seed ' + seed + ' step ' + i + ': phase ' + s2.phase + ' but scandal.status ' + (sc2 && sc2.status));
      const actors = PE.game.actors() || [];
      const people = PE.npc.people || [];
      if (solidPx(s2.player.x, s2.player.y)) push(INV.solid, 'seed ' + seed + ' step ' + i + ': player in solid at ' + s2.player.x.toFixed(1) + ',' + s2.player.y.toFixed(1));
      for (const a of actors) if (solidPx(a.x, a.y)) push(INV.solid, 'seed ' + seed + ' step ' + i + ': actor ' + a.look + ' in solid at ' + a.x.toFixed(1) + ',' + a.y.toFixed(1) + ' (scandal ' + (sc2 && sc2.def.id) + ', status ' + (sc2 && sc2.status) + ')');
      const c = cam();
      let nb = 0;
      for (let k = 0; k < people.length; k++) {
        const q = people[k];
        if (solidPx(q.x, q.y)) push(INV.solid, 'seed ' + seed + ' step ' + i + ': ambient ' + q.look + ' #' + q.id + ' in solid at ' + q.x.toFixed(1) + ',' + q.y.toFixed(1));
        const b = q.bubble;
        if (b) {
          if (typeof b.text !== 'string' || !b.text) push(INV.bubbleText, 'seed ' + seed + ': ambient bubble with text ' + JSON.stringify(b.text));
          if (b.style === 'ambient' && q.x >= c.x && q.x <= c.x + c.w && q.y >= c.y && q.y <= c.y + c.h) nb++;
        }
      }
      const V = PE.npc.vehicles || [];
      for (let k = 0; k < V.length; k++) {
        const v = V[k], b = v.bubble;
        if (b && b.style === 'ambient' && v.x >= c.x && v.x <= c.x + c.w && v.y >= c.y && v.y <= c.y + c.h) nb++;
      }
      if (nb > C.MAX_AMBIENT_BUBBLES) push(INV.bubbles, 'seed ' + seed + ' step ' + i + ': ' + nb + ' ambient bubbles in camera (people + vehicles)');
      let ns = s2.player.bubble && s2.player.bubble.style === 'scandal' ? 1 : 0;
      for (const a of actors) if (a.bubble && a.bubble.style === 'scandal') ns++;
      for (let k = 0; k < people.length; k++) if (people[k].bubble && people[k].bubble.style === 'scandal') ns++;
      if (ns > 1) push(INV.oneBubble, 'seed ' + seed + ' step ' + i + ': ' + ns + ' scandal-style bubbles at once (' + (sc2 && sc2.def.id) + ' t=' + (sc2 ? sc2.t.toFixed(2) : '-') + ')');
      // v1.0.1: no two live npc bubbles share a text; no npc speaker repeats its previous line
      {
        const seen = new Map();
        const scan = (o) => {
          const b = o.bubble;
          if (!b || b.style === 'scandal') return;
          const prev = seen.get(b.text);
          if (prev && prev !== o) push(INV.dupLine, 'seed ' + seed + ' step ' + i + ': two live bubbles say "' + b.text + '"');
          seen.set(b.text, o);
          const ls = lastSaid.get(o);
          if (!ls || ls.b !== b) {
            if (ls && ls.text === b.text) push(INV.dupLine, 'seed ' + seed + ' step ' + i + ': speaker #' + (o.id || o.type) + ' repeated "' + b.text + '"');
            lastSaid.set(o, { b, text: b.text });
          }
        };
        for (let k = 0; k < people.length; k++) scan(people[k]);
        for (let k = 0; k < V.length; k++) scan(V[k]);
      }
      // dogs: a jump > 20 px in one step is a teleport; only allowed when > 300 px and both ends are off-camera
      for (let k = 0; k < people.length; k++) {
        const q = people[k];
        if (q.look !== 'dog') continue;
        const pv = dogPrev.get(q);
        if (pv) {
          const jump = Math.hypot(q.x - pv[0], q.y - pv[1]);
          if (jump > 20) {
            const inCam = (x, y) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
            if (inCam(pv[0], pv[1]) || inCam(q.x, q.y)) push(INV.dogs, 'seed ' + seed + ' step ' + i + ': dog #' + q.id + ' teleported ' + jump.toFixed(0) + ' px on camera');
            else if (jump < 250) push(INV.dogs, 'seed ' + seed + ' step ' + i + ': dog #' + q.id + ' teleported only ' + jump.toFixed(0) + ' px (rule: > 300 px from owner)');
          }
          pv[0] = q.x; pv[1] = q.y;
        } else dogPrev.set(q, [q.x, q.y]);
      }
      if (s2.player.bubble && (typeof s2.player.bubble.text !== 'string' || !s2.player.bubble.text)) push(INV.bubbleText, 'seed ' + seed + ': player bubble text ' + JSON.stringify(s2.player.bubble.text));

      if (isLive(sc2)) {
        lastLiveActors = sc2.actors.slice();
        // v1.1.5 lean-in: smooth bounded travel, arrives >= 0.35 s before the pop, then stands still with legs off
        if (sc2.t >= C.RISE - C.ACTION_LEAD && sc2.t < C.RISE && sc2.def.roles) {
          const L0 = C.RISE - C.ACTION_LEAD;
          for (let k = 0; k < sc2.actors.length; k++) {
            const a = sc2.actors[k], ro = sc2.def.roles[k] || {};
            if (typeof ro.pdx !== 'number' && typeof ro.pdy !== 'number') continue;
            const pv = a.__qaLean;
            if (pv && pv.t >= L0) {
              const stepPx = Math.hypot(a.x - pv.x, a.y - pv.y);
              if (stepPx > 2.5) push(INV.lean, 'seed ' + seed + ' ' + sc2.def.id + '#' + k + ': lean-in step ' + stepPx.toFixed(2) + ' px at t=' + sc2.t.toFixed(2) + ' (> 2.5 px/step dash)');
              if (sc2.t > C.RISE - 0.35 && stepPx > 1e-6) push(INV.lean, 'seed ' + seed + ' ' + sc2.def.id + '#' + k + ': still creeping ' + stepPx.toFixed(3) + ' px at t=' + sc2.t.toFixed(2) + ' (long tail)');
              if (stepPx < 1e-9 && a.moving) push(INV.lean, 'seed ' + seed + ' ' + sc2.def.id + '#' + k + ': walk cycle on while standing at t=' + sc2.t.toFixed(2));
            }
            a.__qaLean = { x: a.x, y: a.y, t: sc2.t };
          }
        }
        const L = PE.logic;
        if (Math.abs(sc2.intensity - L.intensityAt(sc2.t, PE.CFG)) > 1e-6) push(INV.scState, 'seed ' + seed + ': intensity ' + sc2.intensity + ' != intensityAt(' + sc2.t + ')');
        const dd = Math.hypot(s2.player.x - sc2.focus.x, s2.player.y - sc2.focus.y);
        if (Math.abs(sc2.d - dd) > 4) push(INV.scState, 'seed ' + seed + ': scandal.d ' + sc2.d + ' vs actual ' + dd.toFixed(1));
        if (!!sc2.inRange !== (sc2.d <= C.PHOTO_RANGE)) push(INV.scState, 'seed ' + seed + ': inRange ' + sc2.inRange + ' with d=' + sc2.d);
        if (sc2.prox !== L.proximity(sc2.d, PE.CFG)) push(INV.scState, 'seed ' + seed + ': prox ' + sc2.prox + ' with d=' + sc2.d);
        if (sc2.t > 0.05) for (const a of sc2.actors) if (Math.abs((a.glow || 0) - sc2.intensity) > 0.05) { push(INV.scState, 'seed ' + seed + ': actor glow ' + a.glow + ' vs intensity ' + sc2.intensity.toFixed(3)); break; }
        lastLiveT = sc2.t;
        if (sc2.t < C.RISE) { const a0 = sc2.actors.find((a) => a.action); if (a0) push(INV.action, 'seed ' + seed + ' ' + sc2.def.id + ': action ' + a0.action + ' before RISE at t=' + sc2.t.toFixed(3)); }
        else if (sc2.t <= C.RISE + C.ACTION_TAIL && !sc2.actors.some((a) => a.action === sc2.def.peak.action)) push(INV.action, 'seed ' + seed + ' ' + sc2.def.id + ': no actor plays ' + sc2.def.peak.action + ' at t=' + sc2.t.toFixed(3));
        // lines fire as t crosses each `at`
        if (sc2 !== lineSc) { lineSc = sc2; prevT = -1; }
        const t0 = prevT;
        if (t0 >= 0) for (const l of sc2.def.lines) {
          if (l.at > t0 && l.at <= sc2.t) {
            const b = sc2.actors[l.r] && sc2.actors[l.r].bubble;
            if (!b || b.text !== l.s) push(INV.lines, 'seed ' + seed + ' ' + sc2.def.id + ' at=' + l.at + ': role ' + l.r + ' bubble ' + JSON.stringify(b && b.text) + ' expected ' + JSON.stringify(l.s));
            else if (b.style !== 'scandal') push(INV.lines, 'seed ' + seed + ' ' + sc2.def.id + ': scandal line style ' + b.style);
          }
        }
        prevT = sc2.t;
      }

      if (pendingLine) {
        if (!pendingLine.seen && pendingLine.actors.some((a) => a.bubble && pendingLine.texts.includes(a.bubble.text))) pendingLine.seen = true;
        if (i >= pendingLine.dueStep) {
          if (!pendingLine.seen) push(INV.resolution, 'seed ' + seed + ': no ' + pendingLine.status + ' line within 1 s (' + JSON.stringify(pendingLine.texts) + ')');
          pendingLine = null;
        }
      }
      if (pendingRemoval) {
        if (pendingRemoval.status === 'busted' && i >= pendingRemoval.startStep && i < pendingRemoval.dueStep && pendingRemoval.actors.some((a) => (a.glow || 0) > 1e-3)) {
          push(INV.resolution, 'seed ' + seed + ': busted actor still glowing after BUST_FADE'); pendingRemoval.status = 'busted-reported';
        }
        if (i >= pendingRemoval.dueStep) {
          const still = pendingRemoval.actors.filter((a) => actors.includes(a));
          if (still.length) push(INV.resolution, 'seed ' + seed + ': ' + still.length + ' ' + pendingRemoval.status + ' actor(s) still in game.actors() after ' + (pendingRemoval.status.startsWith('busted') ? C.BUSTED_FLEE_TIME : 5) + ' s');
          pendingRemoval = null;
        }
      }

      if (s2.phase === 'over' || s2.over) { out.overStep = i + 1; break; }
      if (opts.stopAfterResolves && out.resolves.length >= opts.stopAfterResolves) break;
    }
    // timing: first spawn, gaps, end delay (step clock, independent of state.time)
    const tol = 2 * DT + 1e-9;
    const T = (k) => k * DT;
    if (out.spawns.length && Math.abs(T(out.spawns[0].step) - C.FIRST_DELAY) > tol) push(INV.timing, 'seed ' + seed + ': first spawn at ' + T(out.spawns[0].step).toFixed(3) + ' s (FIRST_DELAY 3)');
    for (let k = 0; k + 1 < out.spawns.length && k < out.resolves.length; k++) {
      const gap = T(out.spawns[k + 1].step - out.resolves[k].step);
      if (Math.abs(gap - C.GAP) > tol) push(INV.timing, 'seed ' + seed + ': gap after ' + out.resolves[k].status + ' = ' + gap.toFixed(3) + ' s (GAP 4)');
    }
    if (out.overStep > 0 && out.resolves.length === C.SCANDALS_PER_RUN) {
      const end = T(out.overStep - out.resolves[out.resolves.length - 1].step);
      if (Math.abs(end - C.END_DELAY) > tol) push(INV.timing, 'seed ' + seed + ': over ' + end.toFixed(3) + ' s after last resolve (END_DELAY 2)');
    }
    out.state = st();
    INV.runs++;
    return out;
  }

  function fingerprint(out) {
    const s = out.state;
    let h = 0;
    for (const q of PE.npc.people || []) h = (h * 31 + Math.round(q.x * 100) * 7 + Math.round(q.y * 100)) % 1000000007;
    return JSON.stringify({
      results: s.results.map((r) => [r.defId, r.points, r.label, +(+r.dt || 0).toFixed(6), r.photo]),
      score: s.score, steps: out.steps, px: +s.player.x.toFixed(4), py: +s.player.y.toFixed(4), npc: h,
      spawns: out.spawns, n: (PE.npc.people || []).length,
    });
  }

  // =====================================================================
  t.test('headless: newRun(seed) + update() run in Node; state matches 14.9 shape', () => {
    need();
    newRun(1);
    const s = st();
    t.ok(s && typeof s === 'object', 'PE.game.state');
    t.eq(s.seed, 1, 'state.seed');
    t.eq(s.total, 6, 'state.total');
    t.eq(s.score, 0, 'score starts at 0');
    t.eq(s.phase, 'waiting', 'phase at start');
    t.eq(s.over, false, 'over at start');
    t.ok(Array.isArray(s.results) && s.results.length === 0, 'results empty');
    t.ok(Array.isArray(s.events), 'events array');
    const p = s.player;
    for (const k of ['id', 'x', 'y', 'dir', 'moving', 'animT', 'look', 'prop', 'kind', 'bubble', 'glow', 'action', 'brain']) t.ok(k in p, 'player.' + k);
    t.eq(p.kind, 'player', 'player.kind'); t.eq(p.look, 'detective', 'player.look');
    const starts = PE.city.playerStarts || [PE.city.playerStart];
    t.ok(starts.some((q) => Math.abs(q.x - p.x) < 0.001 && Math.abs(q.y - p.y) < 0.001), 'player starts on one of city.playerStarts (' + p.x + ',' + p.y + ')');
    for (let i = 0; i < 30; i++) step(IDLE);
    t.ok(Array.isArray(PE.game.actors()), 'actors() array');
    t.eq(PE.npc.people.length >= C.AMBIENT_COUNT, true, 'npc.people >= AMBIENT_COUNT (' + PE.npc.people.length + ')');
    const V = PE.npc.vehicles || [];
    t.eq([V.filter((v) => v.type === 'scooter').length, V.filter((v) => v.type === 'car').length], [6, 6], 'vehicles [scooters, cars]');
    const kinds = new Set(PE.npc.people.map((q) => q.kind));
    t.eq([...kinds], ['ambient'], 'npc.people are all kind ambient');
  });

  t.test('npc: unknown look/prop/action/style keys never throw', () => {
    need();
    newRun(2);
    const q = PE.npc.makePerson(PE.city.playerStart.x, PE.city.playerStart.y, 'no_such_look', 'ambient');
    t.ok(q && typeof q.x === 'number', 'makePerson returns a Person');
    PE.npc.say(q, 'hello', 'no_such_style', 1);
    q.prop = 'no_such_prop'; q.action = 'no_such_action';
    PE.npc.reactToPhoto(q.x, q.y);
    for (let i = 0; i < 10; i++) step(IDLE);
  });

  t.test('player: base speed 140 px/s, sprint x1.5, diagonals normalized, dir follows movement', () => {
    need();
    newRun(3);
    const p0 = st().player;
    const dirs = [[0, -1, 'up'], [1, 0, 'right'], [0, 1, 'down'], [-1, 0, 'left'], [1, -1, 'up+right'], [1, 1, 'down+right'], [-1, 1, 'down+left'], [-1, -1, 'up+left']];
    const free = (ux, uy, len) => {
      const n = Math.hypot(ux, uy);
      for (let s = 0; s <= len; s += 4) {
        const x = p0.x + ux / n * s, y = p0.y + uy / n * s;
        for (const [ox, oy] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) if (solidPx(x + ox, y + oy)) return false;
      }
      return true;
    };
    const mk = (dx, dy, sprint) => Object.assign({}, IDLE, { up: dy < 0, down: dy > 0, left: dx < 0, right: dx > 0, sprint });
    const ortho = dirs.slice(0, 4).find(([x, y]) => free(x, y, 230));
    const diag = dirs.slice(4).find(([x, y]) => free(x, y, 160));
    if (!ortho && !diag) t.skip('SKIPPED (no free straight corridor around playerStart)');
    const measure = (dx, dy, sprint) => {
      newRun(3);
      const a = { x: st().player.x, y: st().player.y };
      for (let i = 0; i < 60; i++) step(mk(dx, dy, sprint));
      const b = st().player;
      return { len: Math.hypot(b.x - a.x, b.y - a.y), ddx: b.x - a.x, ddy: b.y - a.y, dir: b.dir, moving: b.moving };
    };
    if (ortho) {
      const m = measure(ortho[0], ortho[1], false);
      t.near(m.len, 140, 1.5, 'base speed ' + ortho[2]);
      t.eq(m.dir, PE.logic.dirFromVector(ortho[0], ortho[1]), 'player.dir after moving ' + ortho[2]);
      t.eq(m.moving, true, 'player.moving while walking');
      const sp = measure(ortho[0], ortho[1], true);
      t.near(sp.len, 210, 2, 'sprint speed ' + ortho[2]);
    }
    if (diag) {
      const m = measure(diag[0], diag[1], false);
      t.near(m.len, 140, 1.5, 'diagonal speed ' + diag[2] + ' (normalized)');
      t.near(Math.abs(m.ddx), Math.abs(m.ddy), 0.5, 'diagonal is 45 deg');
    }
    newRun(3);
    for (let i = 0; i < 5; i++) step(IDLE);
    t.eq(st().player.moving, false, 'player.moving false when idle');
  });

  t.test('penalty: photo with no scandal -> -150 WASTED FILM, 0.6 s cooldown, player_bad mutter', () => {
    need();
    newRun(4);
    const ev = step(Object.assign({}, IDLE, { photo: true }));
    const ph = ev.filter((e) => e.type === 'photo');
    t.eq(ph.length, 1, 'one photo event');
    const r = ph[0].result;
    t.eq([r.kind, r.points, r.label], ['no_scandal', -150, 'WASTED FILM'], 'photo result');
    t.eq(st().score, -150, 'score');
    t.eq(st().results.length, 0, 'penalty does not add a result row');
    const pb = st().player.bubble;
    t.ok(pb && PE.LINES.player_bad.includes(pb.text), 'player mutters a player_bad line (bubble ' + JSON.stringify(pb && pb.text) + ')');
    t.ok(pb && pb.style === 'player', 'player bubble style');
    // cooldown: presses within 0.6 s are ignored
    let extra = 0;
    for (let i = 1; i < Math.floor(0.55 / DT); i++) extra += step(Object.assign({}, IDLE, { photo: true })).filter((e) => e.type === 'photo').length;
    t.eq(extra, 0, 'photo events during cooldown');
    t.eq(st().score, -150, 'score unchanged during cooldown');
    for (let i = 0; i < Math.ceil(0.1 / DT); i++) step(IDLE);
    const ev2 = step(Object.assign({}, IDLE, { photo: true }));
    t.eq(ev2.filter((e) => e.type === 'photo').length, 1, 'photo accepted after cooldown');
    t.eq(st().score, -300, 'score after second wasted photo (total may go negative)');
  });

  t.test('penalty: nearby ambient NPCs (<=120 px) react to a wasted photo', () => {
    need();
    newRun(5);
    const p = st().player;
    const amb = PE.npc.people.find((q) => q.look !== 'dog' && !solidPx(q.x + 40, q.y) && !solidPx(q.x + 40, q.y - 9) && !solidPx(q.x + 40, q.y + 9) && !solidPx(q.x + 49, q.y));
    if (!amb) t.skip('SKIPPED (no ambient person with free space next to it)');
    p.x = amb.x + 40; p.y = amb.y; // harness teleport, emulating the player walking up to someone
    step(Object.assign({}, IDLE, { photo: true }));
    const near = PE.npc.people.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 120);
    t.ok(near.length > 0, 'someone nearby');
    t.ok(near.some((q) => q.bubble && PE.LINES.photographed.includes(q.bubble.text)), 'a nearby NPC says a "photographed" line (bubbles: ' + JSON.stringify(near.map((q) => q.bubble && q.bubble.text)) + ')');
  });

  t.test('penalty: photo out of range -> -100 TOO FAR, scandal stays live and is still catchable', () => {
    need();
    let out = null;
    for (let seed = 11; seed < 21 && !out; seed++) {
      const o = play(seed, 'toofar', { stopAfterResolves: 1 });
      if (o.tooFar) out = o;
    }
    t.ok(out, 'found a spawn out of range (10 seeds)');
    const ph = out.photos[0];
    t.ok(ph, 'photo event');
    t.eq([ph.result.kind, ph.result.points, ph.result.label], ['too_far', -100, 'TOO FAR'], 'result');
    t.eq(ph.preLive, true, 'scandal was live');
    const after = out.photos[1];
    t.ok(after && after.scBefore === out.tooFar.scBefore, 'the same scandal was photographed later (did not end on TOO FAR)');
    t.eq(after.result.label, 'PERFECT SHOT', 'and still PERFECT');
    t.eq(out.state.score, 1400, 'score = -100 + 1500');
    t.eq(out.resolves[0].status, 'busted', 'resolved by the scored photo');
  });

  t.test('expiry: never shooting -> 6 x 0 MISSED, run over; FIRST_DELAY 2 / expire after 18 / GAP 3 / END_DELAY 2; run <= 127 s', () => {
    need();
    const out = play(7, 'none');
    const s = out.state;
    t.eq(s.phase, 'over', 'phase'); t.eq(s.over, true, 'over flag');
    t.eq(s.results.length, 6, 'results rows');
    for (const r of s.results) {
      t.eq([r.points, r.label, r.photo], [0, 'MISSED', false], 'result ' + r.defId);
      t.ok(typeof r.title === 'string' && r.title, 'result title');
    }
    t.eq(s.score, 0, 'score');
    t.eq(out.resolves.map((r) => r.status), ['expired', 'expired', 'expired', 'expired', 'expired', 'expired'], 'statuses');
    for (let k = 0; k < 6; k++) {
      const life = (out.resolves[k].step - out.spawns[k].step) * DT;
      t.ok(life > 18 - 1e-9 && life <= 18 + 2 * DT + 1e-9, 'case ' + (k + 1) + ' expired after ' + life.toFixed(3) + ' s (t > 18)');
    }
    const total = out.overStep * DT;
    t.ok(total <= S.MAX_RUN_S + 8 * DT + 1e-9, 'max-length run <= 127 s + epsilon (got ' + total.toFixed(3) + ')');
    t.ok(total >= S.MAX_RUN_S - 0.2, 'max-length run ~127 s (got ' + total.toFixed(3) + ')');
    const rk = PE.logic.rankFor(0, PE.CFG);
    t.eq(typeof rk === 'string' ? rk : rk && rk.label, 'Tourist with a Camera', 'rank of a 0 run');
  });

  t.test('scoring in game: shot at RISE-1.0 = 826, RISE+0.3 = 916, RISE+0.4 = 889', () => {
    need();
    const shotAt = (target, expect) => {
      for (const lead of [1, 0]) {
        for (let seed = 21; seed < 31; seed++) {
          const o = play(seed, 'peak', { shootAt: target, lead, stopAfterResolves: 1 });
          const ph = o.photos.find((q) => q.result && q.result.kind === 'scored');
          if (!ph || o.notInRangeAtPeak.length) continue;
          if (Math.abs(ph.result.dt - (target - C.RISE)) <= DT / 2 + 1e-6) return ph.result;
          break; // wrong lead for this build: try the other one
        }
      }
      return null;
    };
    const a = shotAt(C.RISE - 1.0);
    t.ok(a, 'got a scored photo at RISE-1.0');
    t.eq([a.points, a.label], [826, 'FRONT PAGE'], 'shot 1 s early (dt ' + (a && a.dt.toFixed(4)) + ')');
    const c3 = shotAt(C.RISE + 0.3);
    t.ok(c3, 'got a scored photo at RISE+0.3');
    t.eq([c3.points, c3.label], [916, 'FRONT PAGE'], 'shot 0.3 s late (dt ' + (c3 && c3.dt.toFixed(4)) + ')');
    const b = shotAt(C.RISE + 0.4);
    t.ok(b, 'got a scored photo at RISE+0.4');
    t.eq([b.points, b.label], [889, 'FRONT PAGE'], 'shot 0.4 s late (dt ' + (b && b.dt.toFixed(4)) + ')');
  });

  t.test('case-1 variety over 200 seeds: >= 4 distinct spots, >= 3 defs, every player start used', () => {
    need();
    const spots = new Set(), defs = new Set(), starts = new Set(), bad = [];
    for (let seed = 1; seed <= 200; seed++) {
      newRun(seed);
      const p = st().player;
      starts.add(Math.round(p.x) + ',' + Math.round(p.y));
      for (let i = 0; i < Math.round((C.FIRST_DELAY + 1) / DT); i++) {
        const ev = step(IDLE);
        const sp = ev.find((e) => e.type === 'spawn');
        if (sp) {
          const sc = st().scandal;
          spots.add(sc.spot.id); defs.add(sc.def.id);
          if (!(sc.def.kinds || []).includes(sc.spot.kind)) bad.push('seed ' + seed + ': ' + sc.def.id + ' at ' + sc.spot.kind + ' spot');
          break;
        }
      }
    }
    t.none(bad, 'case-1 kind rule');
    t.ok(spots.size >= 4, 'distinct case-1 spots >= 4 (got ' + spots.size + ': ' + [...spots].join(',') + ')');
    t.ok(defs.size >= 3, 'distinct case-1 defs >= 3 (got ' + defs.size + ': ' + [...defs].join(',') + ')');
    const nStarts = (PE.city.playerStarts || []).length;
    t.ok(starts.size >= Math.min(3, nStarts) && starts.size === nStarts, 'player starts used ' + starts.size + '/' + nStarts);
  });

  t.test('matkot: each pair stands +-36 px along the POI axis and faces each other', () => {
    need();
    newRun(9);
    const M = (PE.city.poi || []).filter((q) => q.type === 'matkot');
    t.ok(M.length >= 2, 'matkot POIs');
    const bad = [];
    for (const m of M) {
      const ax = m.dir === 2 || m.dir === 6 ? 1 : 0, ay = 1 - ax;
      const ends = [[m.x - 36 * ax, m.y - 36 * ay], [m.x + 36 * ax, m.y + 36 * ay]];
      const who = ends.map(([x, y]) => PE.npc.people.find((q) => q.look !== 'dog' && Math.hypot(q.x - x, q.y - y) <= 4));
      if (!who[0] || !who[1]) { bad.push('pair at ' + m.x + ',' + m.y + ' dir ' + m.dir + ': nobody within 4 px of ' + JSON.stringify(ends)); continue; }
      for (let k = 0; k < 2; k++) {
        const me = who[k], other = who[1 - k];
        const want = PE.logic.dirFromVector(other.x - me.x, other.y - me.y);
        if (me.dir !== want) bad.push('pair at ' + m.x + ',' + m.y + ': player ' + k + ' faces ' + me.dir + ', expected ' + want);
      }
    }
    for (let i = 0; i < 120; i++) step(IDLE); // still in place after 2 s
    for (const m of M) {
      const ax = m.dir === 2 || m.dir === 6 ? 1 : 0, ay = 1 - ax;
      for (const sg of [-1, 1]) if (!PE.npc.people.some((q) => q.look !== 'dog' && Math.hypot(q.x - (m.x + sg * 36 * ax), q.y - (m.y + sg * 36 * ay)) <= 6)) bad.push('pair at ' + m.x + ',' + m.y + ' left its place after 2 s');
    }
    t.none(bad, 'matkot');
  });

  t.test('PERFECT window edges in game: shot landing exactly 15 steps (0.25 s) before / after RISE = PERFECT', () => {
    need();
    // Steps are 1/60 s: 0.25 s = 15 steps. Spec 6: a <= 0.25 is PERFECT; float drift of the accumulated
    // scandal t must not push an exact 15-step shot outside the window.
    const res = [];
    for (const off of [-0.25, 0.25]) {
      let got = null;
      for (const lead of [1, 0]) {
        for (let seed = 41; seed < 51 && !got; seed++) {
          const o = play(seed, 'peak', { shootAt: C.RISE + off, lead, stopAfterResolves: 1 });
          const ph = o.photos.find((q) => q.result && q.result.kind === 'scored');
          if (ph && !o.notInRangeAtPeak.length && Math.abs(ph.result.dt - off) <= DT / 2 + 1e-6) got = ph.result;
        }
        if (got) break;
      }
      t.ok(got, 'got a scored photo at RISE' + (off > 0 ? '+' : '') + off);
      res.push(off + ': dt=' + got.dt + ' -> ' + got.points + ' ' + got.label);
      if (got.points !== 1500) t.fail('shot ' + (off > 0 ? 'late' : 'early') + ' by exactly 15 steps scored ' + got.points + ' ' + got.label + ' (dt=' + got.dt + '), spec 6: |dt| <= 0.25 is PERFECT');
    }
  });

  t.test('busted during the lean-in: no peak event (shot at RISE-0.5 = 911)', () => {
    need();
    let o = null;
    for (const lead of [1, 0]) {
      for (let seed = 31; seed < 41 && !o; seed++) {
        const r = play(seed, 'peak', { shootAt: C.RISE - 0.5, lead, stopAfterResolves: 1 });
        const ph = r.photos.find((q) => q.result && q.result.kind === 'scored');
        if (ph && !r.notInRangeAtPeak.length && Math.abs(ph.result.dt + 0.5) <= DT / 2 + 1e-6) o = { r, ph };
      }
      if (o) break;
    }
    t.ok(o, 'got a scored photo at RISE-0.5');
    t.eq([o.ph.result.points, o.ph.result.label], [911, 'FRONT PAGE'], 'points (dt ' + o.ph.result.dt.toFixed(4) + ')');
    t.eq(o.r.resolves[0] && o.r.resolves[0].status, 'busted', 'case 1 busted');
    // keep stepping through the would-be peak moment: still no peak event for case 1
    for (let i = 0; i < Math.round(1.5 / DT); i++) { const ev = step(IDLE); if (ev.some((e) => e.type === 'peak') && st().caseNo === 1) o.r.peaks.push({ late: true }); }
    t.eq(o.r.peaks.filter((p) => p.caseNo === 1 || p.late).length, 0, 'peak events for a scandal busted in the lean-in');
  });

  t.test('game.drawOver(ctx, cam) exists (peak flare above people)', () => {
    need();
    t.eq(typeof PE.game.drawOver, 'function', 'PE.game.drawOver');
    t.eq(typeof PE.game.drawUnder, 'function', 'PE.game.drawUnder');
  });

  t.test('game.update tolerates a missing PE.cam (default cam centred on the player)', () => {
    need();
    newRun(10);
    const saved = PE.cam;
    try {
      delete PE.cam;
      for (let i = 0; i < Math.round(3 / DT); i++) inside(() => PE.game.update(DT, IDLE));
      t.ok(st().scandal, 'a scandal spawned without PE.cam');
    } finally { PE.cam = saved; }
  });

  const botRuns = new Map();
  let botSummary = null;

  t.test('bot: reach-in-time over ' + SEEDS + ' seeds - BFS walk at base speed, shoot at t >= RISE -> 6 x PERFECT SHOT, phase over', () => {
    need();
    const bad = [];
    let done = 0, aborted = '';
    const runStart = Date.now();
    for (let seed = 1; seed <= SEEDS; seed++) {
      // keep ~3 runs of budget in reserve for the determinism test
      const per = done ? (Date.now() - runStart) / done : 0;
      if (done && Date.now() + 3 * per > deadline()) { aborted = 'stopped by time budget'; break; }
      let out;
      try { out = play(seed, 'peak'); } catch (e) { if (e instanceof BudgetError) { aborted = e.message; break; } throw e; }
      done++;
      botRuns.set(seed, fingerprint(out));
      const s = out.state;
      const lab = s.results.map((r) => r.label);
      if (s.phase !== 'over' || !s.over) bad.push('seed ' + seed + ': run not over (phase ' + s.phase + ', ' + s.results.length + ' results, ' + out.steps + ' steps)');
      if (s.results.length !== 6 || lab.some((l) => l !== 'PERFECT SHOT')) {
        bad.push('seed ' + seed + ': results ' + JSON.stringify(s.results.map((r) => r.defId + ':' + r.label + '(' + (+r.dt || 0).toFixed(2) + ')')));
      }
      for (const q of out.notInRangeAtPeak) bad.push('seed ' + seed + ': NOT IN RANGE at peak for ' + q.sc.def.id + ' at spot ' + (q.sc.spot && q.sc.spot.id) + ' (d=' + q.d.toFixed(0) + ' px, ' + q.path + ' tiles left)');
      if (s.score !== 9000) bad.push('seed ' + seed + ': score ' + s.score + ' != 9000');
      for (const ph of out.photos) if (!(Math.abs(ph.result.dt) <= C.PERFECT_WINDOW)) bad.push('seed ' + seed + ': photo dt ' + ph.result.dt);
      if (bad.length > 30) break;
    }
    const ms = Date.now() - runStart;
    botSummary = { done, ms };
    if (INV.waits.length) console.log('       info: avg wait in range before the shot ' + (INV.waits.reduce((a, b) => a + b, 0) / INV.waits.length).toFixed(2) + ' s (' + INV.waits.length + ' cases)');
    console.log('       info: ' + done + '/' + SEEDS + ' seeds in ' + (ms / 1000).toFixed(1) + ' s (' + (done ? (ms / done).toFixed(0) : '-') + ' ms/run), spawn path tiles min/avg/max = ' +
      (INV.spawnPaths.length ? Math.min(...INV.spawnPaths) + '/' + (INV.spawnPaths.reduce((a, b) => a + b, 0) / INV.spawnPaths.length).toFixed(1) + '/' + Math.max(...INV.spawnPaths) : '-'));
    t.none(bad, 'bot failures');
    if (done < SEEDS) t.fail('only ' + done + '/' + SEEDS + ' seeds ran within HUSH_SIM_BUDGET_MS=' + BUDGET_MS + ' (' + aborted + '; ' + (done ? (ms / done).toFixed(0) : '?') + ' ms/run)');
  });

  t.test('determinism: same seed -> identical results, positions and crowd (re-run after other seeds)', () => {
    need();
    const seeds = [5, Math.min(SEEDS, 77)];
    for (const seed of seeds) {
      const a = botRuns.get(seed) || fingerprint(play(seed, 'peak', { noBudget: true }));
      play(seed === 5 ? 6 : 5, 'peak', { noBudget: true, stopAfterResolves: 1 }); // disturb global state
      const b = fingerprint(play(seed, 'peak', { noBudget: true }));
      t.ok(a === b, 'seed ' + seed + ' differs:\n         A ' + a.slice(0, 400) + '\n         B ' + b.slice(0, 400));
    }
  });

  // ---------- invariants aggregated over every simulated run above ----------
  const inv = (name, key, extra) => t.test('invariant: ' + name, () => {
    need();
    if (!INV.runs) t.skip('SKIPPED (no simulated runs completed)');
    t.none(INV[key], name + ' (' + INV.runs + ' runs, ' + INV.steps + ' steps)');
    if (extra) extra();
  });
  inv('only one scandal live at a time; phase "live" <=> scandal.status "live"', 'oneLive');
  inv('spawn path from the player <= 40 tiles (and >= 8)', 'spawnPath', () => t.ok(INV.spawnPaths.length > 0, 'spawns observed'));
  inv('deck: no def repeated within a run, spot never reused back-to-back, spot kind in def.kinds', 'deckSpot');
  inv('no player, scandal actor or ambient person on a solid tile', 'solid');
  inv('<= 3 ambient bubbles inside the camera (vehicles count)', 'bubbles');
  inv('bubble texts are non-empty strings', 'bubbleText');
  inv('scandal state consistent (focus, intensity, d, prox, inRange, actor glow)', 'scState');
  inv('scandal lines fire as t crosses each "at" (role bubble, style scandal)', 'lines');
  inv('peak event exactly once per live scandal, at the first step with t >= RISE', 'peak');
  inv('actor action null before RISE, def.peak.action in [RISE, RISE+ACTION_TAIL]', 'action');
  inv('at most one scandal-style bubble at any step', 'oneBubble');
  inv('dogs never teleport on camera (only > 300 px, both off-screen)', 'dogs');
  inv('npc bubbles: no two live bubbles share a line; no speaker repeats its last line', 'dupLine');
  inv('lean-in: <= 2.5 px/step, arrives >= 0.35 s before the pop, no walk cycle while standing', 'lean');
  inv('resolution: bust/expire line within 1 s, glow off after BUST_FADE, actors removed (4 s / 5 s), player_good / player_miss lines', 'resolution');
  inv('timing: FIRST_DELAY 2 s, GAP 3 s after every resolve, END_DELAY 2 s', 'timing');

  t.test('invariant: no Math.random during newRun/update (seeded RNG only)', () => {
    need();
    if (!INV.runs) t.skip('SKIPPED (no simulated runs completed)');
    t.eq(randomCalls, 0, 'Math.random calls during game logic' + (randomWhere ? ' (first from ' + randomWhere + ')' : ''));
  });

  t.test('perf: average game.update() well under the 2 ms budget', () => {
    need();
    if (!updSteps) t.skip('SKIPPED (no steps measured)');
    const avgUs = Number(updNs / BigInt(updSteps)) / 1000;
    console.log('       info: ' + updSteps + ' updates, avg ' + avgUs.toFixed(1) + ' us, max ' + (Number(updMaxNs) / 1e6).toFixed(2) + ' ms (after warm-up); suite elapsed ' + ((Date.now() - suiteStart) / 1000).toFixed(1) + ' s');
    t.ok(avgUs <= 2000, 'avg update ' + avgUs.toFixed(0) + ' us > 2000 us');
  });
};
