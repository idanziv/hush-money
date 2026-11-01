/* HUSH MONEY - js/city.js  (owner: world-artist, Noa Ben-Ami)
 * Map 96x64 tiles of 32 px (3072x2048 px). x east, y south. Tile rects below are INCLUSIVE.
 * ---------------------------------------------------------------------------------------
 * COAST     sea x0-7 (solid) | sand x8-12 | promenade x13-14 | red bike lane x15 |
 *           coastal road x16-18 | sidewalk x19 (all y)
 * EDGES     rows y0 & y63 and column x95 are solid; border Bauhaus rows y0-1 & y62-63 (x20-91),
 *           east Bauhaus column x92-95
 * STREETS   N1 y2-6 (sw 2/6, road 3-5) x19-91 | E1 x87-91 (sw 87/91, road 88-90) y2-61 |
 *           bottom y57-61 (sw 57/61, road 58-60) x19-91 | N2 y15-19 x19-35 |
 *           M1 x59-63 (road 60-62) y3-30 | S-M x46-50 (road 47-49) y35-60
 * BOULEVARD x19-87 y28-37: sw 28 & 37, road 29-30 (westbound), strip 31-34 (x20-86, trees,
 *           benches), road 35-36 (eastbound). Kiosks: west x21-22 y32-33, east x84-85 y32-33
 * NORTH     Bauhaus x20-35 y7-14 | Gan (small park) x20-35 y20-27 | cafe street (pedestrian)
 *           x36-42 y7-27 | plaza x43-58 y7-19, fountain x50-52 y12-14 | Bauhaus x43-58 y20-27 |
 *           Bauhaus x64-69 y7-27 | park x70-86 y7-22 | Bauhaus x70-86 y23-27
 * SOUTH     old town x20-45 y38-56 (alleys x26-27, 34-35, 40-41 and y44-45, 51-52; squares
 *           x24-30 y44-50, x35-41 y51-56, x39-45 y38-44) | Bauhaus x51-59 y38-43 & y52-56 |
 *           little kikar x51-55 y44-51 + corner cafe x56-59 y44-51 | tayelet cafe zone x12-14 y37-43 |
 *           market x60-86 y38-56 (stall rows y40/44/48/52 with segments x61-66, 68-72, 75-79, 81-85;
 *           open: square x68-79 y45-51, spice corner x60-66 y49-56, fruit corner x80-86 y38-47;
 *           falafel x68-69 y45 & x78-79 y51)
 * BEACH     kiosk x11-12 y30-31, lifeguard towers (11,16) (11,45), matkot (10,4) (10,41) axis N-S (dir 0)
 * SPOTS (tile centres; px = t*32+16), 26 total, >= 3 per kind
 *   boulevard: bv_west 34,32  bv_mid 50,33  bv_east 66,32
 *   kiosk:     ki_west 27,33  ki_east 80,33  ki_beach 10,35
 *   park:      pk_grove 75,11 pk_lawn 82,18 pk_lower 74,19 pk_gan 27,23
 *   alley:     al_florentin 27,48  al_yard 38,54  al_flea 42,41
 *   cafe:      cf_north 39,10 cf_south 39,21 cf_levinsky 57,48 cf_tayelet 13,40
 *   beach:     bc_north 10,8  bc_mid 10,24  bc_south 10,52
 *   market:    mk_square 73,48 mk_spice 63,53 mk_fruit 83,42
 *   plaza:     pl_west 46,10  pl_east 56,10  pl_levinsky 53,47
 *   Rules: 3x3 walkable; no building/solid structure within Chebyshev 3 of the centre; trees >= 4;
 *   kind == zoneAt (kiosk exempt); name <= 20 chars.
 * PLAYER STARTS (tiles; playerStart = playerStarts[0]); strict spots with the clamped camera centred:
 *   25,32 boulevard strip by the west kiosk: bv_mid al_florentin al_flea cf_south
 *   14,46 promenade: bv_west ki_west al_yard al_flea bc_mid
 *   60,46 market west edge: bv_mid bv_east ki_east al_yard al_flea mk_fruit
 *   78,14 park centre: bv_east ki_east mk_fruit pl_east
 * Fake height: roof offset = clamp((bldgCentre - viewCentre) * ht * 0.04, +-24) px, ht in 0.3..1.2.
 */
