// HUSH MONEY - npc.js (owner: design-writer)
// Ambient crowd + visual-only vehicles + ambient speech (spec 10, 14.8).
// Headless: init/update/say/reactToPhoto/makePerson touch no DOM. DOM only in drawExtras(ctx, cam).
// Uses at call time: PE.CFG, PE.LINES, PE.logic (moveAndCollide, dirFromVector, tickBubble),
// PE.city (grid, paths, lanes, poi, zoneAt, playerStart), PE.game.actors() (scandal bubbles win).
//
// v0.2: matkot on the POI axis, dog trail/catch-up (no on-screen teleport), CFG caps, closed-loop lanes,
// reusable moveAndCollide out object.
// Mix (AMBIENT_COUNT = 60 people incl. dogs): 10 sitters, 6 vendors, 3 joggers, 2 matkot pairs (4),
// 4 sunbathers, 3 dog walkers + 3 dogs, walkers = the rest (27, ~30% of them phone talkers).
// Every person has brain.npc = true; update() only drives people it spawned.
(function (PE) {
  'use strict';

  var npc = {};
  npc.people = [];
  npc.vehicles = [];

  var nextId = 1;            // never reset: ids stay unique across runs and game.js actors
  var rng = null;
  var time = 0;
  var lastTalkStart = -99;   // global stagger between new ambient bubbles
  var inited = false;

  // cached CFG
  var TILE = 32, SPEED = 55, RAD = 7, TTL = 2.4, MAXB = 3, BUMP_CD = 10;

  var AMB_LOOKS = [];
  for (var li = 0; li < 24; li++) AMB_LOOKS.push('amb' + li);
  var STYLES = { ambient: 1, scandal: 1, player: 1 };
  var CAR_COLORS = ['#C0392B', '#F1C40F', '#ECF0F1', '#2C3E50', '#2980B9', '#7F8C8D', '#D35400', '#8E44AD'];
  var SCOOTER_COLORS = ['#1B1B1B', '#E67E22', '#00A3E0', '#E0E0E0', '#B03A2E', '#16A085'];
  // unit vectors per dir (0=N .. 7=NW)
  var S2 = Math.SQRT1_2;
  var DX = [0, S2, 1, S2, 0, -S2, -1, -S2];
  var DY = [-1, -S2, 0, S2, 1, S2, 0, -S2];

  var BUMP_R = 24, REACT_R = 120, REACT_MAX = 4, DING_R = 56;
  var CRUMBS = 16, CRUMB_DT = 0.25;               // dog-walker breadcrumb trail (4 s)
  var DOG_FAR = 96, DOG_TELEPORT = 300, DOG_CATCHUP = 2.5;

  // scratch buffers (no per-frame allocation)
  var blockX = new Float32Array(16), blockY = new Float32Array(16), blockN = 0, blockS = 0; // blockS = scandal-only count
  var reactIdx = [], reactD = [];
  var mcOut = { x: 0, y: 0 };   // reusable moveAndCollide result (8th arg, spec 14.5 v0.2)
  var curCam = null;              // cam of the current update (dogs only teleport off-screen)

  // ------------------------------------------------------------ helpers
  function N(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function rnd() { return rng ? rng() : 0.5; }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function ri(n) { return n > 0 ? Math.min(n - 1, Math.floor(rnd() * n)) : 0; }
  function pick(arr) { return (arr && arr.length) ? arr[ri(arr.length)] : null; }
  function city() { return PE.city || {}; }
  function grid() { return city().grid || null; }
  function lines(cat) { return (PE.LINES && PE.LINES[cat]) || null; }

  function dirOf(dx, dy) {
    if (PE.logic && PE.logic.dirFromVector) return PE.logic.dirFromVector(dx, dy);
    return (Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) + 8) % 8;
  }

  function tick(o, dt) {
    if (!o.bubble) return;
    if (PE.logic && PE.logic.tickBubble) { PE.logic.tickBubble(o, dt); return; }
    o.bubble.ttl -= dt;
    if (!(o.bubble.ttl > 0)) o.bubble = null;
  }

  function solidTile(g, tx, ty) {
    if (!g || !g.solid) return false;
    if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return true;
    return g.solid[ty * g.w + tx] !== 0;
  }

  // does a person box (half-size RAD) at x,y overlap solid?
  function blocked(x, y) {
    var g = grid();
    if (!g || !g.solid) return false;
    var tx0 = Math.floor((x - RAD) / TILE), tx1 = Math.floor((x + RAD - 1e-4) / TILE);
    var ty0 = Math.floor((y - RAD) / TILE), ty1 = Math.floor((y + RAD - 1e-4) / TILE);
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) if (solidTile(g, tx, ty)) return true;
    return false;
  }

  // nearest free spot (box clear) around x,y; searches tile centers in growing rings
  function findFree(x, y, out) {
    out = out || { x: 0, y: 0 };
    if (!blocked(x, y)) { out.x = x; out.y = y; return out; }
    var ctx = Math.floor(x / TILE), cty = Math.floor(y / TILE);
    for (var r = 0; r <= 8; r++) {
      for (var oy = -r; oy <= r; oy++) {
        for (var ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          var px = (ctx + ox + 0.5) * TILE, py = (cty + oy + 0.5) * TILE;
          if (!blocked(px, py)) { out.x = px; out.y = py; return out; }
        }
      }
    }
    var ps = city().playerStart;
    out.x = ps ? ps.x : x; out.y = ps ? ps.y : y;
    return out;
  }

  function randomFree() {
    var g = grid(), w = g ? g.w : N(PE.CFG && PE.CFG.MAP_W, 96), h = g ? g.h : N(PE.CFG && PE.CFG.MAP_H, 64);
    for (var i = 0; i < 400; i++) {
      var x = (ri(w) + 0.5) * TILE, y = (ri(h) + 0.5) * TILE;
      if (!blocked(x, y)) return { x: x, y: y };
    }
    return findFree(w * TILE / 2, h * TILE / 2);
  }

  function nodes() { var p = city().paths; return (p && p.nodes) || []; }
  function adj() { var p = city().paths; return (p && p.adj) || []; }

  // ------------------------------------------------------------ Person
  function makeBrain(type) {
    return {
      npc: true, type: type, cat: 'walker', speed: SPEED,
      tx: 0, ty: 0, node: -1, prev: -1, offX: 0, offY: 0,
      pause: 0, talkT: 0, bumpCd: 0, stuckT: 0, homeDir: 4,
      loop: null, loopI: 0, owner: null, side: 1,
      pair: null, leader: false, ballU: 0, ballDir: 1, ballFlight: 0.8, rallyPause: 0, hitT: 0,
      crumbX: type === 'dogwalker' ? new Float32Array(CRUMBS) : null,
      crumbY: type === 'dogwalker' ? new Float32Array(CRUMBS) : null,
      cseq: 0, crumbT: 0, ck: 0, last: null
    };
  }

  npc.makePerson = function (x, y, look, kind) {
    return {
      id: nextId++, x: N(x, 0), y: N(y, 0), dir: 4, moving: false, animT: 0,
      look: (typeof look === 'string' && look) ? look : 'amb0', prop: 'none',
      kind: (kind === 'scandal' || kind === 'player') ? kind : 'ambient',
      bubble: null, glow: 0, action: null, brain: {}
    };
  };

  function spawn(x, y, look, type, cat) {
    var f = findFree(x, y);
    var p = npc.makePerson(f.x, f.y, look, 'ambient');
    p.brain = makeBrain(type);
    p.brain.cat = cat;
    p.brain.talkT = rr(1.5, 20);
    p.brain.tx = p.x; p.brain.ty = p.y;
    p.animT = rr(0, 1);
    npc.people.push(p);
    return p;
  }

  // ------------------------------------------------------------ speech
  npc.say = function (person, text, style, ttl, name) {
    if (!person) return;
    var b = { text: String(text == null ? '' : text), ttl: (typeof ttl === 'number' && ttl > 0) ? ttl : TTL, style: STYLES[style] ? style : 'ambient' };
    if (name !== undefined && name !== null && name !== '') b.name = String(name);
    person.bubble = b;
  };

  function countAmbient() {
    var n = 0, i;
    for (i = 0; i < npc.people.length; i++) { var b = npc.people[i].bubble; if (b && b.style === 'ambient') n++; }
    for (i = 0; i < npc.vehicles.length; i++) if (npc.vehicles[i].bubble) n++;
    return n;
  }

  // drop the ambient bubble closest to expiring (excluding `keep`); returns true if one was dropped
  function evictOne(keep) {
    var best = null, bt = Infinity, i, o;
    for (i = 0; i < npc.people.length; i++) {
      o = npc.people[i];
      if (o !== keep && o.bubble && o.bubble.style === 'ambient' && o.bubble.ttl < bt) { bt = o.bubble.ttl; best = o; }
    }
    for (i = 0; i < npc.vehicles.length; i++) {
      o = npc.vehicles[i];
      if (o !== keep && o.bubble && o.bubble.ttl < bt) { bt = o.bubble.ttl; best = o; }
    }
    if (best) { best.bubble = null; return true; }
    return false;
  }

  // collect scandal (and player) bubble anchors: ambient bubbles never overlap them
  function gatherBlockers(player) {
    blockN = 0;
    var G = PE.game;
    if (G && typeof G.actors === 'function') {
      var a = null;
      try { a = G.actors(); } catch (e) { a = null; }
      if (a) for (var i = 0; i < a.length && blockN < 15; i++) {
        var p = a[i];
        if (p && p.bubble) { blockX[blockN] = p.x; blockY[blockN] = p.y; blockN++; }
      }
    }
    blockS = blockN;
    if (player && player.bubble && blockN < 16) { blockX[blockN] = player.x; blockY[blockN] = player.y; blockN++; }
  }

  // scandalOnly: ignore the player bubble (bump lines and existing bubbles only yield to scandals)
  function nearBlocker(x, y, scandalOnly) {
    var m = scandalOnly ? blockS : blockN;
    for (var i = 0; i < m; i++) {
      if (Math.abs(blockX[i] - x) < 170 && Math.abs(blockY[i] - y) < 44) return true;
    }
    return false;
  }

  function visible(x, y, cam) {
    return x >= cam.x + 12 && x <= cam.x + cam.w - 12 && y >= cam.y + 36 && y <= cam.y + cam.h - 6;
  }

  // v1.0.1: never show a line that another live bubble shows, never repeat the speaker's last line.
  // Scan starts at a seeded random index; returns null (stay silent) if every line is taken. No allocation.
  function textInUse(s, self) {
    var i, o, P = npc.people, V = npc.vehicles;
    for (i = 0; i < P.length; i++) { o = P[i]; if (o !== self && o.bubble && o.bubble.text === s) return true; }
    for (i = 0; i < V.length; i++) { o = V[i]; if (o !== self && o.bubble && o.bubble.text === s) return true; }
    return false;
  }

  function lastOf(o) { return o.brain ? o.brain.last : o._last; }

  function pickFresh(arr, self) {
    if (!arr || !arr.length) return null;
    var n = arr.length, s0 = ri(n), last = lastOf(self);
    for (var k = 0; k < n; k++) {
      var c = arr[(s0 + k) % n];
      if (c !== last && !textInUse(c, self)) return c;
    }
    return null;
  }

  // fixed fallback line (category missing): same freshness rules
  function freshOr(arr, self, fallback) {
    if (arr && arr.length) return pickFresh(arr, self);
    return (fallback !== lastOf(self) && !textInUse(fallback, self)) ? fallback : null;
  }

  function speak(o, s, ttl) {
    npc.say(o, s, 'ambient', ttl);
    if (o.brain) o.brain.last = s; else o._last = s;
  }

  function lineFor(p) {
    var b = p.brain, cat = b.cat;
    if (b.type === 'walker' && city().zoneAt && rnd() < 0.5) {
      var z = city().zoneAt(p.x, p.y);
      if (z === 'beach' || z === 'promenade') cat = 'beach';
      else if (z === 'cafe') cat = 'cafe';
    }
    return pickFresh(lines(cat) || lines('walker'), p);
  }

  // ------------------------------------------------------------ brains
  // writes progress ratio (actual / intended; 1 if arrived) to PROG[0] (avoids boxing a returned double)
  var PROG = new Float64Array(1);
  function moveToward(p, tx, ty, speed, dt) {
    var dx = tx - p.x, dy = ty - p.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.5) { p.moving = false; PROG[0] = 1; return; }
    var step = Math.min(d, speed * dt), mx = dx / d * step, my = dy / d * step;
    var nx, ny, g = grid();
    if (g && PE.logic && PE.logic.moveAndCollide) {
      var r = PE.logic.moveAndCollide(g, p.x, p.y, mx, my, RAD, TILE, mcOut) || mcOut;
      nx = r.x; ny = r.y;
    } else { nx = p.x + mx; ny = p.y + my; }
    var ax = nx - p.x, ay = ny - p.y;
    p.x = nx; p.y = ny;
    p.dir = dirOf(mx, my);
    p.moving = true;
    p.animT += dt * speed / SPEED;
    PROG[0] = step > 0 ? Math.sqrt(ax * ax + ay * ay) / step : 1;
  }

  function setNodeTarget(b, idx) {
    var n = nodes()[idx];
    if (!n) return;
    b.prev = b.node; b.node = idx;
    b.tx = n.x + b.offX; b.ty = n.y + b.offY;
  }

  function nextNode(b) {
    var a = adj()[b.node];
    if (!a || !a.length) {
      var ns = nodes();
      if (ns.length) setNodeTarget(b, ri(ns.length));
      return;
    }
    var choice = a[ri(a.length)];
    if (a.length > 1 && choice === b.prev) choice = a[ri(a.length)];
    if (a.length > 1 && choice === b.prev) choice = a[ri(a.length)];
    setNodeTarget(b, choice);
  }

  function wanderTarget(p, b) {
    for (var i = 0; i < 8; i++) {
      var x = p.x + rr(-96, 96), y = p.y + rr(-96, 96);
      if (!blocked(x, y)) { b.tx = x; b.ty = y; return; }
    }
    b.tx = p.x; b.ty = p.y;
  }

  function brainWalker(p, b, dt) {
    if (b.pause > 0) {
      b.pause -= dt; p.moving = false;
      if (b.type === 'phone' && rnd() < dt * 0.5) p.dir = (p.dir + (rnd() < 0.5 ? 1 : 7)) % 8; // pacing on the phone
      return;
    }
    var dx = b.tx - p.x, dy = b.ty - p.y;
    if (dx * dx + dy * dy < 16) {
      if (b.node >= 0) nextNode(b); else wanderTarget(p, b);
      var pc = b.type === 'phone' ? 0.35 : 0.1;
      if (rnd() < pc) { b.pause = b.type === 'phone' ? rr(2, 5) : rr(1, 3.5); p.moving = false; }
      return;
    }
    moveToward(p, b.tx, b.ty, b.speed, dt);
    if (PROG[0] < 0.3) {
      b.stuckT += dt;
      if (b.stuckT > 0.6) {
        b.stuckT = 0;
        if (b.node >= 0 && b.prev >= 0) setNodeTarget(b, b.prev);
        else if (b.node >= 0) nextNode(b);
        else wanderTarget(p, b);
        b.offX = rr(-3, 3); b.offY = rr(-3, 3);
      }
    } else if (b.stuckT > 0) b.stuckT = Math.max(0, b.stuckT - dt);
  }

  function onScreen(x, y) {
    var c = curCam;
    return !!c && x >= c.x - 32 && x <= c.x + c.w + 32 && y >= c.y - 32 && y <= c.y + c.h + 32;
  }

  // owner side: drop a breadcrumb every CRUMB_DT while walking (ring buffer, no allocation)
  function recordCrumb(p, b, dt) {
    if (!b.crumbX) return;
    b.crumbT -= dt;
    if (b.crumbT > 0 || !p.moving) return;
    b.crumbT = CRUMB_DT;
    var i = b.cseq % CRUMBS;
    b.crumbX[i] = p.x; b.crumbY[i] = p.y; b.cseq++;
  }

  // Dog: heel behind the owner; when it falls behind (> 40 px) it runs the owner's breadcrumb trail
  // (walkable by construction); > 96 px it sprints at 2.5x; teleports only if > 300 px AND both off-screen.
  function brainDog(p, b, dt) {
    var o = b.owner, ob = o && o.brain;
    if (!o || !ob) { p.moving = false; return; }
    var odx = o.x - p.x, ody = o.y - p.y, od2 = odx * odx + ody * ody;
    if (od2 > DOG_TELEPORT * DOG_TELEPORT && !onScreen(p.x, p.y) && !onScreen(o.x, o.y)) {
      p.x = o.x; p.y = o.y; p.moving = false; b.ck = ob.cseq; b.stuckT = 0; return;
    }
    var tx, ty, trail = false;
    if (od2 > 40 * 40 && ob.crumbX && ob.cseq > 0) {
      var lo = ob.cseq - CRUMBS; if (lo < 0) lo = 0;
      if (b.ck < lo) b.ck = lo;
      if (b.ck < ob.cseq) {
        var ci = b.ck % CRUMBS;
        tx = ob.crumbX[ci]; ty = ob.crumbY[ci]; trail = true;
        var cx = tx - p.x, cy = ty - p.y;
        if (cx * cx + cy * cy < 100) { b.ck++; b.stuckT = 0; }
      }
    } else b.ck = ob.cseq;
    if (!trail) {
      var hx = DX[o.dir] || 0, hy = DY[o.dir] || 0;
      tx = o.x - hx * 15 - hy * 7 * b.side; ty = o.y - hy * 15 + hx * 7 * b.side;
    }
    var dx = tx - p.x, dy = ty - p.y, d2 = dx * dx + dy * dy;
    if (!trail && d2 < 9) {
      p.moving = false;
      if (!o.moving && rnd() < dt * 0.7) b.side = -b.side; // sniff around while the owner stands
      return;
    }
    var sp = od2 > DOG_FAR * DOG_FAR ? SPEED * DOG_CATCHUP
      : trail ? ob.speed * 1.7 + 10 : Math.min(Math.sqrt(d2) * 4, ob.speed * 1.7 + 10);
    moveToward(p, tx, ty, sp, dt);
    if (PROG[0] < 0.3) {
      b.stuckT += dt;
      if (b.stuckT > 0.8) { b.stuckT = 0; if (trail) b.ck++; else b.side = -b.side; }
    } else b.stuckT = 0;
  }

  function brainJogger(p, b, dt) {
    var L = b.loop;
    if (!L || !L.length) { brainWalker(p, b, dt); return; }
    var t = L[b.loopI];
    var dx = t[0] - p.x, dy = t[1] - p.y;
    if (dx * dx + dy * dy < 36) { b.loopI = (b.loopI + 1) % L.length; return; }
    moveToward(p, t[0], t[1], b.speed, dt);
    if (PROG[0] < 0.3) {
      b.stuckT += dt;
      if (b.stuckT > 0.6) { b.stuckT = 0; b.loopI = (b.loopI + 1) % L.length; }
    } else b.stuckT = 0;
  }

  function brainMatkot(p, b, dt) {
    var o = b.pair;
    if (o) p.dir = dirOf(o.x - p.x, o.y - p.y);
    if (b.hitT > 0) b.hitT -= dt;
    p.moving = b.hitT > 0;
    if (p.moving) p.animT += dt;
    if (!b.leader || !o) return;
    if (b.rallyPause > 0) { b.rallyPause -= dt; return; }
    b.ballU += dt / b.ballFlight;
    if (b.ballU >= 1) {
      var receiver = b.ballDir > 0 ? o : p;
      if (rnd() < 0.05) { // dropped it
        b.rallyPause = rr(1.5, 3);
        b.ballU = 1;
        return;
      }
      b.ballU = 0;
      b.ballDir = -b.ballDir;
      b.ballFlight = rr(0.55, 0.9);
      receiver.brain.hitT = 0.18;
    }
  }

  function brainStill(p, b, dt) {
    p.moving = false;
    if (b.type === 'vendor' && rnd() < dt * 0.15) {
      var r = rnd();
      p.dir = r < 0.6 ? b.homeDir : (b.homeDir + (r < 0.8 ? 1 : 7)) % 8;
    }
  }

  // ------------------------------------------------------------ vehicles
  // segment lengths; a closed lane (loop:true, first point not repeated) gets the closing segment too
  function laneLens(lane) {
    var pts = lane.pts || [], out = [], n = pts.length, segs = lane.loop ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      out.push(Math.sqrt(dx * dx + dy * dy));
    }
    return out;
  }

  function placeOnLane(v, laneIdx, frac) {
    var lane = v._lanes[laneIdx], lens = v._lens[laneIdx];
    v._lane = laneIdx; v._seg = 0; v._segT = 0;
    var total = 0, i;
    for (i = 0; i < lens.length; i++) total += lens[i];
    var want = total * frac;
    for (i = 0; i < lens.length; i++) {
      if (want <= lens[i] || i === lens.length - 1) { v._seg = i; v._segT = Math.min(want, lens[i]); break; }
      want -= lens[i];
    }
    vehiclePose(v, lane, lens);
  }

  function vehiclePose(v, lane, lens) {
    var a = lane.pts[v._seg], b = lane.pts[(v._seg + 1) % lane.pts.length];
    if (!a || !b) { if (a) { v.x = a[0]; v.y = a[1]; } return; }
    var L = lens[v._seg], u = L > 0 ? v._segT / L : 0;
    v.x = a[0] + (b[0] - a[0]) * u;
    v.y = a[1] + (b[1] - a[1]) * u;
    if (L > 0) v.dir = dirOf(b[0] - a[0], b[1] - a[1]);
  }

  function updateVehicle(v, dt) {
    if (!v._lanes.length) return;
    var lane = v._lanes[v._lane], lens = v._lens[v._lane];
    var dist = v._speed * dt, guard = 0;
    while (dist > 0 && guard++ < 16) {
      var rem = (lens[v._seg] || 0) - v._segT;
      if (dist < rem) { v._segT += dist; dist = 0; break; }
      dist -= Math.max(0, rem);
      v._seg++; v._segT = 0;
      if (v._seg >= lens.length) {
        if (lane.loop) { v._seg = 0; continue; } // closed loop: keep driving around
        // open lane end: respawn at the start of a random lane of this type
        v._lane = ri(v._lanes.length);
        lane = v._lanes[v._lane]; lens = v._lens[v._lane];
        v._seg = 0; v._segT = 0; dist = 0;
        v._speed = v.type === 'car' ? rr(85, 125) : rr(60, 90);
      }
    }
    vehiclePose(v, lane, lens);
  }

  function makeVehicles(type, count, colors) {
    var all = city().lanes || [], want = type === 'car' ? 'road' : 'bike';
    var ls = [], i;
    for (i = 0; i < all.length; i++) if (all[i] && all[i].type === want && all[i].pts && all[i].pts.length >= 2) ls.push(all[i]);
    if (!ls.length && type === 'scooter') for (i = 0; i < all.length; i++) if (all[i] && all[i].pts && all[i].pts.length >= 2) ls.push(all[i]);
    if (!ls.length) return;
    var lens = [];
    for (i = 0; i < ls.length; i++) lens.push(laneLens(ls[i]));
    for (i = 0; i < count; i++) {
      var v = {
        x: 0, y: 0, dir: 2, type: type, color: colors[i % colors.length],
        bubble: null, _lanes: ls, _lens: lens, _lane: 0, _seg: 0, _segT: 0,
        _speed: type === 'car' ? rr(85, 125) : rr(60, 90), _talkT: rr(4, 20), _dingCd: 0, _last: null
      };
      placeOnLane(v, i % ls.length, rr(0, 1));
      npc.vehicles.push(v);
    }
  }

  // ------------------------------------------------------------ init
  function poisOf(type) {
    var all = city().poi || [], out = [];
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].type === type) out.push(all[i]);
    return out;
  }

  function nodePos(zones) {
    var ns = nodes();
    if (!ns.length) return randomFree();
    if (zones) {
      var cand = [];
      for (var i = 0; i < ns.length; i++) if (zones.indexOf(ns[i].zone) >= 0) cand.push(i);
      if (cand.length) { var k = pick(cand); return { x: ns[k].x, y: ns[k].y, node: k }; }
    }
    var j = ri(ns.length);
    return { x: ns[j].x, y: ns[j].y, node: j };
  }

  function spawnWalker(type, cat, zones) {
    var at = nodePos(zones);
    var p = spawn(at.x, at.y, pick(AMB_LOOKS), type, cat);
    var b = p.brain;
    b.offX = rr(-5, 5); b.offY = rr(-5, 5);
    var sm = type === 'phone' ? 0.7 : type === 'dogwalker' ? 0.85 : 1;
    b.speed = SPEED * sm * rr(0.85, 1.15);
    if (typeof at.node === 'number') { b.node = at.node; nextNode(b); }
    else wanderTarget(p, b);
    if (type === 'phone') p.prop = 'phone';
    if (rnd() < 0.3) b.pause = rr(0, 3);
    return p;
  }

  function joggerLoop() {
    var ns = nodes(), xs = [], minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < ns.length; i++) if (ns[i].zone === 'promenade') { xs.push(ns[i].x); minY = Math.min(minY, ns[i].y); maxY = Math.max(maxY, ns[i].y); }
    var cx, H = N(PE.CFG && PE.CFG.MAP_H, 64) * TILE;
    if (xs.length) { cx = 0; for (i = 0; i < xs.length; i++) cx += xs[i]; cx /= xs.length; }
    else { cx = 14 * TILE; minY = 2 * TILE; maxY = H - 2 * TILE; }
    if (!(maxY - minY > 4 * TILE)) { minY = 2 * TILE; maxY = H - 2 * TILE; }
    var xa = findFree(cx - 10, minY + 16), xb = findFree(cx + 10, maxY - 16);
    var xc = findFree(cx + 10, minY + 16), xd = findFree(cx - 10, maxY - 16);
    return [[xa.x, xa.y], [xd.x, xd.y], [xb.x, xb.y], [xc.x, xc.y]];
  }

  npc.init = function (r) {
    rng = (typeof r === 'function') ? r : (PE.logic && PE.logic.mulberry32 ? PE.logic.mulberry32(1) : null);
    var C = PE.CFG || {};
    TILE = N(C.TILE, 32); SPEED = N(C.NPC_SPEED, 55); RAD = N(C.PERSON_RADIUS, 7);
    TTL = N(C.BUBBLE_TTL, 2.4); MAXB = N(C.MAX_AMBIENT_BUBBLES, 3); BUMP_CD = N(C.BUMP_COOLDOWN, 10);
    var COUNT = N(C.AMBIENT_COUNT, 60);
    if (PE.city && !PE.city.grid && typeof PE.city.init === 'function') PE.city.init();
    npc.people = []; npc.vehicles = [];
    time = 0; lastTalkStart = -99;
    var i, q, p, start = npc.people;

    // sitters (10): cafe tables first, then benches, alternating while both last
    var cafes = poisOf('cafe_table'), benches = poisOf('bench'), ci = 0, bi = 0;
    for (i = 0; i < 10; i++) {
      q = ((i % 2 === 0 && ci < cafes.length) || bi >= benches.length) ? cafes[ci++] : benches[bi++];
      if (q) {
        p = spawn(q.x, q.y, pick(AMB_LOOKS), 'sitter', 'cafe');
        p.dir = N(q.dir, 4); p.brain.homeDir = p.dir;
        if (q.type === 'cafe_table') p.prop = 'coffee';
      } else { var at = nodePos(['cafe', 'boulevard']); spawn(at.x, at.y, pick(AMB_LOOKS), 'sitter', 'cafe'); }
    }

    // vendors (6): falafel x2 (chef), kiosk x2, market x2 (vendor)
    var vdefs = [['falafel', 'chef', 'vendor_falafel', ['market', 'alley']], ['kiosk', 'vendor', 'vendor_kiosk', ['boulevard', 'promenade']], ['stall', 'vendor', 'vendor_market', ['market']]];
    for (i = 0; i < vdefs.length; i++) {
      var list = poisOf(vdefs[i][0]);
      for (var k = 0; k < 2; k++) {
        q = list[k];
        var pos = q || nodePos(vdefs[i][3]);
        p = spawn(pos.x, pos.y, vdefs[i][1], 'vendor', vdefs[i][2]);
        p.dir = q ? N(q.dir, 4) : 4; p.brain.homeDir = p.dir;
        p.brain.talkT = rr(1, 10);
      }
    }

    // joggers (3): promenade loop at ~1.8x
    var loop = joggerLoop();
    for (i = 0; i < 3; i++) {
      var li2 = ri(loop.length), ya = loop[0][1], yb = loop[1][1];
      p = spawn(loop[li2][0], rr(Math.min(ya, yb), Math.max(ya, yb)), 'jogger', 'jogger', 'jogger');
      p.brain.loop = loop; p.brain.loopI = (li2 + 1) % loop.length;
      p.brain.speed = SPEED * 1.8 * rr(0.95, 1.05);
    }

    // matkot pairs (2): poi = pair center, dir = axis (0/4 N-S, 2/6 E-W); players +-36 px along it
    var mk = poisOf('matkot');
    for (i = 0; i < 2; i++) {
      var c = mk[i] || nodePos(['beach']), md = mk[i] ? (N(mk[i].dir, 2) | 0) & 7 : 2;
      var ux = DX[md], uy = DY[md];
      var ax = c.x - ux * 36, ay = c.y - uy * 36, bx = c.x + ux * 36, by = c.y + uy * 36;
      var A = spawn(ax, ay, pick(AMB_LOOKS), 'matkot', 'matkot');
      var B = spawn(bx, by, pick(AMB_LOOKS), 'matkot', 'matkot');
      A.prop = 'paddle'; B.prop = 'paddle';
      A.brain.pair = B; B.brain.pair = A;
      A.brain.leader = true; A.brain.ballU = rnd(); A.brain.ballFlight = rr(0.55, 0.9);
      A.dir = dirOf(B.x - A.x, B.y - A.y); B.dir = dirOf(A.x - B.x, A.y - B.y);
    }

    // sunbathers (4)
    var sb = poisOf('sunbathe'), um = poisOf('umbrella');
    for (i = 0; i < 4; i++) {
      q = sb[i];
      var sx, sy, sd = 4;
      if (q) { sx = q.x; sy = q.y; sd = N(q.dir, 4); }
      else if (um[i]) { sx = um[i].x + 14; sy = um[i].y + 10; }
      else { var bp = nodePos(['beach']); sx = bp.x + rr(-40, 40); sy = bp.y + rr(-40, 40); }
      p = spawn(sx, sy, 'sunbather', 'sunbather', 'beach');
      p.dir = sd; p.brain.homeDir = sd;
    }

    // dog walkers (3) + dogs (3)
    for (i = 0; i < 3; i++) {
      var o = spawnWalker('dogwalker', 'dogwalker', ['park', 'promenade', 'boulevard']);
      var dg = spawn(o.x, o.y, 'dog', 'dog', 'none');
      dg.brain.owner = o; dg.brain.side = rnd() < 0.5 ? -1 : 1;
      dg.brain.talkT = Infinity;
    }

    // walkers: the rest (~30% phone talkers)
    var rest = Math.max(0, COUNT - start.length);
    for (i = 0; i < rest; i++) {
      if (i % 10 < 3) spawnWalker('phone', 'phone', null);
      else spawnWalker('walker', 'walker', null);
    }

    // vehicles (visual only)
    makeVehicles('scooter', 6, SCOOTER_COLORS);
    makeVehicles('car', 6, CAR_COLORS);
    inited = true;
  };

  // ------------------------------------------------------------ update
  var tmpCam = { x: 0, y: 0, w: 960, h: 540 };

  npc.update = function (dt, player, cam) {
    if (!inited) return;
    dt = N(dt, 1 / 60);
    time += dt;
    if (!cam) {
      tmpCam.x = (player ? player.x : 0) - 480; tmpCam.y = (player ? player.y : 0) - 270;
      cam = tmpCam;
    }
    curCam = cam;
    gatherBlockers(player);
    var people = npc.people, n = people.length, i, p, b;
    var amb = 0;
    for (i = 0; i < n; i++) {
      p = people[i];
      if (!p.brain || !p.brain.npc) continue;
      tick(p, dt);
      if (p.bubble && p.bubble.style === 'ambient') {
        if (blockS && nearBlocker(p.x, p.y, true)) p.bubble = null; // scandal bubbles win
        else amb++;
      }
    }
    for (i = 0; i < npc.vehicles.length; i++) { tick(npc.vehicles[i], dt); if (npc.vehicles[i].bubble) amb++; }

    var px = player ? player.x : -1e9, py = player ? player.y : -1e9;
    for (i = 0; i < n; i++) {
      p = people[i]; b = p.brain;
      if (!b || !b.npc) continue;
      switch (b.type) {
        case 'walker': case 'phone': brainWalker(p, b, dt); break;
        case 'dogwalker': brainWalker(p, b, dt); recordCrumb(p, b, dt); break;
        case 'jogger': brainJogger(p, b, dt); break;
        case 'dog': brainDog(p, b, dt); break;
        case 'matkot': brainMatkot(p, b, dt); break;
        default: brainStill(p, b, dt);
      }
      if (b.type === 'dog') continue;

      // bump line (player within 24 px, CFG.BUMP_COOLDOWN per NPC)
      if (b.bumpCd > 0) b.bumpCd -= dt;
      var dx = p.x - px, dy = p.y - py;
      if (b.bumpCd <= 0 && dx * dx + dy * dy < BUMP_R * BUMP_R) {
        b.bumpCd = BUMP_CD;
        if (!nearBlocker(p.x, p.y, true)) {
          var had = p.bubble && p.bubble.style === 'ambient';
          if (!had && amb >= MAXB && evictOne(p)) amb--;
          var bs = (had || amb < MAXB) ? freshOr(lines('bump'), p, 'Hey!') : null;
          if (bs) {
            speak(p, bs, TTL);
            if (!had) amb++;
            b.talkT = rr(8, 20);
          }
        }
      }

      // ambient talk: visible people only, every 8-20 s, max MAXB on screen
      b.talkT -= dt;
      if (b.talkT <= 0) {
        if (!p.bubble && amb < MAXB && time - lastTalkStart >= 0.6 && visible(p.x, p.y, cam) && !nearBlocker(p.x, p.y)) {
          var s = lineFor(p);
          if (s) { speak(p, s, TTL); amb++; lastTalkStart = time; }
          b.talkT = rr(8, 20);
        } else b.talkT = rr(0.5, 2);
      }
    }

    // vehicles
    for (i = 0; i < npc.vehicles.length; i++) {
      var v = npc.vehicles[i];
      updateVehicle(v, dt);
      if (v.type !== 'scooter') continue;
      if (v._dingCd > 0) v._dingCd -= dt;
      var vx = v.x - px, vy = v.y - py;
      if (v._dingCd <= 0 && vx * vx + vy * vy < DING_R * DING_R) {
        v._dingCd = 6;
        if (!v.bubble && amb >= MAXB && evictOne(v)) amb--;
        if (v.bubble || amb < MAXB) {
          var ds = (v._last !== 'Ding ding!' && !textInUse('Ding ding!', v)) ? 'Ding ding!' : pickFresh(lines('scooter'), v);
          if (ds) { if (!v.bubble) amb++; speak(v, ds, 1.6); }
        }
        continue;
      }
      v._talkT -= dt;
      if (v._talkT <= 0) {
        if (!v.bubble && amb < MAXB && time - lastTalkStart >= 0.6 && visible(v.x, v.y, cam) && !nearBlocker(v.x, v.y)) {
          var vs = freshOr(lines('scooter'), v, 'Ding ding!');
          if (vs) { speak(v, vs, TTL); amb++; lastTalkStart = time; }
          v._talkT = rr(8, 20);
        } else v._talkT = rr(0.5, 2);
      }
    }
  };

  // ------------------------------------------------------------ photo reaction
  npc.reactToPhoto = function (x, y) {
    if (!inited) return;
    reactIdx.length = 0; reactD.length = 0;
    var people = npc.people, i, j, p;
    for (i = 0; i < people.length; i++) {
      p = people[i];
      if (!p.brain || !p.brain.npc || p.brain.type === 'dog' || p.kind !== 'ambient') continue;
      var dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
      if (d2 > REACT_R * REACT_R) continue;
      // insertion by distance; the closest k react
      j = reactD.length;
      reactD.push(d2); reactIdx.push(i);
      while (j > 0 && reactD[j - 1] > d2) { reactD[j] = reactD[j - 1]; reactIdx[j] = reactIdx[j - 1]; reactD[j - 1] = d2; reactIdx[j - 1] = i; j--; }
    }
    var k = Math.min(REACT_MAX, MAXB, reactIdx.length); // spec 6 says max 4; the cam cap (3) wins
    if (!k) return;
    // make room: drop other ambient bubbles beyond the cap
    var total = countAmbient(), reacting = 0;
    for (i = 0; i < k; i++) { p = people[reactIdx[i]]; if (!(p.bubble && p.bubble.style === 'ambient')) reacting++; }
    var guard = 0;
    while (total + reacting > MAXB && guard++ < 32) {
      var best = null, bt = Infinity;
      for (i = 0; i < people.length; i++) {
        p = people[i];
        if (!p.bubble || p.bubble.style !== 'ambient') continue;
        var isR = false;
        for (j = 0; j < k; j++) if (reactIdx[j] === i) { isR = true; break; }
        if (!isR && p.bubble.ttl < bt) { bt = p.bubble.ttl; best = p; }
      }
      for (i = 0; i < npc.vehicles.length; i++) if (npc.vehicles[i].bubble && npc.vehicles[i].bubble.ttl < bt) { bt = npc.vehicles[i].bubble.ttl; best = npc.vehicles[i]; }
      if (!best) break;
      best.bubble = null; total--;
    }
    var ls = lines('photographed');
    for (i = 0; i < k; i++) {
      p = people[reactIdx[i]];
      var ps = freshOr(ls, p, 'Did you just photograph me?!');
      if (ps) speak(p, ps, TTL);
      if (p.brain.type !== 'matkot') p.dir = dirOf(x - p.x, y - p.y);
      if (p.brain.type === 'walker' || p.brain.type === 'phone' || p.brain.type === 'dogwalker') { p.brain.pause = Math.max(p.brain.pause, 1.5); p.moving = false; }
      p.brain.talkT = rr(8, 20);
    }
  };

  // ------------------------------------------------------------ DOM: extras
  npc.drawExtras = function (ctx, cam) {
    if (!ctx || !cam || !inited) return;
    var art = PE.art, canIcon = art && typeof art.drawIcon === 'function';
    var people = npc.people;
    for (var i = 0; i < people.length; i++) {
      var A = people[i], b = A.brain;
      if (!b || b.type !== 'matkot' || !b.leader || !b.pair) continue;
      var B = b.pair, from = b.ballDir > 0 ? A : B, to = b.ballDir > 0 ? B : A;
      var u = b.ballU > 1 ? 1 : b.ballU, gx, gy, h;
      if (b.rallyPause > 0) { gx = to.x + 6; gy = to.y + 2; h = 0; } // dropped in the sand
      else { gx = from.x + (to.x - from.x) * u; gy = from.y + (to.y - from.y) * u; h = 12 + 10 * Math.sin(Math.PI * u); }
      var sx = Math.round(gx - cam.x), sy = Math.round(gy - cam.y);
      if (sx < -64 || sy < -64 || sx > cam.w + 64 || sy > cam.h + 64) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(sx - 2, sy - 1, 4, 2);
      var by = Math.round(sy - h);
      if (canIcon) art.drawIcon(ctx, 'ball', sx, by, 0.6);
      else { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(sx - 2, by - 2, 4, 4); }
    }
  };

  PE.npc = npc;
})(globalThis.PE = globalThis.PE || {});
