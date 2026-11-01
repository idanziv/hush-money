// HUSH MONEY - logic.js (owner: eng-lead)
// Pure functions only (spec 14.5). No DOM, no PE.city. cfg is always passed in.
(function (PE) {
  'use strict';

  var DEFAULT_GRADES = [
    { min: 1500, label: 'PERFECT SHOT' },
    { min: 750, label: 'FRONT PAGE' },
    { min: 400, label: 'JUICY' },
    { min: 150, label: 'TABLOID FILLER' },
    { min: -Infinity, label: 'BLURRY GOSSIP' }
  ];
  var DEFAULT_RANKS = [
    { min: 7500, label: 'Kingpin of Kompromat' },
    { min: 5000, label: 'Professional Sleazeball' },
    { min: 2500, label: 'Paparazzo with Debts' },
    { min: 0, label: 'Tourist with a Camera' },
    { min: -Infinity, label: 'Owes the Tabloids Money' }
  ];

  function num(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }

  // ---- glow curve (spec 4) ----
  function intensityAt(t, cfg) {
    var RISE = num(cfg && cfg.RISE, 11), FALL = num(cfg && cfg.FALL, 7);
    var MIN = num(cfg && cfg.MIN_GLOW, 0.10);
    if (!(t >= 0) || t > RISE + FALL) return 0;
    if (t <= RISE) { var u = t / RISE; return MIN + (1 - MIN) * u * u; }
    var v = (t - RISE) / FALL, w = 1 - v;
    return w * w;
  }

  function isLive(t, cfg) {
    var RISE = num(cfg && cfg.RISE, 11), FALL = num(cfg && cfg.FALL, 7);
    return t >= 0 && t <= RISE + FALL;
  }

  // ---- scoring (spec 6) ----
  function pickLabel(list, value) {
    for (var i = 0; i < list.length; i++) { if (value >= list[i].min) return list[i].label; }
    return list.length ? list[list.length - 1].label : '';
  }
  function gradeFor(points, cfg) {
    var g = (cfg && cfg.GRADES && cfg.GRADES.length) ? cfg.GRADES : DEFAULT_GRADES;
    return pickLabel(g, points);
  }
  function rankFor(total, cfg) {
    var r = (cfg && cfg.RANKS && cfg.RANKS.length) ? cfg.RANKS : DEFAULT_RANKS;
    return pickLabel(r, total);
  }

  function scorePhoto(o, cfg) {
    o = o || {};
    var RISE = num(cfg && cfg.RISE, 11), FALL = num(cfg && cfg.FALL, 7);
    var t = num(o.t, NaN);
    var dt = isNaN(t) ? null : t - RISE;
    if (!o.live) return { kind: 'no_scandal', points: -num(cfg && cfg.PENALTY_NO_SCANDAL, 150), label: 'WASTED FILM', dt: dt };
    if (!o.inRange) return { kind: 'too_far', points: -num(cfg && cfg.PENALTY_TOO_FAR, 100), label: 'TOO FAR', dt: dt };
    var BASE = num(cfg && cfg.BASE_POINTS, 1000);
    var a = Math.abs(dt || 0), points;
    if (a <= num(cfg && cfg.PERFECT_WINDOW, 0.25) + 1e-9) {   // epsilon: t accumulates in DT steps (QA B3)
      points = BASE + num(cfg && cfg.PERFECT_BONUS, 500);
    } else {
      var W = dt < 0 ? RISE : FALL;
      var q = Math.min(1, a / W), k = 1 - q;
      points = Math.max(num(cfg && cfg.MIN_POINTS, 50), Math.round(BASE * k * k));
    }
    return { kind: 'scored', points: points, label: gradeFor(points, cfg), dt: dt };
  }

  // ---- geometry ----
  function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }

  function proximity(d, cfg) {
    var R = num(cfg && cfg.PHOTO_RANGE, 170);
    if (d <= R) return 2;
    if (d <= R * num(cfg && cfg.NEAR_MULT, 1.6)) return 1;
    return 0;
  }

  function dirFromVector(dx, dy) {
    return (Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) + 8) % 8;
  }

  // Screen-space indicator. onScreen = target inside the view inset by `inset`.
  // Off-screen: x,y = point where the ray from screen center to target meets the rect inset by `clampInset`.
  // angle = atan2(dy, dx) of (target - screen center), screen radians.
  function edgeArrow(cam, tx, ty, inset, clampInset) {
    var w = num(cam && cam.w, 960), h = num(cam && cam.h, 540);
    var ins = num(inset, 0), cins = num(clampInset, ins);
    var sx = tx - num(cam && cam.x, 0), sy = ty - num(cam && cam.y, 0);
    var cx = w / 2, cy = h / 2, vx = sx - cx, vy = sy - cy;
    var angle = Math.atan2(vy, vx);
    var on = sx >= ins && sx <= w - ins && sy >= ins && sy <= h - ins;
    if (on) return { onScreen: true, x: sx, y: sy, angle: angle };
    var hw = Math.max(0, cx - cins), hh = Math.max(0, cy - cins);
    var s = Infinity;
    if (vx !== 0) s = Math.min(s, hw / Math.abs(vx));
    if (vy !== 0) s = Math.min(s, hh / Math.abs(vy));
    if (s === Infinity) s = 0;
    return { onScreen: false, x: cx + vx * s, y: cy + vy * s, angle: angle };
  }

  // ---- grid ----
  function isSolidTile(grid, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return true;
    return grid.solid[ty * grid.w + tx] !== 0;
  }

  // Does the box [x-r, x+r) x [y-r, y+r) overlap a solid tile?
  function boxHits(grid, x, y, r, tile) {
    var tx0 = Math.floor((x - r) / tile), tx1 = Math.floor((x + r - 1e-4) / tile);
    var ty0 = Math.floor((y - r) / tile), ty1 = Math.floor((y + r - 1e-4) / tile);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) { if (isSolidTile(grid, tx, ty)) return true; }
    }
    return false;
  }

  function moveAxis(grid, x, y, d, r, tile, axisX) {
    // returns new coordinate along the axis
    var maxX = grid.w * tile - r, maxY = grid.h * tile - r;
    if (axisX) {
      var nx = Math.max(r, Math.min(maxX, x + d));
      if (!boxHits(grid, nx, y, r, tile)) return nx;
      if (nx > x) { var txr = Math.floor((nx + r - 1e-4) / tile); nx = Math.max(x, txr * tile - r); }
      else { var txl = Math.floor((nx - r) / tile); nx = Math.min(x, (txl + 1) * tile + r); }
      return boxHits(grid, nx, y, r, tile) ? x : nx;
    }
    var ny = Math.max(r, Math.min(maxY, y + d));
    if (!boxHits(grid, x, ny, r, tile)) return ny;
    if (ny > y) { var tyd = Math.floor((ny + r - 1e-4) / tile); ny = Math.max(y, tyd * tile - r); }
    else { var tyu = Math.floor((ny - r) / tile); ny = Math.min(y, (tyu + 1) * tile + r); }
    return boxHits(grid, x, ny, r, tile) ? y : ny;
  }

  // Nearest walkable tile center (Euclidean) to (x, y); writes into o. Returns false if the grid has none.
  function nearestFreeCenter(grid, x, y, tile, o) {
    var tx = Math.floor(x / tile), ty = Math.floor(y / tile), best = Infinity, maxR = Math.max(grid.w, grid.h);
    for (var rr = 0; rr <= maxR; rr++) {
      if ((rr - 1) * tile > best) break;            // no tile in this ring can be closer
      for (var yy = ty - rr; yy <= ty + rr; yy++) {
        for (var xx = tx - rr; xx <= tx + rr; xx++) {
          if (Math.max(Math.abs(xx - tx), Math.abs(yy - ty)) !== rr) continue;   // ring only
          if (isSolidTile(grid, xx, yy)) continue;
          var cx = xx * tile + tile / 2, cy = yy * tile + tile / 2;
          var d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
          if (d < best * best || best === Infinity) { best = Math.sqrt(d); o.x = cx; o.y = cy; }
        }
      }
    }
    return best !== Infinity;
  }

  // Axis-separated movement of a box of half-size r. Never enters a solid tile; clamps to map.
  // A body that starts overlapping solid is first pushed to the nearest free tile center.
  // Writes into `out` when given (no allocation), else returns a fresh {x, y}.
  function moveAndCollide(grid, x, y, dx, dy, r, tile, out) {
    var o = (out && typeof out === 'object') ? out : { x: 0, y: 0 };
    tile = num(tile, 32); r = num(r, 7); dx = num(dx, 0); dy = num(dy, 0);
    if (!grid || !grid.solid) { o.x = x + dx; o.y = y + dy; return o; }
    if (boxHits(grid, x, y, r, tile)) {
      if (!nearestFreeCenter(grid, x, y, tile, o)) { o.x = x; o.y = y; return o; }
      x = o.x; y = o.y;
    }
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, Math.min(r, tile / 2))));
    var sx = dx / steps, sy = dy / steps;
    for (var i = 0; i < steps; i++) {
      if (sx !== 0) x = moveAxis(grid, x, y, sx, r, tile, true);
      if (sy !== 0) y = moveAxis(grid, x, y, sy, r, tile, false);
    }
    o.x = x; o.y = y;
    return o;
  }

  // BFS over walkable tiles, 4-neighbour. Returns Int16Array w*h of step counts, -1 unreachable / beyond maxSteps.
  function bfsTiles(grid, tx, ty, maxSteps) {
    var w = grid.w, h = grid.h, n = w * h;
    var out = new Int16Array(n);
    out.fill(-1);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return out;
    var lim = (typeof maxSteps === 'number' && maxSteps >= 0) ? maxSteps : Infinity;
    var q = new Int32Array(n), head = 0, tail = 0, s = ty * w + tx;
    out[s] = 0; q[tail++] = s;
    var solid = grid.solid;
    while (head < tail) {
      var i = q[head++], d = out[i];
      if (d >= lim) continue;
      var x = i % w, y = (i - x) / w, nd = d + 1, j;
      if (x > 0) { j = i - 1; if (out[j] < 0 && !solid[j]) { out[j] = nd; q[tail++] = j; } }
      if (x < w - 1) { j = i + 1; if (out[j] < 0 && !solid[j]) { out[j] = nd; q[tail++] = j; } }
      if (y > 0) { j = i - w; if (out[j] < 0 && !solid[j]) { out[j] = nd; q[tail++] = j; } }
      if (y < h - 1) { j = i + w; if (out[j] < 0 && !solid[j]) { out[j] = nd; q[tail++] = j; } }
    }
    return out;
  }

  // Spec 7: (a) strict [MIN,MAX] + off-screen; (b) drop off-screen; (c) [RELAX_MIN, RELAX_MAX]; else null.
  // v1.2 perf: optional dists = bfsTiles(grid, player tile, max(SPAWN_MAX, RELAX_MAX)) precomputed by the caller
  // (game.js reuses one BFS for every def of a spawn). Same result and same rng use either way.
  function pickSpawnSpot(grid, spots, px, py, cam, kinds, cfg, rng, excludeId, dists) {
    if (!grid || !spots || !spots.length) return null;
    var T = num(cfg && cfg.TILE, 32);
    var MIN = num(cfg && cfg.SPAWN_MIN_TILES, 18), MAX = num(cfg && cfg.SPAWN_MAX_TILES, 34);
    var RMIN = num(cfg && cfg.RELAX_MIN_TILES, 8), RMAX = num(cfg && cfg.RELAX_MAX_TILES, 40);
    var M = num(cfg && cfg.SPAWN_OFFSCREEN_MARGIN, 64);
    if (!dists || dists.length !== grid.w * grid.h) dists = bfsTiles(grid, Math.floor(px / T), Math.floor(py / T), Math.max(MAX, RMAX));
    var cx = num(cam && cam.x, px - 480), cy = num(cam && cam.y, py - 270);
    var cw = num(cam && cam.w, 960), ch = num(cam && cam.h, 540);
    var useKinds = kinds !== null && kinds !== undefined;   // null = any kind; [] = no kind matches
    var lv = [[], [], []];
    for (var i = 0; i < spots.length; i++) {
      var sp = spots[i];
      if (!sp) continue;
      if (excludeId !== undefined && excludeId !== null && sp.id === excludeId) continue;
      if (useKinds && kinds.indexOf(sp.kind) < 0) continue;
      var stx = Math.floor(sp.x / T), sty = Math.floor(sp.y / T);
      if (stx < 0 || sty < 0 || stx >= grid.w || sty >= grid.h) continue;
      var d = dists[sty * grid.w + stx];
      if (d < 0) continue;
      var off = sp.x < cx - M || sp.x > cx + cw + M || sp.y < cy - M || sp.y > cy + ch + M;
      if (d >= MIN && d <= MAX) {
        if (off) lv[0].push({ spot: sp, pathTiles: d });
        lv[1].push({ spot: sp, pathTiles: d });
      }
      if (d >= RMIN && d <= RMAX) lv[2].push({ spot: sp, pathTiles: d });
    }
    for (var k = 0; k < 3; k++) {
      var c = lv[k];
      if (c.length) {
        var r = typeof rng === 'function' ? rng() : 0;
        var idx = Math.min(c.length - 1, Math.max(0, Math.floor(r * c.length)));
        return { spot: c[idx].spot, pathTiles: c[idx].pathTiles, relax: k };
      }
    }
    return null;
  }

  // ---- misc ----
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr ? arr.slice() : [];
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((typeof rng === 'function' ? rng() : 0) * (i + 1));
      if (j > i) j = i;
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function tickBubble(person, dt) {
    if (!person || !person.bubble) return;
    person.bubble.ttl -= dt;
    if (!(person.bubble.ttl > 0)) person.bubble = null;
  }

  function formatShekels(n) {
    var v = Math.round(num(n, 0)), neg = v < 0;
    var s = String(Math.abs(v)), out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    out = s + out;
    return (neg ? '-' : '') + '₪ ' + out;
  }

  PE.logic = {
    intensityAt: intensityAt, isLive: isLive, scorePhoto: scorePhoto, gradeFor: gradeFor, rankFor: rankFor,
    dist: dist, proximity: proximity, bfsTiles: bfsTiles, pickSpawnSpot: pickSpawnSpot,
    moveAndCollide: moveAndCollide, dirFromVector: dirFromVector, edgeArrow: edgeArrow,
    mulberry32: mulberry32, shuffle: shuffle, tickBubble: tickBubble, formatShekels: formatShekels
  };
})(globalThis.PE = globalThis.PE || {});
