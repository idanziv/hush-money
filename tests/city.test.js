// HUSH MONEY - city.js headless map contract tests (spec v0.2 sections 7, 9, 14.7). Owner: QA.
'use strict';
const S = require('./spec.js');

module.exports = (t, PE) => {
  const TILE = 32, W = 96, H = 64;
  let inited = false;
  const city = () => {
    t.needs('city');
    if (!inited) { PE.city.init(); inited = true; }
    return PE.city;
  };
  const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];
  const solidAt = (g, tx, ty) => tx < 0 || ty < 0 || tx >= g.w || ty >= g.h || !!g.solid[ty * g.w + tx];
  const solidPx = (g, x, y) => { const [tx, ty] = tileOf(x, y); return solidAt(g, tx, ty); };

  const MAPW = W * TILE, MAPH = H * TILE;
  const camAt = (x, y) => ({ x: Math.max(0, Math.min(MAPW - 960, Math.round(x - 480))), y: Math.max(0, Math.min(MAPH - 540, Math.round(y - 270))), w: 960, h: 540 });
  const offscreen = (sp, c) => sp.x < c.x - 64 || sp.x > c.x + c.w + 64 || sp.y < c.y - 64 || sp.y > c.y + c.h + 64;
  const tName = (c, id) => Object.keys(c.T).find((k) => c.T[k] === id) || String(id);

  t.test('init(): headless, exposes the 14.7 members', () => {
    const c = city();
    for (const k of ['grid', 'T', 'buildings', 'spots', 'paths', 'lanes', 'poi', 'playerStarts', 'playerStart']) t.ok(c[k] != null, 'PE.city.' + k + ' present');
    for (const k of ['zoneAt', 'isSolidPx', 'init', 'initGraphics', 'drawGround', 'drawTop']) t.eq(typeof c[k], 'function', 'PE.city.' + k + ' is a function');
  });

  t.test('grid: 96x64, Uint8Array tile/solid of length 6144, tile ids from T', () => {
    const c = city(), g = c.grid;
    t.eq([g.w, g.h], [W, H], 'grid size');
    t.ok(g.tile instanceof Uint8Array, 'tile is Uint8Array');
    t.ok(g.solid instanceof Uint8Array, 'solid is Uint8Array');
    t.eq(g.tile.length, W * H, 'tile length'); t.eq(g.solid.length, W * H, 'solid length');
    const ids = new Set(Object.values(c.T));
    t.ok(ids.size > 0, 'T has tile ids');
    const unknown = new Set();
    for (let i = 0; i < g.tile.length; i++) if (!ids.has(g.tile[i])) unknown.add(g.tile[i]);
    t.eq([...unknown], [], 'tile ids not in T');
    let s = 0; for (let i = 0; i < g.solid.length; i++) if (g.solid[i]) s++;
    t.ok(s > 300 && s < W * H * 0.8, 'plausible solid count (' + s + ')');
  });

  t.test('isSolidPx agrees with grid.solid at every tile center', () => {
    const c = city(), g = c.grid, bad = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      if (!!c.isSolidPx(tx * TILE + 16, ty * TILE + 16) !== !!g.solid[ty * W + tx]) bad.push(tx + ',' + ty);
    }
    t.none(bad, 'isSolidPx mismatch');
  });

  t.test('playerStarts: >= 3, walkable, in map, distinct, reachable from each other; playerStart = playerStarts[0]', () => {
    const c = city(), P = c.playerStarts, g = c.grid;
    t.ok(Array.isArray(P) && P.length >= 3, 'playerStarts >= 3 (got ' + (P && P.length) + ')');
    t.ok(c.playerStart && c.playerStart.x === P[0].x && c.playerStart.y === P[0].y, 'playerStart equals playerStarts[0]');
    const bad = [];
    const d0 = S.bfs(g, tileOf(P[0].x, P[0].y)[0], tileOf(P[0].x, P[0].y)[1]);
    P.forEach((p, i) => {
      if (!(p.x > 0 && p.y > 0 && p.x < MAPW && p.y < MAPH)) { bad.push('start ' + i + ' outside map'); return; }
      if (solidPx(g, p.x, p.y)) bad.push('start ' + i + ' on solid');
      if (!S.ZONES.includes(c.zoneAt(p.x, p.y))) bad.push('start ' + i + ' invalid zone');
      const [tx, ty] = tileOf(p.x, p.y);
      if (d0[ty * W + tx] < 0) bad.push('start ' + i + ' not reachable from start 0');
      for (let j = 0; j < i; j++) if (Math.hypot(P[j].x - p.x, P[j].y - p.y) < 3 * TILE) bad.push('starts ' + j + ' and ' + i + ' within 3 tiles');
    });
    t.none(bad, 'player starts');
  });

  t.test('playerStarts: each has >= 3 strict spots (18..34 tiles, off-screen of a centred camera) of >= 3 kinds', () => {
    const c = city(), bad = [];
    c.playerStarts.forEach((p, i) => {
      const [tx, ty] = tileOf(p.x, p.y), d = S.bfs(c.grid, tx, ty), cam = camAt(p.x, p.y);
      const strict = c.spots.filter((sp) => { const [sx, sy] = tileOf(sp.x, sp.y); const v = d[sy * W + sx]; return v >= 18 && v <= 34 && offscreen(sp, cam); });
      const kinds = new Set(strict.map((sp) => sp.kind));
      if (strict.length < 3 || kinds.size < 3) bad.push('start ' + i + ' (' + tx + ',' + ty + '): ' + strict.length + ' strict spots, ' + kinds.size + ' kinds ' + JSON.stringify([...kinds]));
    });
    t.none(bad, 'start variety');
  });

  t.test('spots: >= 26, unique ids, valid kinds, >= 3 per kind, names <= 20 chars, spread over the map', () => {
    const c = city(), sp = c.spots;
    t.ok(Array.isArray(sp) && sp.length >= 26, 'spot count >= 26 (got ' + (sp && sp.length) + ')');
    t.eq(new Set(sp.map((s) => s.id)).size, sp.length, 'unique ids');
    const bad = [];
    for (const s of sp) {
      if (!S.SPOT_KINDS.includes(s.kind)) bad.push(s.id + ': bad kind ' + s.kind);
      if (typeof s.name !== 'string' || !s.name) bad.push(s.id + ': no name');
      else if (s.name.length > 20) bad.push(s.id + ': name "' + s.name + '" is ' + s.name.length + ' chars (> 20)');
      else if (S.HEBREW_RE.test(s.name) || S.EMOJI_RE.test(s.name) || s.name.indexOf('{') >= 0) bad.push(s.id + ': bad characters in name');
      if (!(s.x > 0 && s.x < W * TILE && s.y > 0 && s.y < H * TILE)) bad.push(s.id + ': outside map');
    }
    for (const k of S.SPOT_KINDS) { const n = sp.filter((s) => s.kind === k).length; if (n < 3) bad.push('kind ' + k + ': ' + n + ' spots (need >= 3)'); }
    t.none(bad, 'spots');
    const xs = sp.map((s) => s.x), ys = sp.map((s) => s.y);
    t.ok(Math.max(...xs) - Math.min(...xs) > W * TILE * 0.5, 'spots span > 50% of map width');
    t.ok(Math.max(...ys) - Math.min(...ys) > H * TILE * 0.5, 'spots span > 50% of map height');
  });

  t.test('spots: 3x3 tiles around each spot walkable', () => {
    const c = city(), g = c.grid, bad = [];
    for (const s of c.spots) {
      const [cx, cy] = tileOf(s.x, s.y);
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (solidAt(g, x, y)) bad.push(s.id + ' (' + s.kind + ') solid tile ' + x + ',' + y);
    }
    t.none(bad, '3x3 walkable');
  });

  t.test('spots: no building / solid structure tile (sea exempt) within Chebyshev 3 of the centre tile', () => {
    const c = city(), g = c.grid, bad = [];
    const bm = new Uint8Array(W * H);
    for (const b of c.buildings || []) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) bm[y * W + x] = 1;
    for (const s of c.spots) {
      const [cx, cy] = tileOf(s.x, s.y);
      let hit = null;
      for (let y = cy - 3; y <= cy + 3 && !hit; y++) for (let x = cx - 3; x <= cx + 3 && !hit; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x, nm = tName(c, g.tile[i]);
        if (bm[i]) hit = 'building tile ' + x + ',' + y;
        else if (g.solid[i] && !/sea|water/i.test(nm)) hit = nm + ' tile ' + x + ',' + y;
      }
      if (hit) bad.push(s.id + ' (' + s.kind + ' @' + cx + ',' + cy + '): ' + hit);
    }
    t.none(bad, 'spot clearance');
  });

  t.test('spots: trees >= 4 tiles from the centre tile', () => {
    const c = city(), g = c.grid, bad = [];
    const treeIds = Object.keys(c.T).filter((k) => /tree|ficus/i.test(k)).map((k) => c.T[k]);
    if (!treeIds.length) t.skip('SKIPPED (no tree tile id in T)');
    for (const s of c.spots) {
      const [cx, cy] = tileOf(s.x, s.y);
      let hit = null;
      for (let y = cy - 3; y <= cy + 3 && !hit; y++) for (let x = cx - 3; x <= cx + 3 && !hit; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && treeIds.includes(g.tile[y * W + x])) hit = x + ',' + y;
      }
      if (hit) bad.push(s.id + ': tree at ' + hit);
    }
    t.none(bad, 'tree clearance');
  });

  t.test('buildings: exported {x,y,w,h,ht} tile rects, in map, every tile solid; every BUILDING tile covered', () => {
    const c = city(), g = c.grid, B = c.buildings, bad = [];
    t.ok(Array.isArray(B) && B.length > 10, 'buildings array (' + (B && B.length) + ')');
    const cover = new Uint8Array(W * H);
    B.forEach((b, i) => {
      if (!['x', 'y', 'w', 'h', 'ht'].every((k) => typeof b[k] === 'number' && isFinite(b[k]))) { bad.push('building ' + i + ' shape ' + JSON.stringify(b)); return; }
      if (!(Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.w) && Number.isInteger(b.h))) bad.push('building ' + i + ' not integer tiles');
      if (b.w < 1 || b.h < 1 || b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) { bad.push('building ' + i + ' outside map ' + JSON.stringify(b)); return; }
      if (!(b.ht > 0)) bad.push('building ' + i + ' ht ' + b.ht);
      let hit = null;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        cover[y * W + x] = 1;
        if (!hit && !g.solid[y * W + x]) hit = x + ',' + y;
      }
      if (hit) bad.push('building ' + i + ' tile ' + hit + ' not solid');
    });
    const bid = Object.keys(c.T).filter((k) => /^build|bldg/i.test(k)).map((k) => c.T[k]);
    let uncovered = 0, first = '';
    for (let i = 0; i < W * H; i++) if (bid.includes(g.tile[i]) && !cover[i]) { uncovered++; if (!first) first = (i % W) + ',' + Math.floor(i / W); }
    if (uncovered) bad.push(uncovered + ' BUILDING tiles not covered by any rect (first ' + first + ')');
    t.none(bad, 'buildings');
  });

  t.test('spots: all reachable from playerStarts[0] (4-neighbour BFS)', () => {
    const c = city(), g = c.grid;
    const [px, py] = tileOf(c.playerStarts[0].x, c.playerStarts[0].y);
    const d = S.bfs(g, px, py);
    const bad = [];
    for (const s of c.spots) { const [x, y] = tileOf(s.x, s.y); if (d[y * W + x] < 0) bad.push(s.id + ' (' + s.kind + ') unreachable'); }
    t.none(bad, 'reachability');
  });

  t.test('spots: kind matches zoneAt (zone-named kinds; kiosk excluded)', () => {
    const c = city(), bad = [];
    for (const s of c.spots) {
      if (s.kind === 'kiosk') continue;
      const z = c.zoneAt(s.x, s.y);
      if (z !== s.kind) bad.push(s.id + ': kind ' + s.kind + ' but zoneAt = ' + z);
    }
    t.none(bad, 'spot zones');
  });

  t.test('spots: every kind used by a scandal def has >= 2 spots', () => {
    t.needs('data');
    const c = city(), bad = [];
    for (const d of PE.SCANDALS) for (const k of d.kinds || []) {
      const n = c.spots.filter((s) => s.kind === k).length;
      if (n < 2) bad.push(d.id + ' uses kind ' + k + ' with ' + n + ' spots');
    }
    t.none(bad, 'kinds coverage');
  });

  t.test('zoneAt: valid zone for every tile, all 9 zones present', () => {
    const c = city(), seen = new Set(), bad = [];
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const z = c.zoneAt(tx * TILE + 16, ty * TILE + 16);
      if (!S.ZONES.includes(z)) { if (bad.length < 20) bad.push(tx + ',' + ty + ' -> ' + JSON.stringify(z)); } else seen.add(z);
    }
    t.none(bad, 'invalid zones');
    t.eq(S.ZONES.filter((z) => !seen.has(z)), [], 'zones never returned');
  });

  t.test('paths: nodes walkable, adjacency valid, every node connected, edges walkable every 8 px', () => {
    const c = city(), g = c.grid, P = c.paths, bad = [];
    t.ok(P && Array.isArray(P.nodes) && Array.isArray(P.adj), 'paths.nodes / paths.adj arrays');
    t.ok(P.nodes.length >= 10, 'at least 10 path nodes (got ' + P.nodes.length + ')');
    t.eq(P.adj.length, P.nodes.length, 'adj length = nodes length');
    P.nodes.forEach((n, i) => {
      if (solidPx(g, n.x, n.y)) bad.push('node ' + i + ' (' + n.x + ',' + n.y + ') on solid tile');
      if (!S.ZONES.includes(n.zone)) bad.push('node ' + i + ' bad zone ' + JSON.stringify(n.zone));
      const a = P.adj[i];
      if (!Array.isArray(a) || !a.length) { bad.push('node ' + i + ' has no neighbours'); return; }
      for (const j of a) {
        if (!Number.isInteger(j) || j < 0 || j >= P.nodes.length || j === i) { bad.push('node ' + i + ' bad neighbour ' + j); continue; }
        const m = P.nodes[j], len = Math.hypot(m.x - n.x, m.y - n.y), steps = Math.max(1, Math.ceil(len / 8));
        for (let k = 0; k <= steps; k++) {
          const x = n.x + (m.x - n.x) * k / steps, y = n.y + (m.y - n.y) * k / steps;
          if (solidPx(g, x, y)) { bad.push('edge ' + i + '->' + j + ' crosses solid at (' + x.toFixed(0) + ',' + y.toFixed(0) + ')'); break; }
        }
      }
    });
    t.none(bad, 'path graph');
  });

  t.test('lanes: road and bike lanes, closed loops (loop:true, first point not repeated), >= 3 in-map points', () => {
    const c = city(), bad = [];
    t.ok(Array.isArray(c.lanes) && c.lanes.length > 0, 'lanes non-empty');
    c.lanes.forEach((l, i) => {
      if (l.type !== 'road' && l.type !== 'bike') bad.push('lane ' + i + ' bad type ' + l.type);
      if (l.loop !== true) bad.push('lane ' + i + ' loop is ' + JSON.stringify(l.loop));
      if (!Array.isArray(l.pts) || l.pts.length < 3) { bad.push('lane ' + i + ' < 3 points'); return; }
      const f0 = l.pts[0], fl = l.pts[l.pts.length - 1];
      if (f0 && fl && f0[0] === fl[0] && f0[1] === fl[1]) bad.push('lane ' + i + ' repeats its first point at the end');
      for (const p of l.pts) if (!Array.isArray(p) || !(p[0] >= 0 && p[0] <= W * TILE && p[1] >= 0 && p[1] <= H * TILE)) { bad.push('lane ' + i + ' point ' + JSON.stringify(p) + ' outside map'); break; }
    });
    t.none(bad, 'lanes');
    t.ok(c.lanes.some((l) => l.type === 'road'), 'has a road lane');
    t.ok(c.lanes.some((l) => l.type === 'bike'), 'has a bike lane');
  });

  t.test('poi: valid entries and counts (kiosk>=2 falafel>=2 stall>=6 cafe_table>=8 bench>=10 lifeguard=2 matkot=2 umbrella>=6 sunbathe>=4)', () => {
    const c = city(), bad = [];
    t.ok(Array.isArray(c.poi), 'poi array');
    c.poi.forEach((p, i) => {
      if (!S.POI_TYPES.includes(p.type)) bad.push('poi ' + i + ' bad type ' + p.type);
      if (!(p.x >= 0 && p.x <= W * TILE && p.y >= 0 && p.y <= H * TILE)) bad.push('poi ' + i + ' (' + p.type + ') outside map');
      if (!Number.isInteger(p.dir) || p.dir < 0 || p.dir > 7) bad.push('poi ' + i + ' (' + p.type + ') dir ' + p.dir + ' not 0..7');
    });
    for (const p of c.poi) {
      if (solidPx(c.grid, p.x, p.y)) bad.push('poi ' + p.type + ' at ' + p.x + ',' + p.y + ' is not a walkable standing point');
      if (p.type === 'matkot') {
        if ([0, 2, 4, 6].indexOf(p.dir) < 0) bad.push('matkot dir ' + p.dir + ' is not an axis (0/2/4/6)');
        const ax = p.dir === 2 || p.dir === 6 ? 1 : 0, ay = 1 - ax;
        for (const sgn of [-1, 1]) if (solidPx(c.grid, p.x + sgn * 36 * ax, p.y + sgn * 36 * ay)) bad.push('matkot player spot ' + sgn * 36 + ' px along axis is solid');
      }
    }
    for (const [type, min, exact] of S.POI_COUNTS) {
      const n = c.poi.filter((p) => p.type === type).length;
      if (exact ? n !== min : n < min) bad.push(type + ': ' + n + (exact ? ' (need exactly ' : ' (need >= ') + min + ')');
    }
    t.none(bad, 'poi');
  });

  t.test('init() is idempotent / deterministic (second call gives the same map, no duplicated lists)', () => {
    const c = city();
    const snap = () => ({
      solid: Array.from(c.grid.solid).join(''), tile: Array.from(c.grid.tile).join(','),
      spots: JSON.stringify(c.spots), poi: c.poi.length, nodes: c.paths.nodes.length, lanes: c.lanes.length,
      start: JSON.stringify(c.playerStart),
    });
    const a = snap();
    c.init();
    const b = snap();
    for (const k of Object.keys(a)) t.ok(a[k] === b[k], 'city.' + k + ' changed after a second init()');
  });
};
