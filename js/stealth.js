// HUSH MONEY v2 night - stealth.js (owner: eng-lead)
// Pure, headless gameplay light / sight / suspicion / photo-angle math (docs/06 decisions 3-6).
// No DOM, no Math.random. A "world" = occlusion grid + light contributions:
//   - the module default world is built by init(city, cfg) (night-game uses it);
//   - buildLightGrid(grid, lights, cover, env) returns a stand-alone world (tests, light.js agreement checks).
// Every query takes an optional world as its LAST argument (default: the init() world).
// Angles: screen radians, 0 = east, +y = south. Facing of a person: p.faceA (radians) if set, else dir 0..7 (0 = N).
(function (PE) {
  'use strict';

  function num(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function NIGHT() { return PE.NIGHT || {}; }
  // detection numbers: PE.NIGHT.DETECT {fov, range, ambientAll, litMin} (06 decision 5 fallbacks)
  function params() {
    var d = NIGHT().DETECT || {};
    return { fov: num(d.fov, 70), range: num(d.range, 150), ambientAll: num(d.ambientAll, 0.5), litMin: num(d.litMin, 0.35) };
  }
  function smooth01(u) { u = u < 0 ? 0 : (u > 1 ? 1 : u); return u * u * (3 - 2 * u); }
  function falloff(d, r) { return d >= r ? 0 : 1 - smooth01(d / r); }

  // ---------------------------------------------------------------- worlds
  function newWorld() { return { ready: false, w: 0, h: 0, T: 32, occ: null, lights: [], contrib: [], grid: null, gLamp: NaN, gCase: NaN, env: null }; }
  var S = newWorld();                                  // default world (init)

  function occAt(W, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W.w || ty >= W.h) return true;
    return W.occ[ty * W.w + tx] === 1;
  }

  // First blocking tile on (x0,y0)->(x1,y1), skipping the start and end tiles: hit fraction t in (0,1], or -1 if clear.
  function rayHit(x0, y0, x1, y1, W) {
    W = W || S;
    if (!W.ready) return -1;
    var T = W.T, tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
    var ex = Math.floor(x1 / T), ey = Math.floor(y1 / T);
    if (tx === ex && ty === ey) return -1;
    var dx = x1 - x0, dy = y1 - y0;
    var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var tMaxX = adx > 0 ? (sx > 0 ? (tx + 1) * T - x0 : x0 - tx * T) / adx : Infinity;
    var tMaxY = ady > 0 ? (sy > 0 ? (ty + 1) * T - y0 : y0 - ty * T) / ady : Infinity;
    var tdX = adx > 0 ? T / adx : Infinity, tdY = ady > 0 ? T / ady : Infinity;
    for (var guard = 0; guard < 4096; guard++) {
      var t;
      if (tMaxX < tMaxY) { t = tMaxX; tx += sx; tMaxX += tdX; } else { t = tMaxY; ty += sy; tMaxY += tdY; }
      if (t > 1) return -1;
      if (tx === ex && ty === ey) return -1;
      if (occAt(W, tx, ty)) return t;
    }
    return -1;
  }

  // Occlusion (city.js contract): BUILDING + KIOSK tiles + cover with blocksSight block sight AND light.
  // Trees, stalls, fountain etc. are solid for walking but see-through. Grids without city tile ids
  // (synthetic test worlds) fall back to every solid tile except see-over cover. Cover rects are in tiles.
  function buildOcc(W, grid, cover, Tid) {
    var n = W.w * W.h, i, low = new Uint8Array(n);
    var useIds = false, tb = -1, tk = -1;
    if (Tid && grid.tile && typeof Tid.BUILDING === 'number') {
      tb = Tid.BUILDING; tk = typeof Tid.KIOSK === 'number' ? Tid.KIOSK : -1;
      for (i = 0; i < n && !useIds; i++) if (grid.tile[i] === tb) useIds = true;
    }
    W.occ = new Uint8Array(n);
    cover = cover || [];
    for (i = 0; i < cover.length; i++) {
      var c = cover[i];
      if (!c) continue;
      for (var cy = c.y; cy < c.y + (c.h || 1); cy++) for (var cx = c.x; cx < c.x + (c.w || 1); cx++) {
        if (cx < 0 || cy < 0 || cx >= W.w || cy >= W.h) continue;
        if (c.blocksSight) W.occ[cy * W.w + cx] = 1; else low[cy * W.w + cx] = 1;
      }
    }
    if (useIds) { for (i = 0; i < n; i++) if (grid.tile[i] === tb || grid.tile[i] === tk) W.occ[i] = 1; }
    else for (i = 0; i < n; i++) if (grid.solid[i] && !low[i]) W.occ[i] = 1;
  }
  // Per light: LOS-occluded tile contributions (intensity x smooth falloff), sparse.
  function buildLights(W, lights) {
    W.lights = lights || []; W.contrib = [];
    var T = W.T, ti = [], tv = [];
    for (var j = 0; j < W.lights.length; j++) {
      var L = W.lights[j], r = num(L.r, 96), I = num(L.intensity, 1);
      ti.length = 0; tv.length = 0;
      var x0 = Math.max(0, Math.floor((L.x - r) / T)), x1 = Math.min(W.w - 1, Math.floor((L.x + r) / T));
      var y0 = Math.max(0, Math.floor((L.y - r) / T)), y1 = Math.min(W.h - 1, Math.floor((L.y + r) / T));
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        var k = y * W.w + x;
        if (W.occ[k]) continue;
        var px = x * T + T / 2, py = y * T + T / 2, d = Math.sqrt((px - L.x) * (px - L.x) + (py - L.y) * (py - L.y));
        if (d >= r) continue;
        if (rayHit(L.x, L.y, px, py, W) >= 0) continue;
        ti.push(k); tv.push(I * falloff(d, r));
      }
      W.contrib.push({ idx: new Int32Array(ti), val: new Float32Array(tv) });
    }
    W.grid = new Float32Array(W.w * W.h);
    W.gLamp = NaN; W.gCase = NaN;
  }
  function makeWorld(W, grid, lights, cover, tile, Tid) {
    W.ready = false;
    if (!grid || !grid.solid) return W;
    W.w = grid.w; W.h = grid.h; W.T = num(tile, 32); W.Tid = Tid || null;
    buildOcc(W, grid, cover, Tid);
    W.ready = true;
    buildLights(W, lights);
    return W;
  }

  // Default world from the city (night mode: city.lights + city.cover).
  function init(city, cfg) { return makeWorld(S, city && city.grid, city && city.lights, city && city.cover, cfg && cfg.TILE, city && city.T); }
  // Stand-alone world; env (if given) becomes the world's default env for lightAt / seen. tileIds = city.T (optional).
  function buildLightGrid(grid, lights, cover, env, tile, tileIds) {
    var W = makeWorld(newWorld(), grid, lights, cover, num(tile, (PE.CFG && PE.CFG.TILE) || 32), tileIds);
    W.env = env || null;
    return W;
  }
  function isWorld(o) { return !!o && typeof o === 'object' && o.occ !== undefined && o.contrib !== undefined; }

  // Lamp grid for env {lampLevel, caseNo}: active lights (fromCase <= caseNo; no caseNo = all) x lampLevel, clamped to 1.
  function ensureGrid(W, env) {
    var lamp = num(env && env.lampLevel, 0), cn = num(env && env.caseNo, 99);
    if (lamp === W.gLamp && cn === W.gCase) return;
    W.gLamp = lamp; W.gCase = cn;
    var g = W.grid, i, j;
    g.fill(0);
    if (lamp > 0) {
      for (j = 0; j < W.lights.length; j++) {
        if (num(W.lights[j].fromCase, 0) > cn) continue;
        var c = W.contrib[j];
        for (i = 0; i < c.idx.length; i++) g[c.idx[i]] += c.val[i] * lamp;
      }
      for (i = 0; i < g.length; i++) if (g[i] > 1) g[i] = 1;
    }
  }
  function cell(W, tx, ty) { return (tx < 0 || ty < 0 || tx >= W.w || ty >= W.h) ? 0 : W.grid[ty * W.w + tx]; }

  // Local LAMP light at (x, y) px, 0..1 (bilinear over tile centres; ambient NOT included).
  // Pinned: lightAt(x, y, env, world?). Also accepts lightAt(world, x, y) (uses world.env).
  function lightAt(x, y, env, W) {
    if (isWorld(x)) { W = x; x = y; y = env; env = W.env; }
    W = W || S;
    if (!W.ready) return 0;
    ensureGrid(W, env || W.env);
    var T = W.T, gx = x / T - 0.5, gy = y / T - 0.5;
    var x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    var v = (cell(W, x0, y0) * (1 - fx) + cell(W, x0 + 1, y0) * fx) * (1 - fy) + (cell(W, x0, y0 + 1) * (1 - fx) + cell(W, x0 + 1, y0 + 1) * fx) * fy;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  // Effective light on a subject: max(ambient, lamp light).
  function litLevel(x, y, env, W) { return Math.max(num(env && env.ambient, 1), lightAt(x, y, env, W)); }

  // Line of sight between points {x, y} px; start/end tiles never block.
  // Pinned: los(a, b, world?). Also accepts los(grid, cover, x0, y0, x1, y1) (world cached per grid+cover).
  var losCache = { grid: null, cover: null, W: null };
  function los(a, b, W) {
    if (a && a.solid !== undefined && !isWorld(a)) {
      var grid = a, cover = b, args = arguments;
      if (losCache.grid !== grid || losCache.cover !== cover) {
        losCache.grid = grid; losCache.cover = cover; losCache.W = makeWorld(newWorld(), grid, [], cover, (PE.CFG && PE.CFG.TILE) || 32, S.Tid);
      }
      return rayHit(args[2], args[3], args[4], args[5], losCache.W) < 0;
    }
    if (!a || !b) return true;
    return rayHit(a.x, a.y, b.x, b.y, W) < 0;
  }

  // ---------------------------------------------------------------- cones / detection
  function facingAngle(p) {
    if (typeof p.faceA === 'number') return p.faceA;
    return (num(p.dir, 4) * 45 - 90) * Math.PI / 180;
  }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  function inCone(w, x, y, fovDeg, range) {
    var dx = x - w.x, dy = y - w.y, d2 = dx * dx + dy * dy;
    if (d2 > range * range) return false;
    if (d2 < 1) return true;
    return Math.abs(angDiff(Math.atan2(dy, dx), facingAngle(w))) <= fovDeg * Math.PI / 360;
  }

  // Detection (06 decision 5): w.coneOn !== false AND in cone (70 deg / 150 px) AND LOS AND
  // (ambient >= 0.5 OR lamp light at p >= 0.35). Pinned: seen(w, p, env, world?).
  function seen(w, p, env, W) {
    if (!w || w.coneOn === false) return false;
    var D = params();
    env = env || (W && W.env);
    if (!inCone(w, p.x, p.y, D.fov, D.range)) return false;
    if (rayHit(w.x, w.y, p.x, p.y, W) >= 0) return false;
    return num(env && env.ambient, 1) >= D.ambientAll || lightAt(p.x, p.y, env, W) >= D.litMin;
  }
  // canSee(w, p, {env, lightGrid|light: world}) - same rule, test-friendly shape.
  function canSee(w, p, ctx) {
    ctx = ctx || {};
    var W = isWorld(ctx.lightGrid) ? ctx.lightGrid : (isWorld(ctx.light) ? ctx.light : (isWorld(ctx.world) ? ctx.world : undefined));
    return seen(w, p, ctx.env || (W && W.env), W);
  }

  // LOS-clipped cone polygon for drawing: out = [ox, oy, x0, y0, ... xN, yN] (Float32Array, reused when given).
  // Callers recompute it at 10 Hz (night-game does). Pinned: conePoly(w, fovDeg, range, rays, out, world?).
  function conePoly(w, fovDeg, range, rays, out, W) {
    var D = params();
    fovDeg = num(fovDeg, D.fov); range = num(range, D.range); rays = Math.max(2, num(rays, 18) | 0);
    var len = 2 + 2 * (rays + 1);
    if (!out || out.length !== len) out = new Float32Array(len);
    out[0] = w.x; out[1] = w.y;
    var a0 = facingAngle(w) - fovDeg * Math.PI / 360, da = fovDeg * Math.PI / 180 / rays;
    for (var i = 0; i <= rays; i++) {
      var a = a0 + da * i, ex = w.x + Math.cos(a) * range, ey = w.y + Math.sin(a) * range;
      var t = rayHit(w.x, w.y, ex, ey, W), f = t < 0 ? 1 : t;
      out[2 + i * 2] = w.x + (ex - w.x) * f; out[3 + i * 2] = w.y + (ey - w.y) * f;
    }
    return out;
  }

  // ---------------------------------------------------------------- suspicion
  // Tables: PE.NIGHT.SUSP (Tamar's T2, derived in night-data.js) else these starting values.
  var SUSP0 = { seenRate: 20, nearPx: 60, nearMult: 2, farPx: 150, farMult: 1, sprintMult: 1.4, photoBump: 20,
    brightLight: 0.6, decay: 12, decayDelay: 1.0, uneasy: 35, cagey: 65, abort: 100 };
  var tabCache = null, tabSrc = null, tabSrc2 = null;
  function tables() {
    var src = NIGHT().SUSP || null, src2 = NIGHT().SUSPICION || null;
    if (tabCache && tabSrc === src && tabSrc2 === src2) return tabCache;
    var t = src || {}, o = {};
    for (var k in SUSP0) o[k] = num(t[k], SUSP0[k]);
    if (src2 && typeof src2.BRIGHT_LIGHT === 'number' && typeof t.brightLight !== 'number') o.brightLight = src2.BRIGHT_LIGHT;
    tabCache = o; tabSrc = src; tabSrc2 = src2;
    return o;
  }
  // Pinned: suspicionStep(s, dt, info, tables?) -> new suspicion 0..100.
  // info = {seen:bool, dist:px to the nearest seeing watcher, sprint:bool, photo:bool (shutter pressed while seen),
  //         unseenFor:s (time since last seen), lit:0..1 lamp light at the player, brightMult:number (seeing watcher's)}
  // Legacy form suspicionStep(s, seen:boolean, dt) is accepted (seen at the far rate, decay after decayDelay).
  function suspicionStep(s, dt, info, tab) {
    if (typeof dt === 'boolean') { var sn = dt; dt = info; info = { seen: sn, unseenFor: sn ? 0 : 99 }; tab = undefined; }
    tab = tab || tables();
    s = num(s, 0); dt = num(dt, 0);
    if (info && info.seen) {
      var r = tab.seenRate, d = num(info.dist, tab.farPx);
      if (d <= tab.nearPx) r *= tab.nearMult; else if (d >= tab.farPx) r *= tab.farMult;
      if (info.sprint) r *= tab.sprintMult;
      if (typeof info.brightMult === 'number' && num(info.lit, 0) > tab.brightLight) r *= info.brightMult;
      s += r * dt;
      if (info.photo) s += tab.photoBump;
    } else if (num(info && info.unseenFor, 0) >= tab.decayDelay) {
      s -= tab.decay * dt;
    }
    return s < 0 ? 0 : (s > tab.abort ? tab.abort : s);
  }
  // 'calm' | 'uneasy' | 'cagey' | 'abort'
  function suspicionState(s, tab) {
    tab = tab || tables();
    return s >= tab.abort ? 'abort' : (s >= tab.cagey ? 'cagey' : (s >= tab.uneasy ? 'uneasy' : 'calm'));
  }

  // ---------------------------------------------------------------- photo angle (06 decision 4)
  var W0 = { frame: 0.35, los: 0.25, lit: 0.20, dist: 0.15, faces: 0.05 };
  // Pinned: angleScore(o, world?) with o = {x, y, dir|faceA (camera), subjects:[{x, y, dir|faceA}], env, range, fov?}
  // -> {M, A, frame, los, lit, dist, faces, n, inFrame, inLos, facing, litPct, d, meters}; M = 0.5 + 0.5*A.
  function angleScore(o, Wd) {
    var M_ = NIGHT().M || {}, w = M_.w || W0;
    var range = num(o.range, 170), fov = num(o.fov, num(M_.fov, 70));
    // lit = clamp(mean subject light / LIT_NORM, 0, 1) (Dana, M1 step 1): PE.NIGHT.M.litNorm or PE.NIGHT.ANGLE.LIT_NORM, else 0.5
    var A_ = NIGHT().ANGLE || {}, litNorm = num(M_.litNorm, num(A_.LIT_NORM, 0.5));
    var dNear = num(M_.distNear, 0.45), dMin = num(M_.distMin, 0.4);
    var subs = o.subjects || [], n = subs.length, cam = { x: o.x, y: o.y, dir: o.dir, faceA: o.faceA };
    var inF = 0, inL = 0, litSum = 0, faceN = 0, dSum = 0;
    for (var i = 0; i < n; i++) {
      var s = subs[i];
      if (inCone(cam, s.x, s.y, fov, range)) inF++;
      if (rayHit(o.x, o.y, s.x, s.y, Wd) < 0) inL++;
      litSum += litLevel(s.x, s.y, o.env, Wd);
      dSum += Math.sqrt((s.x - o.x) * (s.x - o.x) + (s.y - o.y) * (s.y - o.y));
      var fa = facingAngle(s), toCam = Math.atan2(o.y - s.y, o.x - s.x);
      if (Math.abs(angDiff(fa, toCam)) < Math.PI / 2) faceN++;              // face visible: subject faces the camera
    }
    var frame = n ? inF / n : 0, l = n ? inL / n : 0, faces = n ? faceN / n : 0;
    var lit = n ? Math.max(0, Math.min(1, (litSum / n) / litNorm)) : 0;
    var md = n ? dSum / n : range;                                          // mean camera-to-subject distance
    var near = dNear * range, dist;
    if (typeof NIGHT().distTerm === 'function') dist = num(NIGHT().distTerm(md), 0);   // Dana: night-data is the source (too-close ramp)
    else dist = md <= near ? 1 : Math.max(dMin, 1 - (1 - dMin) * (md - near) / Math.max(1, range - near));
    dist = dist < 0 ? 0 : (dist > 1 ? 1 : dist);
    var A = num(w.frame, W0.frame) * frame + num(w.los, W0.los) * l + num(w.lit, W0.lit) * lit + num(w.dist, W0.dist) * dist + num(w.faces, W0.faces) * faces;
    A = A < 0 ? 0 : (A > 1 ? 1 : A);
    return { M: 0.5 + 0.5 * A, A: A, frame: frame, los: l, lit: lit, dist: dist, faces: faces,
      n: n, inFrame: inF, inLos: inL, facing: faceN, litPct: Math.round(lit * 100), d: md, meters: Math.round(md / 16) };
  }

  PE.stealth = {
    init: init, buildLightGrid: buildLightGrid, falloff: falloff, ready: function () { return S.ready; }, world: S, params: params,
    los: los, rayHit: rayHit, lightAt: lightAt, litLevel: litLevel,
    facingAngle: facingAngle, inCone: inCone, seen: seen, canSee: canSee, conePoly: conePoly,
    suspicionStep: suspicionStep, suspicionState: suspicionState, tables: tables,
    angleScore: angleScore
  };
})(globalThis.PE = globalThis.PE || {});