(function (PE) {
  'use strict';

  var W = 96, H = 64, TS = 32, CH = 16, CPX = CH * TS, WALL_D = 24, MAXOFF = 24;
  var T = {
    SEA: 0, SAND: 1, PROMENADE: 2, BIKE: 3, ROAD: 4, SIDEWALK: 5, STRIP: 6, GRASS: 7, PATH: 8,
    PLAZA: 9, FOUNTAIN: 10, BUILDING: 11, ALLEY: 12, MARKET: 13, STALL: 14, KIOSK: 15, TREE: 16,
    LIFEGUARD: 17, CAFE: 18, FALAFEL: 19, YARD: 20
  };
  var SOLID = new Uint8Array(32);
  [T.SEA, T.FOUNTAIN, T.BUILDING, T.STALL, T.KIOSK, T.TREE, T.LIFEGUARD, T.FALAFEL].forEach(function (t) { SOLID[t] = 1; });
  var ZN = ['street', 'beach', 'promenade', 'boulevard', 'market', 'alley', 'park', 'plaza', 'cafe'];
  var Z = {};
  for (var zi = 0; zi < ZN.length; zi++) Z[ZN[zi]] = zi;

  var city = PE.city = PE.city || {};
  city.T = T; city.W = W; city.H = H; city.TILE = TS; city.ZONES = ZN.slice();
  city.inited = false; city.gfxReady = false;

  // ---------- small deterministic helpers (no dependency on PE.logic) ----------
  function hash3(a, b, c) {
    var h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
    h ^= Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
    h ^= Math.imul((c | 0) + 0x165667b1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function rnd(a, b, c) { return hash3(a, b, c) / 4294967296; }
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }

  // ---------- layout data ----------
  var SIDEWALKS = [
    [19, 0, 19, 63], [19, 2, 91, 2], [19, 6, 91, 6], [87, 2, 87, 61], [91, 2, 91, 61],
    [19, 57, 91, 57], [19, 61, 91, 61], [19, 28, 87, 28], [19, 37, 87, 37],
    [19, 15, 35, 15], [19, 19, 35, 19], [59, 7, 59, 27], [63, 7, 63, 27], [46, 38, 46, 56], [50, 38, 50, 56]
  ];
  var ROADS = [
    [16, 0, 18, 63, 'v'], [19, 3, 90, 5, 'h'], [88, 3, 90, 60, 'v'], [19, 58, 90, 60, 'h'],
    [19, 29, 87, 30, 'h'], [19, 35, 87, 36, 'h'], [19, 16, 35, 18, 'h'], [60, 3, 62, 30, 'v'], [47, 35, 49, 60, 'v']
  ];
  var BLOCKS = [
    [[20, 7, 35, 14], [[20, 7, 26, 14], [28, 7, 35, 14]]],
    [[43, 20, 58, 27], [[43, 20, 49, 27], [51, 20, 58, 27]]],
    [[64, 7, 69, 27], [[64, 7, 69, 13], [64, 15, 69, 20], [64, 22, 69, 27]]],
    [[70, 23, 86, 27], [[70, 23, 77, 27], [79, 23, 86, 27]]],
    [[51, 38, 59, 56], [[51, 38, 59, 43], [51, 52, 59, 56]]],
    [[20, 0, 91, 1], [[20, 0, 91, 1]]],
    [[20, 62, 91, 63], [[20, 62, 91, 63]]],
    [[92, 0, 95, 63], [[92, 0, 95, 63]]]
  ];
  var OLD_CELLS = [
    [20, 38, 25, 43], [28, 38, 33, 43], [36, 38, 38, 43],
    [20, 46, 23, 50], [31, 46, 33, 50], [36, 46, 39, 50], [42, 46, 45, 50],
    [20, 53, 25, 56], [28, 53, 33, 56], [42, 53, 45, 56]
  ];
  var KIOSKS = [[21, 32, 22, 33, 23, 33, 2], [84, 32, 85, 33, 83, 33, 6], [11, 30, 12, 31, 10, 31, 6]];
  var FALAFELS = [[68, 45, 69, 45, 68, 46, 4], [78, 51, 79, 51, 79, 50, 0]];
  var STALL_ROWS = [40, 44, 48, 52];
  var STALL_SEGS = [[61, 66], [68, 72], [75, 79], [81, 85]];
  var TOWERS = [[11, 16], [11, 45]];
  var UMBRELLAS = [[9, 12], [12, 14], [9, 19], [9, 28], [9, 47], [11, 56], [9, 59], [12, 61]];
  var SUNBATHE = [[11, 12], [11, 19], [11, 47], [9, 56], [11, 59]];
  var MATKOT = [[10, 4], [10, 41]];
  var BENCHES = [
    [13, 5, 6], [13, 10, 6], [13, 17, 6], [13, 23, 6], [13, 31, 6], [13, 47, 6], [13, 53, 6], [13, 59, 6],
    [37, 31, 4], [44, 34, 0], [55, 31, 4], [62, 34, 0], [70, 31, 4], [76, 34, 0],
    [74, 15, 0], [82, 13, 4], [79, 18, 6], [77, 10, 2], [24, 22, 0], [32, 25, 6], [44, 12, 2], [58, 14, 6]
  ];
  var TABLE_ROWS = [8, 11, 14, 17, 20, 23, 26];
  var EXTRA_TABLES = [[56, 45, 2], [58, 45, 6], [52, 50, 2], [58, 51, 6], [12, 37, 6], [12, 43, 6]]; // [tx, ty, chair side dir]
  var SPOT_DEFS = [
    ['bv_west', 'Rothschild Benches', 'boulevard', 34, 32], ['bv_mid', 'Boulevard Bandstand', 'boulevard', 50, 33],
    ['bv_east', 'Boulevard Ficus Row', 'boulevard', 66, 32], ['ki_west', 'West Kiosk', 'kiosk', 27, 33],
    ['ki_east', 'East Kiosk', 'kiosk', 80, 33], ['ki_beach', 'Promenade Kiosk', 'kiosk', 10, 35],
    ['pk_grove', 'Ficus Grove', 'park', 75, 11], ['pk_lawn', 'Big Lawn', 'park', 82, 18],
    ['pk_gan', 'Little Gan', 'park', 27, 23], ['al_florentin', 'Florentin Corner', 'alley', 27, 48],
    ['al_yard', 'Graffiti Yard', 'alley', 38, 54], ['al_flea', 'Flea Corner', 'alley', 42, 41],
    ['cf_north', 'Cafe Strip North', 'cafe', 39, 10], ['cf_south', 'Cafe Strip South', 'cafe', 39, 21],
    ['bc_north', 'Seagull Beach', 'beach', 10, 8], ['bc_mid', 'Tayelet Sands', 'beach', 10, 24],
    ['bc_south', 'Sunset Beach', 'beach', 10, 52], ['mk_square', 'Shuk Square', 'market', 73, 48],
    ['mk_spice', 'Spice Lane', 'market', 63, 53], ['mk_fruit', 'Fruit Row', 'market', 83, 42],
    ['pl_west', 'Fountain Steps West', 'plaza', 46, 10], ['pl_east', 'Fountain Steps East', 'plaza', 56, 10],
    ['pk_lower', 'Lower Lawn', 'park', 74, 19], ['pl_levinsky', 'Little Kikar', 'plaza', 53, 47],
    ['cf_levinsky', 'Kikar Corner Cafe', 'cafe', 57, 48], ['cf_tayelet', 'Tayelet Cafe', 'cafe', 13, 40]
  ];
  // player starts (tiles): boulevard west kiosk, promenade, market west edge, park centre
  var STARTS = [[25, 32], [14, 46], [60, 46], [78, 14]];
  // walk graph: axis-aligned segments in tile coords [x0,y0,x1,y1]; intersections become nodes
  var PATH_SEGS = [
    [14, 2, 14, 61], [19, 2, 19, 61], [14, 6, 91, 6], [19, 2, 91, 2], [14, 15, 39, 15], [14, 19, 39, 19],
    [14, 28, 87, 28], [14, 37, 87, 37], [14, 57, 91, 57], [19, 61, 91, 61], [87, 2, 87, 61], [91, 2, 91, 61],
    [23, 32, 83, 32], [23, 28, 23, 37], [30, 28, 30, 37], [83, 28, 83, 37], [39, 6, 39, 37],
    [39, 8, 59, 8], [39, 18, 59, 18], [45, 6, 45, 18], [57, 6, 57, 18],
    [48, 10, 54, 10], [48, 16, 54, 16], [48, 10, 48, 16], [54, 10, 54, 16], [51, 8, 51, 10], [51, 16, 51, 18],
    [45, 13, 48, 13], [54, 13, 57, 13], [59, 6, 59, 37], [63, 6, 63, 37], [50, 18, 50, 57], [46, 28, 46, 57],
    [27, 6, 27, 15], [71, 6, 71, 21], [78, 6, 78, 28], [85, 6, 85, 21], [71, 8, 85, 8], [63, 14, 87, 14],
    [63, 21, 87, 21], [19, 21, 39, 21], [31, 19, 31, 28],
    [26, 37, 26, 57], [34, 37, 34, 57], [40, 37, 40, 57], [19, 44, 60, 44], [19, 51, 60, 51],
    [60, 37, 60, 57], [67, 37, 67, 57], [73, 37, 73, 57], [80, 37, 80, 57], [86, 37, 86, 57],
    [60, 42, 87, 42], [60, 46, 87, 46], [60, 50, 87, 50], [60, 54, 87, 54], [55, 44, 55, 51]
  ];
  var PARK_PATHS = [[71, 7, 71, 21], [78, 7, 78, 22], [85, 7, 85, 21], [71, 8, 85, 8], [70, 14, 86, 14], [70, 21, 86, 21],
    [20, 21, 35, 21], [31, 20, 31, 27]];
  var BV_CROSS = { 23: 1, 30: 1, 39: 1, 46: 1, 50: 1, 59: 1, 63: 1, 83: 1 };

  // ---------- state ----------
  var tile, solid, zone, bIdx;
  var buildings, drawList, trees, umbrellas, towers, falafels, benches, tables, crossings, roads, stallSegs;

  function I(x, y) { return y * W + x; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  function fillT(x0, y0, x1, y1, t) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (inb(x, y)) tile[I(x, y)] = t; }
  function fillZ(x0, y0, x1, y1, z) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (inb(x, y)) zone[I(x, y)] = z; }
  function tAt(x, y) { return inb(x, y) ? tile[I(x, y)] : T.BUILDING; }
  function tc(t) { return t * TS + 16; }

  function addBuilding(x0, y0, x1, y1, style) {
    var id = buildings.length;
    var b = { id: id, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, style: style, seed: hash3(x0, y0, x1 * 97 + y1) };
    var r = rnd(x0, y0, 11);
    b.ht = style === 'old' ? 0.45 + r * 0.3 : 0.75 + r * 0.45;
    fillT(x0, y0, x1, y1, T.BUILDING);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) bIdx[I(x, y)] = id;
    buildings.push(b);
    return b;
  }
  function subdivide(x0, y0, x1, y1, minS, maxS, style) {
    var w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w <= maxS && h <= maxS) { addBuilding(x0, y0, x1, y1, style); return; }
    var alongX = w >= h, len = alongX ? w : h;
    if (len < minS * 2) { addBuilding(x0, y0, x1, y1, style); return; }
    var cut = minS + Math.floor(rnd(x0 * 3 + y0, len, w * 7 + h) * (len - 2 * minS + 1));
    if (alongX) { subdivide(x0, y0, x0 + cut - 1, y1, minS, maxS, style); subdivide(x0 + cut, y0, x1, y1, minS, maxS, style); }
    else { subdivide(x0, y0, x1, y0 + cut - 1, minS, maxS, style); subdivide(x0, y0 + cut, x1, y1, minS, maxS, style); }
  }
  function nearSpot(x, y, d) {
    for (var i = 0; i < SPOT_DEFS.length; i++) {
      var s = SPOT_DEFS[i];
      if (Math.max(Math.abs(s[3] - x), Math.abs(s[4] - y)) <= d) return true;
    }
    return false;
  }
  function isBench(x, y) { for (var i = 0; i < BENCHES.length; i++) if (BENCHES[i][0] === x && BENCHES[i][1] === y) return true; return false; }
  function addTree(x, y) {
    var t = tAt(x, y);
    if (t !== T.GRASS && t !== T.STRIP) return;
    if (nearSpot(x, y, 3) || isBench(x, y)) return;
    for (var i = 0; i < trees.length; i++) if (Math.abs(trees[i].tx - x) <= 1 && Math.abs(trees[i].ty - y) <= 1) return;
    tile[I(x, y)] = T.TREE;
    trees.push({ tx: x, ty: y, x: tc(x), y: tc(y), v: hash3(x, y, 5) & 3, park: zone[I(x, y)] === Z.park });
  }
  function poiPush(type, x, y, dir) { city.poi.push({ type: type, x: x, y: y, dir: dir }); }

  function build() {
    var n = W * H, i, x, y, k;
    tile = new Uint8Array(n); solid = new Uint8Array(n); zone = new Uint8Array(n); bIdx = new Int16Array(n);
    bIdx.fill(-1);
    buildings = []; trees = []; umbrellas = []; towers = []; falafels = []; benches = []; tables = [];
    crossings = []; roads = []; stallSegs = [];
    city.poi = []; city.spots = [];
    var kiosks = [];

    fillT(0, 0, W - 1, H - 1, T.SIDEWALK);
    fillT(0, 0, 7, H - 1, T.SEA); fillT(8, 0, 12, H - 1, T.SAND); fillT(13, 0, 14, H - 1, T.PROMENADE);
    fillZ(0, 0, 12, H - 1, Z.beach); fillZ(13, 0, 14, H - 1, Z.promenade);
    fillT(36, 7, 42, 27, T.CAFE); fillZ(36, 7, 42, 27, Z.cafe);
    fillT(43, 7, 58, 19, T.PLAZA); fillZ(43, 7, 58, 19, Z.plaza);
    fillT(70, 7, 86, 22, T.GRASS); fillZ(70, 7, 86, 22, Z.park);
    fillT(20, 20, 35, 27, T.GRASS); fillZ(20, 20, 35, 27, Z.park);
    fillT(20, 38, 45, 56, T.ALLEY); fillZ(20, 38, 45, 56, Z.alley);
    fillT(60, 38, 86, 56, T.MARKET); fillZ(60, 38, 86, 56, Z.market);
    fillZ(19, 28, 87, 37, Z.boulevard);
    fillT(20, 31, 86, 34, T.STRIP);
    for (i = 0; i < BLOCKS.length; i++) { var r0 = BLOCKS[i][0]; fillT(r0[0], r0[1], r0[2], r0[3], T.YARD); }
    fillT(51, 44, 59, 51, T.PLAZA); fillZ(51, 44, 59, 51, Z.plaza); // little kikar (south)
    fillT(56, 44, 59, 51, T.CAFE); fillZ(56, 44, 59, 51, Z.cafe); fillZ(12, 37, 14, 43, Z.cafe); // kikar corner cafe, tayelet cafe
    for (i = 0; i < SIDEWALKS.length; i++) { var s = SIDEWALKS[i]; fillT(s[0], s[1], s[2], s[3], T.SIDEWALK); }
    for (i = 0; i < ROADS.length; i++) {
      var rd = ROADS[i]; fillT(rd[0], rd[1], rd[2], rd[3], T.ROAD);
      roads.push({ x0: rd[0], y0: rd[1], x1: rd[2], y1: rd[3], o: rd[4] });
    }
    fillT(15, 0, 15, H - 1, T.BIKE);
    for (i = 0; i < PARK_PATHS.length; i++) { var pp = PARK_PATHS[i]; fillT(pp[0], pp[1], pp[2], pp[3], T.PATH); }
    fillT(50, 12, 52, 14, T.FOUNTAIN);

    // buildings
    for (i = 0; i < BLOCKS.length; i++) {
      var lots = BLOCKS[i][1];
      for (k = 0; k < lots.length; k++) { var L = lots[k]; subdivide(L[0], L[1], L[2], L[3], 3, 7, 'bauhaus'); }
    }
    for (i = 0; i < OLD_CELLS.length; i++) { var c = OLD_CELLS[i]; subdivide(c[0], c[1], c[2], c[3], 2, 4, 'old'); }

    // market stalls + falafel
    for (i = 0; i < STALL_ROWS.length; i++) {
      var row = STALL_ROWS[i];
      for (k = 0; k < STALL_SEGS.length; k++) {
        var sg = STALL_SEGS[k];
        if (row === 48 && (k === 1 || k === 2)) continue; // market square
        if ((row === 52 && k === 0) || ((row === 40 || row === 44) && k === 3)) continue; // open corners (spice lane, fruit row)
        fillT(sg[0], row, sg[1], row, T.STALL);
        stallSegs.push({ x0: sg[0], x1: sg[1], y: row, c: hash3(sg[0], row, 3) % 4 });
      }
    }
    for (i = 0; i < FALAFELS.length; i++) {
      var f = FALAFELS[i]; fillT(f[0], f[1], f[2], f[3], T.FALAFEL);
      falafels.push({ x: (f[0] + f[2] + 1) * 16, y: (f[1] + f[3] + 1) * 16 });
      poiPush('falafel', tc(f[4]), tc(f[5]), f[6]);
    }
    // kiosks (drawn as tiny buildings, not counted as building footprints for spots)
    for (i = 0; i < KIOSKS.length; i++) {
      var q = KIOSKS[i]; fillT(q[0], q[1], q[2], q[3], T.KIOSK);
      kiosks.push({ id: -1 - i, x: q[0], y: q[1], w: q[2] - q[0] + 1, h: q[3] - q[1] + 1, style: 'kiosk', ht: 0.32, seed: hash3(q[0], q[1], 77) });
      poiPush('kiosk', tc(q[4]), tc(q[5]), q[6]);
    }
    // beach
    for (i = 0; i < TOWERS.length; i++) {
      fillT(TOWERS[i][0], TOWERS[i][1], TOWERS[i][0], TOWERS[i][1], T.LIFEGUARD);
      towers.push({ x: tc(TOWERS[i][0]), y: tc(TOWERS[i][1]) });
      poiPush('lifeguard', tc(TOWERS[i][0] - 1), tc(TOWERS[i][1]), 6);
    }
    for (i = 0; i < UMBRELLAS.length; i++) {
      umbrellas.push({ x: tc(UMBRELLAS[i][0]), y: tc(UMBRELLAS[i][1]), v: hash3(i, 9, 9) & 3 });
      poiPush('umbrella', tc(UMBRELLAS[i][0]), tc(UMBRELLAS[i][1]), 0);
    }
    for (i = 0; i < SUNBATHE.length; i++) poiPush('sunbathe', tc(SUNBATHE[i][0]), tc(SUNBATHE[i][1]), 2);
    for (i = 0; i < MATKOT.length; i++) poiPush('matkot', tc(MATKOT[i][0]), tc(MATKOT[i][1]), 0);
    for (i = 0; i < BENCHES.length; i++) {
      var be = BENCHES[i];
      benches.push({ x: tc(be[0]), y: tc(be[1]), dir: be[2] });
      poiPush('bench', tc(be[0]), tc(be[1]), be[2]);
    }
    for (i = 0; i < EXTRA_TABLES.length; i++) {
      var et = EXTRA_TABLES[i];
      tables.push({ x: tc(et[0]), y: tc(et[1]) });
      poiPush('cafe_table', tc(et[0]) + (et[2] === 6 ? 10 : -10), tc(et[1]), et[2]);
    }
    for (i = 0; i < TABLE_ROWS.length; i++) {
      var ty = TABLE_ROWS[i];
      tables.push({ x: tc(36), y: tc(ty) }); tables.push({ x: tc(42), y: tc(ty) });
      poiPush('cafe_table', tc(36) + 10, tc(ty), 6);
      poiPush('cafe_table', tc(42) - 10, tc(ty), 2);
    }
    // trees
    for (x = 25; x <= 82; x += 3) { if (!BV_CROSS[x]) { addTree(x, 31); addTree(x, 34); } }
    for (y = 9; y <= 20; y++) for (x = 72; x <= 84; x++) if (rnd(x, y, 21) < 0.55) addTree(x, y);
    for (y = 22; y <= 26; y++) for (x = 21; x <= 34; x++) if (rnd(x, y, 22) < 0.3) addTree(x, y);

    // stall vendors (after falafel tiles exist)
    for (i = 0; i < stallSegs.length; i++) {
      var ss = stallSegs[i], cx = (ss.x0 + ss.x1) >> 1, north = (ss.y === 40 || ss.y === 52);
      var y1 = north ? ss.y - 1 : ss.y + 1, y2 = north ? ss.y + 1 : ss.y - 1;
      if (tAt(cx, y1) === T.MARKET) poiPush('stall', tc(cx), tc(y1), north ? 0 : 4);
      else if (tAt(cx, y2) === T.MARKET) poiPush('stall', tc(cx), tc(y2), north ? 4 : 0);
    }

    // solid grid (+ map edge)
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      i = I(x, y);
      solid[i] = (SOLID[tile[i]] || x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 1 : 0;
    }

    // neighbour heights for wall culling
    drawList = buildings.concat(kiosks);
    for (i = 0; i < drawList.length; i++) sideInfo(drawList[i]);
    drawList.sort(function (a, b) { return a.ht - b.ht; });

    // spots
    for (i = 0; i < SPOT_DEFS.length; i++) {
      var sd = SPOT_DEFS[i];
      city.spots.push({ id: sd[0], name: sd[1], kind: sd[2], x: tc(sd[3]), y: tc(sd[4]) });
    }
    buildPaths();
    buildLanes();
    city.playerStarts = STARTS.map(function (p) { return { x: tc(p[0]), y: tc(p[1]) }; });
    city.playerStart = city.playerStarts[0];
    city.grid = { w: W, h: H, tile: tile, solid: solid };
    city.buildings = buildings.map(function (b) { return { x: b.x, y: b.y, w: b.w, h: b.h, ht: b.ht }; });
    city.trees = trees;
    city.roads = roads;
  }

  function nbHt(x, y) {
    if (!inb(x, y)) return 9;
    var t = tile[I(x, y)];
    if (t !== T.BUILDING) return 0;
    var id = bIdx[I(x, y)];
    return id >= 0 ? buildings[id].ht : 0;
  }
  function sideInfo(b) {
    var m, k;
    m = 9; for (k = 0; k < b.h; k++) m = Math.min(m, nbHt(b.x - 1, b.y + k)); b.nW = m;
    m = 9; for (k = 0; k < b.h; k++) m = Math.min(m, nbHt(b.x + b.w, b.y + k)); b.nE = m;
    m = 9; for (k = 0; k < b.w; k++) m = Math.min(m, nbHt(b.x + k, b.y - 1)); b.nN = m;
    m = 9; for (k = 0; k < b.w; k++) m = Math.min(m, nbHt(b.x + k, b.y + b.h)); b.nS = m;
  }

  function buildPaths() {
    var nodes = [], key = {}, adj = [], i, j;
    function node(x, y) {
      var k = x + ',' + y;
      if (key[k] === undefined) { key[k] = nodes.length; nodes.push({ x: tc(x), y: tc(y), zone: ZN[zone[I(x, y)]] }); adj.push([]); }
      return key[k];
    }
    var segs = PATH_SEGS.map(function (s) { return [Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3])]; });
    var pts = segs.map(function (s) { return [[s[0], s[1]], [s[2], s[3]]]; });
    for (i = 0; i < segs.length; i++) for (j = 0; j < segs.length; j++) {
      var a = segs[i], b = segs[j];
      if (a[1] === a[3] && b[0] === b[2]) { // a horizontal, b vertical
        if (b[0] >= a[0] && b[0] <= a[2] && a[1] >= b[1] && a[1] <= b[3]) { pts[i].push([b[0], a[1]]); pts[j].push([b[0], a[1]]); }
      }
    }
    for (i = 0; i < segs.length; i++) {
      var hz = segs[i][1] === segs[i][3];
      var p = pts[i].sort(function (u, v) { return hz ? u[0] - v[0] : u[1] - v[1]; });
      var prev = -1;
      for (j = 0; j < p.length; j++) {
        var id = node(p[j][0], p[j][1]);
        if (prev >= 0 && prev !== id && adj[prev].indexOf(id) < 0) { adj[prev].push(id); adj[id].push(prev); }
        prev = id;
      }
      // crossings (zebra) where a walk line crosses a road tile
      var s = segs[i];
      for (var yy = s[1]; yy <= s[3]; yy++) for (var xx = s[0]; xx <= s[2]; xx++) {
        if (tAt(xx, yy) === T.ROAD) crossings.push({ tx: xx, ty: yy, o: hz ? 'h' : 'v' });
      }
    }
    city.paths = { nodes: nodes, adj: adj };
  }

  function buildLanes() {
    city.lanes = [
      { type: 'road', loop: true, pts: [[580, 1884], [580, 164], [2844, 164], [2844, 1884]] },
      { type: 'road', loop: true, pts: [[540, 124], [540, 1924], [2884, 1924], [2884, 124]] },
      { type: 'road', loop: true, pts: [[540, 1152], [2884, 1152], [2884, 960], [540, 960]] },
      { type: 'road', loop: true, pts: [[1988, 960], [1988, 164], [2844, 164], [2844, 960]] },
      { type: 'road', loop: true, pts: [[580, 1152], [1532, 1152], [1532, 1884], [580, 1884]] },
      { type: 'bike', loop: true, pts: [[496, 1980], [496, 44], [444, 44], [444, 1980]] },
      { type: 'bike', loop: true, pts: [[760, 1044], [2656, 1044], [2656, 1068], [760, 1068]] }
    ];
  }

  // =====================================================================
  // NIGHT (v2 prototype, district x19-46 y28-56). Active only for city.init({night: true}).
  // Plain init() output is exactly v1 (night keys are deleted).
  // lights: px; zero beyond r. Falloff curve is stealth.js's (currently intensity * (1 - smoothstep(d/r)));
  // placements were tuned and checked against stealth.lightAt. Not pinned here (open contract question).
  // occluders for light and sight: BUILDING + KIOSK tiles + cover with blocksSight.
  // cover: tiles {x,y,w,h,kind,blocksSight}; solid in night grid only (tile ids unchanged).
  // =====================================================================
  var NIGHT_COL = { lamp: '#FFB54A', kiosk: '#CFE8FF', window: '#FFC878', neonPink: '#FF4FA8', neonCyan: '#4FD8FF' };
  var NIGHT_SPOTS = [
    ['n_kiosk_w', 'Rothschild Kiosk', 'kiosk', 26, 33], ['n_kiosk_n', 'Kiosk Corner', 'kiosk', 22, 28],
    ['n_blvd_w', 'Boulevard Benches', 'boulevard', 32, 33], ['n_blvd_e', 'Boulevard Lamps', 'boulevard', 43, 33],
    ['n_cafe_st', 'Cafe Street Corner', 'cafe', 39, 29], ['n_cafe_bar', 'Florentin Bar', 'cafe', 42, 41],
    ['n_alley_a', 'Florentin Corner', 'alley', 27, 47], ['n_alley_b', 'Graffiti Yard', 'alley', 38, 54]
  ];
  var NIGHT_ZONES = [[36, 28, 42, 30, 'cafe'], [39, 38, 45, 44, 'cafe']];
  var NIGHT_STARTS = [[19, 40], [34, 48], [46, 45]];
  // [tx, ty, w, h, kind, blocksSight]
  var NIGHT_COVER = [
    [20, 34, 2, 1, 'shelter', true], [37, 34, 2, 1, 'shelter', true],
    [26, 27, 1, 1, 'planter', true], [28, 27, 1, 1, 'planter', true], [33, 27, 1, 1, 'planter', true], [35, 27, 1, 1, 'planter', true],
    [36, 24, 1, 1, 'planter', true], [42, 24, 1, 1, 'planter', true],
    [27, 38, 1, 2, 'car', true], [27, 41, 1, 1, 'dumpster', true], [27, 53, 1, 2, 'car', true], [27, 56, 1, 1, 'dumpster', true],
    [35, 39, 1, 2, 'car', true], [35, 42, 1, 1, 'dumpster', true], [35, 46, 1, 1, 'dumpster', true], [35, 48, 1, 2, 'car', true],
    [41, 46, 1, 2, 'car', true], [41, 49, 1, 1, 'dumpster', true],
    [20, 45, 2, 1, 'car', true], [23, 45, 1, 1, 'planter', true], [31, 45, 2, 1, 'car', true], [37, 45, 1, 1, 'dumpster', true],
    [21, 52, 2, 1, 'car', true], [24, 52, 1, 1, 'dumpster', true], [31, 52, 1, 1, 'dumpster', true], [33, 52, 1, 1, 'planter', true],
    [44, 52, 1, 1, 'dumpster', true], [42, 52, 2, 1, 'car', true],
    [30, 27, 1, 1, 'planter', true], [36, 22, 1, 1, 'planter', true], [42, 22, 1, 1, 'planter', true], [20, 52, 1, 1, 'dumpster', true],
    [45, 45, 1, 1, 'dumpster', true], [39, 45, 1, 1, 'planter', true], [33, 45, 1, 1, 'dumpster', true], [35, 38, 1, 1, 'dumpster', true],
    [36, 34, 1, 1, 'planter', true]
  ];
  // [tx, ty, offX, offY, kind, colour, r, intensity, fromCase]  (px = t*32+16+off)
  var NIGHT_LIGHTS = [
    [22, 33, -16, -16, 'kiosk', 'kiosk', 128, 1.0, 1],
    // one key light per spot (~1 tile off centre): subjects lit, corners 4-5 tiles out stay dark
    [26, 32, 0, -8, 'lamp', 'lamp', 112, 0.9, 3], [21, 28, 0, -8, 'lamp', 'lamp', 104, 0.85, 3],
    [32, 34, 0, 8, 'lamp', 'lamp', 112, 0.9, 3], [43, 34, 0, 8, 'lamp', 'lamp', 112, 0.9, 3],
    [38, 28, 0, -8, 'neon', 'neonPink', 96, 0.8, 2], [40, 28, 0, -8, 'neon', 'neonCyan', 96, 0.75, 2],
    [41, 40, 0, 0, 'neon', 'neonPink', 96, 0.8, 2], [43, 42, 0, 0, 'neon', 'neonCyan', 96, 0.75, 2],
    [27, 46, 0, -8, 'lamp', 'lamp', 104, 0.85, 3], [38, 53, 0, -8, 'lamp', 'lamp', 104, 0.85, 3],
    // street ambience, away from the hiding corners
    [19, 30, 0, 0, 'lamp', 'lamp', 104, 0.85, 3], [19, 49, 0, 0, 'lamp', 'lamp', 104, 0.85, 3], [34, 57, 0, 0, 'lamp', 'lamp', 96, 0.8, 3],
    [40, 51, 0, 0, 'lamp', 'lamp', 80, 0.6, 3], [36, 37, 0, 0, 'lamp', 'lamp', 96, 0.7, 3], [43, 44, 0, 8, 'window', 'window', 56, 0.5, 2],
    // window glow in the alleys
    [21, 44, 0, -8, 'window', 'window', 48, 0.45, 2], [29, 44, 0, -8, 'window', 'window', 48, 0.45, 2], [37, 44, 0, -8, 'window', 'window', 48, 0.45, 3],
    [22, 51, 0, -8, 'window', 'window', 48, 0.45, 2], [30, 51, 0, -8, 'window', 'window', 48, 0.45, 3], [44, 51, 0, -8, 'window', 'window', 48, 0.45, 2],
    [26, 40, 8, 0, 'window', 'window', 48, 0.45, 3], [34, 41, 8, 0, 'window', 'window', 48, 0.45, 2], [40, 47, -8, 0, 'window', 'window', 48, 0.45, 3],
    [34, 49, -8, 0, 'window', 'window', 48, 0.45, 3]
  ];
  function buildNight() {
    var i, x, y, k;
    // zones (cafe overrides in the district)
    for (i = 0; i < NIGHT_ZONES.length; i++) { var nz = NIGHT_ZONES[i]; fillZ(nz[0], nz[1], nz[2], nz[3], Z[nz[4]]); }
    // trees too close to a night spot are removed in night mode (tile reverts to its floor)
    for (i = trees.length - 1; i >= 0; i--) {
      var tr = trees[i], near = false;
      for (k = 0; k < NIGHT_SPOTS.length; k++) if (Math.max(Math.abs(NIGHT_SPOTS[k][3] - tr.tx), Math.abs(NIGHT_SPOTS[k][4] - tr.ty)) <= 3) near = true;
      if (near) { tile[I(tr.tx, tr.ty)] = tr.park ? T.GRASS : T.STRIP; solid[I(tr.tx, tr.ty)] = 0; trees.splice(i, 1); }
    }
    city.cover = [];
    for (i = 0; i < NIGHT_COVER.length; i++) {
      var c = NIGHT_COVER[i];
      city.cover.push({ x: c[0], y: c[1], w: c[2], h: c[3], kind: c[4], blocksSight: c[5], v: hash3(c[0], c[1], 41) & 3 });
      for (y = c[1]; y < c[1] + c[3]; y++) for (x = c[0]; x < c[0] + c[2]; x++) solid[I(x, y)] = 1;
    }
    city.lights = [];
    for (i = 0; i < NIGHT_LIGHTS.length; i++) {
      var L = NIGHT_LIGHTS[i];
      city.lights.push({ x: tc(L[0]) + L[2], y: tc(L[1]) + L[3], r: L[6], color: NIGHT_COL[L[5]], intensity: L[7], kind: L[4], fromCase: L[8] });
    }
    city.daySpots = city.spots;
    city.spots = [];
    for (i = 0; i < NIGHT_SPOTS.length; i++) {
      var s = NIGHT_SPOTS[i];
      city.spots.push({ id: s[0], name: s[1], kind: s[2], x: tc(s[3]), y: tc(s[4]) });
    }
    city.playerStarts = NIGHT_STARTS.map(function (p) { return { x: tc(p[0]), y: tc(p[1]) }; });
    city.playerStart = city.playerStarts[0];
    city.district = { x0: 19, y0: 28, x1: 46, y1: 56 };
    city.NIGHT_COLORS = NIGHT_COL;
  }

  // ---------- public headless API ----------
  city.init = function (opts) {
    build();
    city.night = !!(opts && opts.night);
    if (city.night) buildNight();
    else { delete city.lights; delete city.cover; delete city.daySpots; delete city.district; delete city.NIGHT_COLORS; delete city.night; }
    city.gfxReady = false; // graphics (if any) are rebuilt lazily for the fresh data
    city.inited = true;
    return city;
  };
  city.zoneAt = function (x, y) {
    if (!city.inited) city.init();
    var tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    if (!inb(tx, ty)) return 'street';
    return ZN[zone[I(tx, ty)]] || 'street';
  };
  city.isSolidPx = function (x, y) {
    if (!city.inited) city.init();
    if (!(x >= 0 && y >= 0 && x < W * TS && y < H * TS)) return true;
    return solid[I(Math.floor(x / TS), Math.floor(y / TS))] === 1;
  };
  city.tileAt = function (tx, ty) { return tAt(tx, ty); };

  // =====================================================================
  // GRAPHICS (DOM only below, inside functions)
  // =====================================================================
  var chunks = null, nCX = W / CH, nCY = H / CH, canopies, umbImgs, towerImg, jetImgs, falUmb;
  var lastT = 0;

  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function hexRgb(h) { var n = parseInt(String(h).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function shade(h, f) { var c = hexRgb(h); return 'rgb(' + cl(c[0] * f) + ',' + cl(c[1] * f) + ',' + cl(c[2] * f) + ')'; }
  function mix(h1, h2, t) { var a = hexRgb(h1), b = hexRgb(h2); return 'rgb(' + cl(a[0] + (b[0] - a[0]) * t) + ',' + cl(a[1] + (b[1] - a[1]) * t) + ',' + cl(a[2] + (b[2] - a[2]) * t) + ')'; }
  function R(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function circ(g, c, x, y, r) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function ell(g, c, x, y, rx, ry) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  function isRoadish(t) { return t === T.ROAD || t === T.BIKE; }

  // ---- tile painters ----
  function paintTile(g, tx, ty) {
    var t = tile[I(tx, ty)], X = tx * TS, Y = ty * TS, k, r;
    function h(n) { return rnd(tx, ty, n); }
    switch (t) {
      case T.SEA: {
        R(g, tx <= 3 ? '#1E5F8F' : tx <= 5 ? '#246D9F' : '#2A7FB8', X, Y, TS, TS);
        for (k = 0; k < 3; k++) R(g, tx >= 6 ? '#5AA6D6' : '#3E86BC', X + Math.floor(h(k) * 24), Y + Math.floor(h(k + 3) * 30), 4 + Math.floor(h(k + 6) * 6), 1);
        if (tx === 7) {
          R(g, '#4FA3C9', X + 24, Y, 8, TS);
          for (k = 0; k < 8; k++) R(g, '#E6F2F5', X + 30 - Math.floor(h(k + 10) * 5), Y + k * 4, 3 + Math.floor(h(k + 20) * 4), 3);
        }
        break;
      }
      case T.SAND: case T.LIFEGUARD: {
        R(g, '#E8D3A0', X, Y, TS, TS);
        if (tx === 8) { R(g, '#CDB27A', X, Y, 7, TS); R(g, '#DAC28E', X + 7, Y, 5, TS); }
        for (k = 0; k < 12; k++) R(g, k % 3 === 0 ? '#D2B984' : k % 3 === 1 ? '#F3E3BA' : '#C9AE78', X + Math.floor(h(k) * 31), Y + Math.floor(h(k + 30) * 31), 1, 1);
        if (h(60) < 0.12) { R(g, '#CFB27C', X + 10, Y + 12, 2, 3); R(g, '#CFB27C', X + 14, Y + 16, 2, 3); }
        if (h(61) < 0.05) { R(g, '#F4EEE4', X + 18, Y + 8, 3, 2); }
        break;
      }
      case T.PROMENADE: {
        for (var j = 0; j < 4; j++) for (var i2 = 0; i2 < 4; i2++) {
          var px = X + i2 * 8, py = Y + j * 8;
          var band = Math.floor((px + 10 * Math.sin(py / 14)) / 12) & 1;
          R(g, band ? '#CDB9A3' : '#B79C86', px, py, 8, 8);
        }
        R(g, 'rgba(90,70,50,0.10)', X, Y, TS, 1);
        if (tx === 14) R(g, '#9C8672', X + 30, Y, 2, TS);
        break;
      }
      case T.ROAD: {
        R(g, '#3A3A40', X, Y, TS, TS);
        for (k = 0; k < 10; k++) R(g, k & 1 ? '#33333A' : '#46464D', X + Math.floor(h(k) * 31), Y + Math.floor(h(k + 20) * 31), 1 + (k % 3 === 0 ? 1 : 0), 1);
        r = h(50);
        if (r < 0.05) ell(g, 'rgba(20,20,26,0.45)', X + 16, Y + 16, 7, 4);
        else if (r < 0.09) { R(g, '#2E2E33', X + 6, Y + 12, 10, 1); R(g, '#2E2E33', X + 15, Y + 13, 6, 1); }
        else if (r < 0.105) { circ(g, '#4C4C55', X + 16, Y + 16, 6); circ(g, '#3E3E46', X + 16, Y + 16, 4); }
        break;
      }
      case T.BIKE: {
        R(g, '#8A3B2E', X, Y, TS, TS);
        for (k = 0; k < 8; k++) R(g, k & 1 ? '#7C3327' : '#98483A', X + Math.floor(h(k) * 31), Y + Math.floor(h(k + 20) * 31), 1, 1);
        R(g, '#D8CCC0', X + 30, Y, 1, TS); R(g, '#C9BCB0', X, Y, 1, TS);
        break;
      }
      case T.SIDEWALK: case T.KIOSK: {
        R(g, '#B8B4AC', X, Y, TS, TS);
        for (k = 0; k < 4; k++) { var v = h(k); R(g, v < 0.3 ? '#B2AEA6' : v < 0.6 ? '#BEBAB2' : '#B8B4AC', X + (k & 1) * 16 + 1, Y + (k >> 1) * 16 + 1, 15, 15); }
        R(g, '#A39F97', X, Y, TS, 1); R(g, '#A39F97', X, Y + 16, TS, 1); R(g, '#A39F97', X, Y, 1, TS); R(g, '#A39F97', X + 16, Y, 1, TS);
        if (h(40) < 0.08) R(g, '#9A968E', X + 4 + Math.floor(h(41) * 20), Y + 6, 1, 8);
        if (isRoadish(tAt(tx, ty - 1))) { R(g, '#8C8882', X, Y, TS, 3); R(g, '#D2CEC6', X, Y + 3, TS, 1); }
        if (isRoadish(tAt(tx, ty + 1))) { R(g, '#8C8882', X, Y + 29, TS, 3); R(g, '#D2CEC6', X, Y + 28, TS, 1); }
        if (isRoadish(tAt(tx - 1, ty))) { R(g, '#8C8882', X, Y, 3, TS); R(g, '#D2CEC6', X + 3, Y, 1, TS); }
        if (isRoadish(tAt(tx + 1, ty))) { R(g, '#8C8882', X + 29, Y, 3, TS); R(g, '#D2CEC6', X + 28, Y, 1, TS); }
        break;
      }
      case T.STRIP: {
        R(g, '#CDB98F', X, Y, TS, TS);
        for (k = 0; k < 14; k++) R(g, k & 1 ? '#BEA87C' : '#DAC9A0', X + Math.floor(h(k) * 31), Y + Math.floor(h(k + 20) * 31), 1, 1);
        if (tAt(tx, ty - 1) === T.ROAD) R(g, '#9C8C6C', X, Y, TS, 3);
        if (tAt(tx, ty + 1) === T.ROAD) R(g, '#9C8C6C', X, Y + 29, TS, 3);
        break;
      }
      case T.GRASS: paintGrass(g, tx, ty, X, Y); break;
      case T.TREE: {
        if (zone[I(tx, ty)] === Z.park) paintGrass(g, tx, ty, X, Y); else { R(g, '#CDB98F', X, Y, TS, TS); }
        circ(g, 'rgba(30,24,16,0.35)', X + 17, Y + 17, 7);
        circ(g, '#4A3424', X + 16, Y + 16, 4.5);
        break;
      }
      case T.PATH: {
        R(g, '#C8B590', X, Y, TS, TS);
        for (k = 0; k < 10; k++) R(g, k & 1 ? '#B4A07C' : '#D7C6A3', X + Math.floor(h(k) * 31), Y + Math.floor(h(k + 20) * 31), 1, 1);
        if (tAt(tx - 1, ty) === T.GRASS) R(g, '#A8956E', X, Y, 2, TS);
        if (tAt(tx + 1, ty) === T.GRASS) R(g, '#A8956E', X + 30, Y, 2, TS);
        if (tAt(tx, ty - 1) === T.GRASS) R(g, '#A8956E', X, Y, TS, 2);
        if (tAt(tx, ty + 1) === T.GRASS) R(g, '#A8956E', X, Y + 30, TS, 2);
        break;
      }
      case T.PLAZA: case T.FOUNTAIN: {
        for (k = 0; k < 4; k++) { var pv = h(k); R(g, pv < 0.33 ? '#CDAEA5' : pv < 0.66 ? '#C2A096' : '#D3B6AC', X + (k & 1) * 16, Y + (k >> 1) * 16, 16, 16); }
        R(g, '#B08F86', X, Y, TS, 1); R(g, '#B08F86', X, Y + 16, TS, 1); R(g, '#B08F86', X, Y, 1, TS); R(g, '#B08F86', X + 16, Y, 1, TS);
        break;
      }
      case T.BUILDING: R(g, '#4A4440', X, Y, TS, TS); break;
      case T.ALLEY: {
        R(g, '#7E756A', X, Y, TS, TS);
        for (var rr = 0; rr < 5; rr++) for (var cc = 0; cc < 4; cc++) {
          var sv = h(rr * 4 + cc);
          R(g, sv < 0.33 ? '#958B7E' : sv < 0.66 ? '#887E72' : '#9C9285', X + cc * 8 + ((rr & 1) ? 4 : 0) - 2, Y + rr * 6 + 1, 7, 5);
        }
        if (h(70) < 0.25) ell(g, 'rgba(50,40,30,0.25)', X + 8 + h(71) * 16, Y + 8 + h(72) * 16, 5, 3);
        break;
      }
      case T.MARKET: case T.STALL: case T.FALAFEL: {
        for (k = 0; k < 4; k++) { var mv = h(k); R(g, mv < 0.5 ? '#9A8C7A' : '#A39582', X + (k & 1) * 16, Y + (k >> 1) * 16, 16, 16); }
        R(g, '#8A7D6C', X, Y + 16, TS, 1); R(g, '#8A7D6C', X + 16, Y, 1, TS);
        for (k = 0; k < 3; k++) if (h(k + 10) < 0.35) R(g, ['#D9822B', '#B8433A', '#7A8240', '#E8D27A'][k + (tx & 1)], X + Math.floor(h(k + 20) * 28), Y + Math.floor(h(k + 30) * 28), 2, 2);
        if (t === T.STALL) paintStall(g, tx, ty, X, Y);
        else if (t === T.FALAFEL) paintFalafel(g, tx, ty, X, Y);
        break;
      }
      case T.CAFE: {
        R(g, '#C7B49A', X, Y, TS, TS);
        for (var cy = 0; cy < 8; cy++) for (var cx2 = 0; cx2 < 4; cx2++) {
          var hv = ((cx2 + cy) & 1) === 0;
          R(g, (h(cy * 4 + cx2) < 0.5) ? '#CDBBA2' : '#BEAA8E', X + cx2 * 8 + (hv ? 0 : 1), Y + cy * 4 + (hv ? 0 : 1), hv ? 7 : 6, 3);
        }
        break;
      }
      case T.YARD: {
        R(g, '#A9A49A', X, Y, TS, TS);
        if (h(1) < 0.5) ell(g, '#6E8A4E', X + 8 + h(2) * 16, Y + 8 + h(3) * 16, 6, 4);
        for (k = 0; k < 6; k++) R(g, '#9C978C', X + Math.floor(h(k + 5) * 31), Y + Math.floor(h(k + 15) * 31), 2, 1);
        if (h(30) < 0.15) { R(g, '#3E5A66', X + 20, Y + 6, 7, 9); R(g, '#2E4650', X + 20, Y + 6, 7, 2); }
        break;
      }
      default: R(g, '#B8B4AC', X, Y, TS, TS);
    }
  }
  function paintGrass(g, tx, ty, X, Y) {
    R(g, '#5E8C3A', X, Y, TS, TS);
    var k, h = function (n) { return rnd(tx, ty, n + 100); };
    for (k = 0; k < 2; k++) R(g, h(k) < 0.5 ? '#5A8737' : '#638F40', X + (h(k + 2) < 0.5 ? 0 : 16), Y + (h(k + 4) < 0.5 ? 0 : 16), 16, 16);
    for (k = 0; k < 8; k++) R(g, k & 1 ? '#4F7A30' : '#6E9A48', X + Math.floor(h(k + 10) * 30), Y + Math.floor(h(k + 20) * 29), 1, 2);
    if (h(40) < 0.15) R(g, h(41) < 0.5 ? '#D8CFA0' : '#C9A0B0', X + Math.floor(h(42) * 30), Y + Math.floor(h(43) * 30), 1, 1);
  }
  var STALL_COL = [['#C0392B', '#F2EDE4'], ['#2E5A8A', '#F2EDE4'], ['#D98A3A', '#F2EDE4'], ['#7A4A8A', '#F2EDE4']];
  var PRODUCE = ['#D8382E', '#F08A24', '#6A3A7A', '#E8C83A', '#7E8E3A', '#B8552A', '#F2E2B0'];
  function paintStall(g, tx, ty, X, Y) {
    var seg = null;
    for (var i = 0; i < stallSegs.length; i++) { var s = stallSegs[i]; if (s.y === ty && tx >= s.x0 && tx <= s.x1) { seg = s; break; } }
    var col = STALL_COL[seg ? seg.c : 0];
    R(g, 'rgba(30,20,10,0.3)', X, Y + 26, TS, 4);
    R(g, '#7A5A3A', X, Y + 10, TS, 17); R(g, '#5E4428', X, Y + 25, TS, 2);
    for (var k = 0; k < 4; k++) {
      var pc = PRODUCE[hash3(tx, ty, k) % PRODUCE.length];
      for (var d = 0; d < 4; d++) circ(g, pc, X + 4 + k * 8 + (d & 1) * 2 - 1, Y + 15 + (d >> 1) * 3 + (d & 1), 2.2);
    }
    for (var sx = 0; sx < 8; sx++) R(g, sx & 1 ? col[1] : col[0], X + sx * 4, Y, 4, 9);
    R(g, shade(col[0], 0.7), X, Y + 9, TS, 1);
  }
  function paintFalafel(g, tx, ty, X, Y) {
    R(g, 'rgba(30,20,10,0.3)', X + 2, Y + 26, 30, 4);
    R(g, '#A8ADB4', X + 1, Y + 6, 30, 20); R(g, '#8A9098', X + 1, Y + 6, 30, 2);
    R(g, '#E0A030', X + 1, Y + 20, 30, 6); R(g, '#B8343A', X + 1, Y + 22, 30, 2);
    for (var k = 0; k < 4; k++) circ(g, '#E8C890', X + 6 + k * 6, Y + 13, 2.4);
    circ(g, '#7A5A2A', X + 26, Y + 12, 2);
  }

  // ---- decor painted into chunks ----
  function paintDecor(g, wx0, wy0, wx1, wy1) {
    var i, b, k;
    function vis(x, y, w, h) { return x + w >= wx0 && y + h >= wy0 && x <= wx1 && y <= wy1; }
    // shadows (single fill => no double darkening); sun low in the west -> cast east
    g.beginPath();
    for (i = 0; i < drawList.length; i++) {
      b = drawList[i];
      var sdx = Math.round(16 * b.ht), sdy = Math.round(6 * b.ht), bx = b.x * TS, by = b.y * TS;
      if (vis(bx, by, b.w * TS + sdx, b.h * TS + sdy)) g.rect(bx + sdx, by + sdy, b.w * TS, b.h * TS);
    }
    for (i = 0; i < trees.length; i++) { var tr = trees[i]; if (vis(tr.x - 40, tr.y - 40, 80, 80)) { g.moveTo(tr.x + 30, tr.y + 6); g.ellipse(tr.x + 9, tr.y + 6, 21, 17, 0, 0, Math.PI * 2); } }
    for (i = 0; i < umbrellas.length; i++) { var u = umbrellas[i]; if (vis(u.x - 30, u.y - 30, 60, 60)) { g.moveTo(u.x + 25, u.y + 4); g.ellipse(u.x + 8, u.y + 4, 17, 15, 0, 0, Math.PI * 2); } }
    for (i = 0; i < towers.length; i++) { var tw = towers[i]; if (vis(tw.x - 40, tw.y - 40, 80, 80)) g.rect(tw.x - 6, tw.y - 8, 30, 22); }
    g.fillStyle = 'rgba(28,18,40,0.30)'; g.fill();

    // road markings
    for (i = 0; i < roads.length; i++) {
      var r = roads[i], tx, ty;
      if (r.o === 'h') {
        var rows = r.y1 - r.y0 + 1, ly = rows === 3 ? (r.y0 + 1) * TS + 15 : (r.y0 + 1) * TS - 1, lc = rows === 3 ? '#E2C040' : '#E6E6E0';
        if (!vis(r.x0 * TS, r.y0 * TS, (r.x1 - r.x0 + 1) * TS, rows * TS)) continue;
        for (tx = r.x0; tx <= r.x1; tx++) {
          if (tAt(tx, r.y0 - 1) === T.ROAD || tAt(tx, r.y1 + 1) === T.ROAD || tAt(tx, r.y0) !== T.ROAD) continue;
          R(g, lc, tx * TS + 6, ly, 16, 2);
          if (rows === 3) { R(g, 'rgba(230,230,224,0.7)', tx * TS, r.y0 * TS + 3, TS, 1); R(g, 'rgba(230,230,224,0.7)', tx * TS, (r.y1 + 1) * TS - 4, TS, 1); }
        }
      } else {
        var cols = r.x1 - r.x0 + 1, lx = cols === 3 ? (r.x0 + 1) * TS + 15 : (r.x0 + 1) * TS - 1, lc2 = cols === 3 ? '#E2C040' : '#E6E6E0';
        if (!vis(r.x0 * TS, r.y0 * TS, cols * TS, (r.y1 - r.y0 + 1) * TS)) continue;
        for (ty = r.y0; ty <= r.y1; ty++) {
          if (tAt(r.x0 - 1, ty) === T.ROAD || tAt(r.x1 + 1, ty) === T.ROAD || tAt(r.x0, ty) !== T.ROAD) continue;
          R(g, lc2, lx, ty * TS + 6, 2, 16);
          if (cols === 3) { R(g, 'rgba(230,230,224,0.7)', r.x0 * TS + 3, ty * TS, 1, TS); R(g, 'rgba(230,230,224,0.7)', (r.x1 + 1) * TS - 4, ty * TS, 1, TS); }
        }
      }
    }
    // zebra crossings
    for (i = 0; i < crossings.length; i++) {
      var c = crossings[i], X = c.tx * TS, Y = c.ty * TS;
      if (!vis(X, Y, TS, TS)) continue;
      for (k = 0; k < 4; k++) {
        if (c.o === 'v') R(g, '#E4E4DE', X + 4, Y + 2 + k * 8, 24, 4);
        else R(g, '#E4E4DE', X + 2 + k * 8, Y + 4, 4, 24);
      }
    }
    // bike symbols
    g.strokeStyle = '#E8DCD0'; g.lineWidth = 1;
    for (var by2 = 4; by2 < H - 2; by2 += 9) {
      var bxp = 15 * TS + 16, byp = by2 * TS + 16;
      if (!vis(bxp - 16, byp - 16, 32, 32)) continue;
      g.beginPath(); g.arc(bxp, byp - 7, 4, 0, Math.PI * 2); g.moveTo(bxp + 4, byp + 7); g.arc(bxp, byp + 7, 4, 0, Math.PI * 2);
      g.moveTo(bxp, byp - 7); g.lineTo(bxp - 3, byp); g.lineTo(bxp, byp + 7); g.moveTo(bxp - 3, byp); g.lineTo(bxp + 3, byp - 4); g.stroke();
    }
    // fountain basin
    var fx = 51.5 * TS, fy = 13.5 * TS;
    if (vis(fx - 50, fy - 50, 100, 100)) {
      circ(g, 'rgba(40,30,30,0.25)', fx + 4, fy + 4, 47);
      circ(g, '#B09488', fx, fy, 46); circ(g, '#CDB7AC', fx, fy, 42); circ(g, '#2A7FB8', fx, fy, 37);
      g.strokeStyle = '#4E9CD2'; g.lineWidth = 1;
      g.beginPath(); g.arc(fx, fy, 28, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(fx, fy, 19, 0, Math.PI * 2); g.stroke();
      circ(g, '#BFA79C', fx, fy, 8); circ(g, '#D8C4BA', fx - 1, fy - 1, 5);
    }
    // benches
    for (i = 0; i < benches.length; i++) { var be = benches[i]; if (vis(be.x - 20, be.y - 20, 40, 40)) drawBench(g, be.x, be.y, be.dir); }
    // cafe tables
    for (i = 0; i < tables.length; i++) {
      var tb = tables[i];
      if (!vis(tb.x - 24, tb.y - 24, 48, 48)) continue;
      R(g, 'rgba(30,20,10,0.25)', tb.x - 13, tb.y - 2, 28, 10);
      R(g, '#6E4E34', tb.x - 14, tb.y - 3, 6, 6); R(g, '#6E4E34', tb.x + 8, tb.y - 3, 6, 6);
      circ(g, '#BDB2A0', tb.x + 1, tb.y + 1, 6); circ(g, '#EEE6D8', tb.x, tb.y, 6); circ(g, '#C8664A', tb.x, tb.y, 1.5);
      if (rnd(tb.x, tb.y, 4) < 0.4) { circ(g, '#8A5A3A', tb.x, tb.y + 11, 3); circ(g, '#55703A', tb.x, tb.y + 10, 3); }
    }
    // graffiti on alley floor next to walls
    var GC = ['#E0408A', '#F2C230', '#40B8D8', '#F2F2F2', '#F07A1A', '#9A5AE0'];
    var gx0 = Math.max(0, Math.floor(wx0 / TS) - 1), gx1 = Math.min(W - 1, Math.floor(wx1 / TS) + 1);
    var gy0 = Math.max(0, Math.floor(wy0 / TS) - 1), gy1 = Math.min(H - 1, Math.floor(wy1 / TS) + 1);
    for (var yy = gy0; yy <= gy1; yy++) for (var xx = gx0; xx <= gx1; xx++) {
      if (tile[I(xx, yy)] !== T.ALLEY || rnd(xx, yy, 300) > 0.22) continue;
      var nb = tAt(xx, yy - 1) === T.BUILDING ? 0 : tAt(xx - 1, yy) === T.BUILDING ? 1 : tAt(xx + 1, yy) === T.BUILDING ? 2 : tAt(xx, yy + 1) === T.BUILDING ? 3 : -1;
      if (nb < 0) continue;
      var col = GC[hash3(xx, yy, 301) % GC.length], col2 = GC[hash3(xx, yy, 302) % GC.length];
      var gxp = xx * TS + (nb === 1 ? 2 : nb === 2 ? 18 : 6), gyp = yy * TS + (nb === 0 ? 2 : nb === 3 ? 20 : 8);
      var horiz = nb === 0 || nb === 3;
      for (k = 0; k < 5; k++) {
        var a = Math.floor(rnd(xx, yy, 310 + k) * 4);
        if (horiz) { R(g, '#1E1A18', gxp + k * 4, gyp + a, 4, 7); R(g, k & 1 ? col : col2, gxp + k * 4 + 1, gyp + a + 1, 3, 5); }
        else { R(g, '#1E1A18', gxp + a, gyp + k * 4, 7, 4); R(g, k & 1 ? col : col2, gxp + a + 1, gyp + k * 4 + 1, 5, 3); }
      }
    }
  }
  // night cover props are static: baked into the ground chunks (art.drawCover; plain fallback)
  function paintCover(g, wx0, wy0, wx1, wy1) {
    var art = PE.art, i, c, X, Y;
    for (i = 0; i < city.cover.length; i++) {
      c = city.cover[i]; X = c.x * TS; Y = c.y * TS;
      if (X + c.w * TS + 16 < wx0 || Y + c.h * TS + 16 < wy0 || X > wx1 || Y > wy1) continue;
      if (art && typeof art.drawCover === 'function') art.drawCover(g, X, Y, c.kind, c.w, c.h, c.v);
      else { R(g, 'rgba(20,14,30,0.35)', X + 4, Y + 4, c.w * TS, c.h * TS); R(g, '#5A5A64', X + 2, Y + 2, c.w * TS - 4, c.h * TS - 4); }
    }
  }
  function drawBench(g, x, y, dir) {
    var horiz = (dir === 0 || dir === 4);
    if (horiz) {
      R(g, 'rgba(30,20,10,0.3)', x - 10, y - 1, 24, 8);
      R(g, '#9A6A3E', x - 11, y - 4, 22, 7);
      R(g, '#7A5230', x - 11, y - 2, 22, 1); R(g, '#7A5230', x - 11, y + 1, 22, 1);
      R(g, '#4E3420', x - 11, dir === 0 ? y + 3 : y - 6, 22, 2);
    } else {
      R(g, 'rgba(30,20,10,0.3)', x - 1, y - 10, 8, 24);
      R(g, '#9A6A3E', x - 4, y - 11, 7, 22);
      R(g, '#7A5230', x - 2, y - 11, 1, 22); R(g, '#7A5230', x + 1, y - 11, 1, 22);
      R(g, '#4E3420', dir === 6 ? x + 3 : x - 6, y - 11, 2, 22);
    }
  }

  // ---- roofs & walls ----
  function placer(w, h, rng) {
    var cw = Math.ceil(w / 4) + 1, chh = Math.ceil(h / 4) + 1, occ = new Uint8Array(cw * chh);
    return function (iw, ih) {
      for (var a = 0; a < 16; a++) {
        var x = 5 + Math.floor(rng() * Math.max(1, w - iw - 10)), y = 5 + Math.floor(rng() * Math.max(1, h - ih - 10));
        if (x + iw > w - 4 || y + ih > h - 4) continue;
        var ok = true, cx0 = x >> 2, cy0 = y >> 2, cx1 = (x + iw + 2) >> 2, cy1 = (y + ih + 2) >> 2, X, Y;
        for (Y = cy0; Y <= cy1 && ok; Y++) for (X = cx0; X <= cx1; X++) if (occ[Y * cw + X]) { ok = false; break; }
        if (!ok) continue;
        for (Y = cy0; Y <= cy1; Y++) for (X = cx0; X <= cx1; X++) occ[Y * cw + X] = 1;
        return [x, y];
      }
      return null;
    };
  }
  function solarUnit(g, x, y) {
    R(g, 'rgba(60,40,30,0.22)', x + 3, y + 3, 18, 18);
    R(g, '#24345A', x + 1, y + 6, 7, 12); R(g, '#24345A', x + 10, y + 6, 7, 12);
    R(g, '#5A6E98', x + 1, y + 10, 7, 1); R(g, '#5A6E98', x + 10, y + 10, 7, 1); R(g, '#5A6E98', x + 1, y + 14, 7, 1); R(g, '#5A6E98', x + 10, y + 14, 7, 1);
    R(g, '#ECECE8', x, y, 18, 5); R(g, '#BDBDB8', x, y + 4, 18, 1); R(g, '#FFFFFF', x + 1, y + 1, 16, 1);
  }
  function waterTank(g, x, y, dark) {
    circ(g, 'rgba(60,40,30,0.25)', x + 6, y + 6, 5);
    circ(g, dark ? '#2C2C30' : '#D4D4D0', x + 4, y + 4, 4.5);
    circ(g, dark ? '#45454C' : '#F2F2EE', x + 3, y + 3, 2);
  }
  function acUnit(g, x, y) {
    R(g, 'rgba(60,40,30,0.25)', x + 2, y + 2, 8, 7); R(g, '#A8A8AC', x, y, 8, 7); R(g, '#C4C4C8', x, y, 8, 1);
    circ(g, '#6A6A72', x + 4, y + 3.5, 2.4); circ(g, '#4A4A50', x + 4, y + 3.5, 1);
  }
  function paintRoof(b) {
    var w = b.w * TS, h = b.h * TS, c = mk(w, h), g = c.getContext('2d'), rng = mulberry(b.seed), i, p;
    var place = placer(w, h, rng);
    if (b.style === 'kiosk') {
      R(g, '#2E4E56', 0, 0, w, h); R(g, '#3E6670', 2, 2, w - 4, h - 4);
      for (i = 0; i < w; i += 6) R(g, (i / 6) & 1 ? '#F2EDE4' : '#C0392B', i, h - 8, 6, 8);
      R(g, '#2A2A30', w / 2 - 6, 10, 12, 8); R(g, '#E8C040', 8, 8, 6, 6);
      b.roofColor = '#3E6670';
    } else if (b.style === 'old' && rng() < 0.3) {
      R(g, '#A9472F', 0, 0, w, h);
      var alongX = w >= h;
      for (i = 0; i < (alongX ? h : w); i += 4) { if (alongX) R(g, '#8A3622', 0, i, w, 1); else R(g, '#8A3622', i, 0, 1, h); }
      for (i = 0; i < (alongX ? h : w); i += 4) { if (alongX) R(g, '#C0583C', 0, i + 1, w, 1); else R(g, '#C0583C', i + 1, 0, 1, h); }
      if (alongX) { R(g, '#6E2A1A', 0, (h >> 1) - 1, w, 3); R(g, 'rgba(0,0,0,0.15)', 0, h >> 1, w, h >> 1); }
      else { R(g, '#6E2A1A', (w >> 1) - 1, 0, 3, h); R(g, 'rgba(0,0,0,0.15)', w >> 1, 0, w >> 1, h); }
      R(g, '#5E2416', 0, 0, w, 1); R(g, '#5E2416', 0, h - 1, w, 1); R(g, '#5E2416', 0, 0, 1, h); R(g, '#5E2416', w - 1, 0, 1, h);
      b.roofColor = '#A9472F';
    } else if (b.style === 'old') {
      var base = pick(rng, ['#C9A47A', '#BC9168', '#D3B48A', '#B88A62', '#CDBB9C']);
      b.roofColor = base;
      R(g, base, 0, 0, w, h);
      for (i = 0; i < (w * h / 500 | 0); i++) R(g, 'rgba(90,60,40,0.10)', rng() * w, rng() * h, 4 + rng() * 10, 3 + rng() * 8);
      R(g, shade(base, 0.8), 0, 0, w, 2); R(g, shade(base, 0.8), 0, h - 2, w, 2); R(g, shade(base, 0.8), 0, 0, 2, h); R(g, shade(base, 0.8), w - 2, 0, 2, h);
      R(g, 'rgba(60,40,20,0.18)', 2, 2, 3, h - 4);
      var nItems = 1 + Math.floor(rng() * 3 + w * h / 6000);
      for (i = 0; i < nItems; i++) {
        var kind = rng();
        if (kind < 0.3) { p = place(10, 10); if (p) waterTank(g, p[0], p[1], rng() < 0.5); }
        else if (kind < 0.55) { p = place(12, 8); if (p) { for (var q = 0; q < 3; q++) { circ(g, '#8E5A3A', p[0] + 2 + q * 4, p[1] + 5, 2); circ(g, '#55703A', p[0] + 2 + q * 4, p[1] + 3, 2.6); } } }
        else if (kind < 0.75) {
          p = place(Math.min(26, w - 12), 6);
          if (p) {
            var lw = Math.min(26, w - 12); R(g, '#E8E4DC', p[0], p[1] + 1, lw, 1);
            for (q = 0; q < 4; q++) R(g, pick(rng, ['#E04A5A', '#3A8AC8', '#F2F2F2', '#E8C840', '#9A5AA0']), p[0] + 1 + q * (lw / 4 | 0), p[1] + 2, 4, 4);
          }
        } else if (kind < 0.88) { p = place(8, 8); if (p) { circ(g, '#E8E8E4', p[0] + 4, p[1] + 4, 3.5); circ(g, '#B8B8B4', p[0] + 4, p[1] + 4, 1.4); } }
        else { p = place(18, 18); if (p) solarUnit(g, p[0], p[1]); }
      }
    } else {
      var bb = pick(rng, ['#F1EDE4', '#EEE8DC', '#F3EFE7', '#EAE3D5']);
      b.roofColor = bb;
      R(g, bb, 0, 0, w, h);
      for (i = 0; i < (w * h / 900 | 0); i++) R(g, 'rgba(150,130,100,0.08)', rng() * w, rng() * h, 6 + rng() * 14, 4 + rng() * 10);
      R(g, '#D6CFC0', 0, 0, w, 3); R(g, '#D6CFC0', 0, h - 3, w, 3); R(g, '#D6CFC0', 0, 0, 3, h); R(g, '#D6CFC0', w - 3, 0, 3, h);
      R(g, '#FBF8F2', 0, 0, w, 1); R(g, '#FBF8F2', 0, 0, 1, h);
      R(g, 'rgba(120,100,80,0.18)', 3, 3, 3, h - 6); R(g, 'rgba(120,100,80,0.10)', 3, 3, w - 6, 2);
      if (w >= 64 && h >= 64) {
        p = place(18, 14);
        if (p) { R(g, 'rgba(110,90,70,0.3)', p[0] + 3, p[1] + 2, 18, 14); R(g, '#E5DFD0', p[0], p[1], 18, 14); R(g, '#F6F2EA', p[0], p[1], 18, 1); R(g, '#6A5A4A', p[0] + 7, p[1] + 12, 4, 2); }
      }
      var ns = Math.max(1, Math.round(w * h / 4500));
      for (i = 0; i < ns; i++) { p = place(18, 18); if (p) solarUnit(g, p[0], p[1]); }
      var nt = Math.round(rng() * 2 + w * h / 9000);
      for (i = 0; i < nt; i++) { p = place(10, 10); if (p) waterTank(g, p[0], p[1], rng() < 0.35); }
      var na = 1 + Math.floor(rng() * 2 + w * h / 8000);
      for (i = 0; i < na; i++) { p = place(9, 8); if (p) acUnit(g, p[0], p[1]); }
      if (rng() < 0.5) { p = place(3, 12); if (p) { R(g, '#6A6A70', p[0] + 1, p[1], 1, 12); R(g, '#6A6A70', p[0] - 2, p[1] + 2, 7, 1); } }
    }
    return c;
  }
  var BAU_WALL = ['#EDE6D6', '#F2EBDD', '#E6DDC9', '#EFE3CF'];
  var OLD_WALL = ['#D2A46E', '#C98F5E', '#BFA27A', '#D8B88A', '#B87A56', '#C9B59A'];
  function paintWall(b, side) {
    var vert = side === 'W' || side === 'E';
    var L = (vert ? b.h : b.w) * TS, D = WALL_D;
    var c = mk(vert ? D : L, vert ? L : D), g = c.getContext('2d');
    var f = side === 'W' ? 1.04 : side === 'S' ? 0.88 : side === 'N' ? 0.74 : 0.64;
    var rng = mulberry(b.seed + side.charCodeAt(0));
    function Rw(h0, h1, l0, l1, col) { g.fillStyle = col; if (vert) g.fillRect(h0, l0, h1 - h0, l1 - l0); else g.fillRect(l0, h0, l1 - l0, h1 - h0); }
    var l, k;
    if (b.style === 'kiosk') {
      Rw(0, D, 0, L, shade('#3E6670', f));
      Rw(2, D - 4, 4, L - 4, shade('#8AB8D0', f));
      for (l = 6; l < L - 6; l += 5) Rw(4, D - 6, l, l + 3, shade(pick(rng, ['#C0392B', '#E8C040', '#3A6AC0', '#F2F2F2']), f));
      return c;
    }
    var old = b.style === 'old';
    var wall = old ? OLD_WALL[b.seed % OLD_WALL.length] : BAU_WALL[b.seed % BAU_WALL.length];
    b.wallColor = wall;
    var floors = Math.max(2, Math.round(b.ht * (old ? 4 : 4.4))), fh = D / floors;
    Rw(0, D, 0, L, shade(wall, f));
    Rw(D - 1.5, D, 0, L, shade(wall, f * 1.08));
    Rw(0, 1, 0, L, shade(wall, f * 0.6));
    for (k = 1; k < floors; k++) {
      var h0 = k * fh + fh * 0.25, h1 = h0 + fh * 0.45;
      if (old) {
        for (l = 4; l < L - 6; l += 10) {
          Rw(h0, h1, l + 2, l + 6, shade('#2A2420', f));
          var sh = rng() < 0.5 ? '#4E7A8A' : '#7A4A3A';
          Rw(h0, h1, l, l + 2, shade(sh, f)); Rw(h0, h1, l + 6, l + 8, shade(sh, f));
        }
      } else {
        for (l = 3; l < L - 6; l += 9) Rw(h0, h1, l, l + 7, shade('#3C4A5C', f));
        if (k % 2 === 1) Rw(k * fh - 0.5, k * fh + 1.5, 2, L - 2, shade('#FFFFFF', f * 0.98));
      }
    }
    // ground floor: shops / doors / graffiti
    var gh = fh * 0.85;
    for (l = 3; l < L - 8; l += 14) {
      if (rng() < 0.5) Rw(0.5, gh, l, l + 8, shade('#3A3028', f));
      else if (!old) Rw(0.5, gh, l, l + 10, shade(pick(rng, ['#C0392B', '#2E5A8A', '#D98A3A', '#7A4A8A']), f));
    }
    if (old) {
      var GC = ['#E0408A', '#F2C230', '#40B8D8', '#F2F2F2', '#F07A1A'];
      var tags = 1 + Math.floor(rng() * 3);
      for (k = 0; k < tags; k++) {
        var tl = Math.floor(rng() * Math.max(1, L - 16)), col = pick(rng, GC);
        for (var q = 0; q < 4; q++) Rw(0.5 + (q & 1), gh + 1 - (q & 1), tl + q * 3, tl + q * 3 + 2, shade(col, Math.min(1.1, f + 0.2)));
      }
    }
    return c;
  }

  function paintCanopy(v) {
    var r = 22 + (v & 1) * 3, s = r * 2 + 4, c = mk(s, s), g = c.getContext('2d'), rng = mulberry(900 + v), cx = s / 2, cy = s / 2, i;
    var dark = ['#2C4424', '#30482A', '#2A4022', '#334C2C'][v], mid = '#3A5A2E', hi = '#4C6E3A';
    for (i = 0; i < 9; i++) { var a = i / 9 * Math.PI * 2, d = r * 0.55; circ(g, dark, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.48); }
    circ(g, dark, cx, cy, r * 0.7);
    for (i = 0; i < 7; i++) { var a2 = rng() * Math.PI * 2, d2 = rng() * r * 0.5; circ(g, mid, cx + Math.cos(a2) * d2 - 3, cy + Math.sin(a2) * d2 - 2, r * 0.32); }
    for (i = 0; i < 6; i++) { var a3 = Math.PI * (0.9 + rng() * 0.6), d3 = r * (0.3 + rng() * 0.4); circ(g, hi, cx + Math.cos(a3) * d3, cy + Math.sin(a3) * d3, r * 0.16); }
    return c;
  }
  var UMB = [['#C0392B', '#F2EDE4'], ['#2E6AA8', '#F2EDE4'], ['#E8862A', '#F2EDE4'], ['#E8C83A', '#2E6AA8']];
  function paintUmbrella(v, r) {
    var s = r * 2 + 2, c = mk(s, s), g = c.getContext('2d'), cx = s / 2, i, col = UMB[v & 3];
    for (i = 0; i < 8; i++) {
      g.fillStyle = (i & 1) ? col[1] : col[0];
      g.beginPath(); g.moveTo(cx, cx); g.arc(cx, cx, r, i / 8 * Math.PI * 2, (i + 1) / 8 * Math.PI * 2); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cx, r - 0.5, 0, Math.PI * 2); g.stroke();
    circ(g, '#F8F4EC', cx, cx, 2);
    return c;
  }
  function paintTower() {
    var c = mk(30, 30), g = c.getContext('2d');
    R(g, '#8A6A44', 1, 1, 28, 28); R(g, '#F2EDE4', 3, 3, 24, 24);
    for (var i = 0; i < 24; i += 6) R(g, '#C0392B', 3 + i, 3, 3, 24);
    R(g, '#5E4428', 1, 1, 28, 2); R(g, '#E8C040', 22, 0, 6, 4);
    return c;
  }
  function paintJet(fr) {
    var c = mk(48, 48), g = c.getContext('2d'), rng = mulberry(50 + fr);
    for (var i = 0; i < 26; i++) {
      var a = rng() * Math.PI * 2, d = 4 + ((rng() * 16 + fr * 4) % 18);
      circ(g, i & 1 ? 'rgba(220,240,255,0.85)' : 'rgba(150,200,235,0.8)', 24 + Math.cos(a) * d, 24 + Math.sin(a) * d, 1 + rng() * 1.2);
    }
    circ(g, 'rgba(235,248,255,0.9)', 24, 24, 4);
    return c;
  }

  city.initGraphics = function () {
    if (typeof document === 'undefined') return false;
    if (!city.inited) city.init();
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var i, cx, cy;
    chunks = [];
    for (cy = 0; cy < nCY; cy++) for (cx = 0; cx < nCX; cx++) {
      var c = mk(CPX, CPX), g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, -cx * CPX, -cy * CPX);
      for (var ty = cy * CH; ty < (cy + 1) * CH; ty++) for (var tx = cx * CH; tx < (cx + 1) * CH; tx++) paintTile(g, tx, ty);
      paintDecor(g, cx * CPX, cy * CPX, (cx + 1) * CPX, (cy + 1) * CPX);
      if (city.night && city.cover) paintCover(g, cx * CPX, cy * CPX, (cx + 1) * CPX, (cy + 1) * CPX);
      g.setTransform(1, 0, 0, 1, 0, 0);
      chunks.push(c);
    }
    for (i = 0; i < drawList.length; i++) {
      var b = drawList[i];
      b.roof = paintRoof(b);
      b.tW = paintWall(b, 'W'); b.tE = paintWall(b, 'E'); b.tN = paintWall(b, 'N'); b.tS = paintWall(b, 'S');
    }
    canopies = [paintCanopy(0), paintCanopy(1), paintCanopy(2), paintCanopy(3)];
    umbImgs = [paintUmbrella(0, 17), paintUmbrella(1, 17), paintUmbrella(2, 17), paintUmbrella(3, 17)];
    falUmb = paintUmbrella(0, 15);
    towerImg = paintTower();
    jetImgs = [paintJet(0), paintJet(1), paintJet(2), paintJet(3)];
    city.gfxReady = true;
    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    city.gfxMs = Math.round(t1 - t0);
    return true;
  };

  function ensureGfx() {
    if (city.gfxReady) return true;
    if (typeof document === 'undefined') return false;
    return city.initGraphics();
  }

  city.drawGround = function (ctx, cam) {
    if (!ensureGfx()) return;
    var vw = cam.w || 960, vh = cam.h || 540;
    var cx0 = Math.max(0, Math.floor(cam.x / CPX)), cx1 = Math.min(nCX - 1, Math.floor((cam.x + vw) / CPX));
    var cy0 = Math.max(0, Math.floor(cam.y / CPX)), cy1 = Math.min(nCY - 1, Math.floor((cam.y + vh) / CPX));
    var camX = Math.round(cam.x), camY = Math.round(cam.y);
    for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) ctx.drawImage(chunks[cy * nCX + cx], cx * CPX - camX, cy * CPX - camY);
    // animated shoreline foam (cheap: ~2 rects per visible row)
    var shoreX = 8 * TS - camX;
    if (shoreX > -16 && shoreX < vw + 16) {
      ctx.fillStyle = 'rgba(240,250,252,0.75)';
      var ty0 = Math.max(0, Math.floor(camY / TS)), ty1 = Math.min(H - 1, Math.floor((camY + vh) / TS));
      for (var ty = ty0; ty <= ty1; ty++) {
        var ph = Math.sin(lastT * 1.7 + ty * 0.9);
        var wv = Math.round(3 + ph * 3);
        ctx.fillRect(shoreX - 4 + wv, ty * TS - camY, 3, 14);
        ctx.fillRect(shoreX - 2 + Math.round(wv * 0.6), ty * TS - camY + 16, 2, 12);
      }
    }
  };

  function off(d, ht) { var o = d * ht * 0.04; return o > MAXOFF ? MAXOFF : o < -MAXOFF ? -MAXOFF : Math.round(o); }
  // wall quad = texture skewed onto the parallelogram; composes with the caller's transform, no allocation
  function wall(ctx, img, a, b, c, d, e, f) { ctx.save(); ctx.transform(a, b, c, d, e, f); ctx.drawImage(img, 0, 0); ctx.restore(); }

  city.drawTop = function (ctx, cam, timeSec) {
    if (!ensureGfx()) return;
    lastT = +timeSec || 0;
    var vw = cam.w || 960, vh = cam.h || 540, camX = Math.round(cam.x), camY = Math.round(cam.y);
    var vcx = cam.x + vw / 2, vcy = cam.y + vh / 2, i, sx, sy, ox, oy, img;
    // small structures first
    for (i = 0; i < towers.length; i++) {
      var tw = towers[i]; sx = tw.x - camX; sy = tw.y - camY;
      if (sx < -64 || sy < -64 || sx > vw + 64 || sy > vh + 64) continue;
      ox = off(tw.x - vcx, 0.6); oy = off(tw.y - vcy, 0.6);
      ctx.strokeStyle = '#6A5034'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(sx - 12, sy - 12); ctx.lineTo(sx - 12 + ox, sy - 12 + oy); ctx.moveTo(sx + 12, sy - 12); ctx.lineTo(sx + 12 + ox, sy - 12 + oy);
      ctx.moveTo(sx - 12, sy + 12); ctx.lineTo(sx - 12 + ox, sy + 12 + oy); ctx.moveTo(sx + 12, sy + 12); ctx.lineTo(sx + 12 + ox, sy + 12 + oy);
      ctx.stroke();
      ctx.drawImage(towerImg, sx - 15 + ox, sy - 15 + oy);
    }
    for (i = 0; i < umbrellas.length; i++) {
      var u = umbrellas[i]; sx = u.x - camX; sy = u.y - camY;
      if (sx < -40 || sy < -40 || sx > vw + 40 || sy > vh + 40) continue;
      ox = off(u.x - vcx, 0.3); oy = off(u.y - vcy, 0.3);
      img = umbImgs[u.v]; ctx.drawImage(img, sx - 18 + ox, sy - 18 + oy);
    }
    for (i = 0; i < falafels.length; i++) {
      var fa = falafels[i]; sx = fa.x - camX; sy = fa.y - camY;
      if (sx < -40 || sy < -40 || sx > vw + 40 || sy > vh + 40) continue;
      ox = off(fa.x - vcx, 0.3); oy = off(fa.y - vcy, 0.3);
      ctx.drawImage(falUmb, sx - 16 + ox, sy - 22 + oy);
    }
    var fx = 51.5 * TS, fy = 13.5 * TS; sx = fx - camX; sy = fy - camY;
    if (sx > -60 && sy > -60 && sx < vw + 60 && sy < vh + 60) {
      ox = off(fx - vcx, 0.35); oy = off(fy - vcy, 0.35);
      ctx.drawImage(jetImgs[Math.floor(lastT * 8) & 3], Math.round(sx - 24 + ox), Math.round(sy - 24 + oy));
    }
    for (i = 0; i < trees.length; i++) {
      var tr = trees[i]; sx = tr.x - camX; sy = tr.y - camY;
      if (sx < -48 || sy < -48 || sx > vw + 48 || sy > vh + 48) continue;
      ox = off(tr.x - vcx, 0.5); oy = off(tr.y - vcy, 0.5);
      img = canopies[tr.v]; ctx.drawImage(img, sx - (img.width >> 1) + ox, sy - (img.height >> 1) + oy);
    }
    // buildings (sorted by height ascending)
    var D = WALL_D;
    for (i = 0; i < drawList.length; i++) {
      var b = drawList[i], bw = b.w * TS, bh = b.h * TS;
      sx = b.x * TS - camX; sy = b.y * TS - camY;
      if (sx + bw < -MAXOFF || sy + bh < -MAXOFF || sx > vw + MAXOFF || sy > vh + MAXOFF) continue;
      ox = off(b.x * TS + bw / 2 - vcx, b.ht); oy = off(b.y * TS + bh / 2 - vcy, b.ht);
      if (ox > 0 && b.ht > b.nW + 0.08) wall(ctx, b.tW, ox / D, oy / D, 0, 1, sx, sy);
      else if (ox < 0 && b.ht > b.nE + 0.08) wall(ctx, b.tE, ox / D, oy / D, 0, 1, sx + bw, sy);
      if (oy > 0 && b.ht > b.nN + 0.08) wall(ctx, b.tN, 1, 0, ox / D, oy / D, sx, sy);
      else if (oy < 0 && b.ht > b.nS + 0.08) wall(ctx, b.tS, 1, 0, ox / D, oy / D, sx, sy + bh);
      ctx.drawImage(b.roof, sx + ox, sy + oy);
    }
  };

  // optional debug helper (spot markers); ui.js may call it from the debug overlay
  city.drawDebug = function (ctx, cam) {
    if (!city.inited) return;
    ctx.strokeStyle = '#FF00FF'; ctx.lineWidth = 1; ctx.fillStyle = '#FF00FF';
    for (var i = 0; i < city.spots.length; i++) {
      var s = city.spots[i], x = Math.round(s.x - cam.x), y = Math.round(s.y - cam.y);
      ctx.strokeRect(x - 48, y - 48, 96, 96);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  };
})(globalThis.PE = globalThis.PE || {});
