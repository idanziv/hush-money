// HUSH MONEY - game.js (owner: eng-lead)
// Run state, player, scandal manager, photo scoring (spec 3-7, 14.9). Headless-safe: DOM only via ctx in drawUnder.
(function (PE) {
  'use strict';

  var G = {};
  var rng = null;          // game rng (deck, spot choice, quips)
  var deck = [];
  var lastSpotId = null;
  var leaving = [];        // actors of previous scandals still walking off
  var actorList = [];      // reused output of actors()
  var defaultCam = { x: 0, y: 0, w: 960, h: 540 };
  var mv = { x: 0, y: 0 };  // reused moveAndCollide output
  var LEAN_WALK_MIN_SPEED = 6;   // px/s: below this the eased lean-in reads as standing (no walk cycle)
  var LEAN_FRACTION = 0.6;   // lean-in travels over the first 60% of ACTION_LEAD, then holds for the RISE pop
  var input0 = { up: false, down: false, left: false, right: false, sprint: false, photo: false };

  function C() { return PE.CFG || {}; }
  function N(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function L() { return PE.logic; }

  function pickLine(cat) {
    var lines = PE.LINES && PE.LINES[cat];
    if (!lines || !lines.length) return null;
    return lines[Math.floor(rng() * lines.length) % lines.length];
  }

  function say(p, text, style, name) {
    if (!p || !text) return;
    var ttl = N(C().BUBBLE_TTL, 2.4);
    if (PE.npc && typeof PE.npc.say === 'function') {
      try { PE.npc.say(p, text, style, ttl, name); return; } catch (e) { /* fall through */ }
    }
    p.bubble = { text: String(text), ttl: ttl, style: style, name: name };
  }

  function makePerson(x, y, look, kind) {
    var p = null;
    if (PE.npc && typeof PE.npc.makePerson === 'function') p = PE.npc.makePerson(x, y, look, kind);
    if (!p) p = {};
    p.x = x; p.y = y; p.look = look; p.kind = kind;
    if (p.id === undefined) p.id = kind + '_' + Math.floor(rng() * 1e9);
    if (typeof p.dir !== 'number') p.dir = 4;
    p.moving = false; p.animT = p.animT || 0;
    if (!p.prop) p.prop = 'none';
    if (p.bubble === undefined) p.bubble = null;
    p.glow = 0; p.action = null;
    if (!p.brain) p.brain = {};
    return p;
  }

  function camFor(player) {
    if (PE.cam) return PE.cam;
    var cfg = C(), T = N(cfg.TILE, 32);
    var mw = N(cfg.MAP_W, 96) * T, mh = N(cfg.MAP_H, 64) * T;
    defaultCam.w = N(cfg.VIEW_W, 960); defaultCam.h = N(cfg.VIEW_H, 540);
    defaultCam.x = Math.max(0, Math.min(mw - defaultCam.w, Math.round(player.x - defaultCam.w / 2)));
    defaultCam.y = Math.max(0, Math.min(mh - defaultCam.h, Math.round(player.y - defaultCam.h / 2)));
    return defaultCam;
  }

  // ---------------------------------------------------------------- run
  G.newRun = function (seed) {
    seed = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : 1;
    var logic = L();
    rng = logic.mulberry32(seed);
    if (PE.city && !PE.city.grid && typeof PE.city.init === 'function') PE.city.init();
    if (PE.npc && typeof PE.npc.init === 'function') PE.npc.init(logic.mulberry32((seed ^ 0x9E3779B9) >>> 0));
    var cfg = C(), T = N(cfg.TILE, 32);
    var starts = PE.city && PE.city.playerStarts, start = null;
    if (starts && starts.length) start = starts[Math.floor(rng() * starts.length) % starts.length];
    if (!start) start = (PE.city && PE.city.playerStart) || { x: 24 * T, y: 32 * T };
    var player = makePerson(start.x, start.y, 'detective', 'player');
    player.id = 'player'; player.dir = 2;
    deck = logic.shuffle(PE.SCANDALS || [], rng);
    lastSpotId = null; leaving.length = 0;
    G.state = {
      seed: seed, time: 0, score: 0, caseNo: 0, total: N(cfg.SCANDALS_PER_RUN, 6), player: player,
      phase: 'waiting', timer: N(cfg.FIRST_DELAY, 2), scandal: null, results: [], photoCooldown: 0,
      events: [], over: false
    };
    G.frameEvents = [];
    return G.state;
  };

  // ---------------------------------------------------------------- spawn
  function chooseCase() {
    var logic = L(), cfg = C(), s = G.state, city = PE.city || {};
    var spots = city.spots || [], grid = city.grid;
    var cam = camFor(s.player), defs = PE.SCANDALS || [];
    if (!defs.length || !grid || !spots.length) return null;
    if (!deck.length) deck = logic.shuffle(defs, rng);
    var left = s.total - s.caseNo - 1;               // cases still to come after this one
    var full = (1 << deck.length) - 1;
    planMemo = Object.create(null);
    // v1.2 perf: one BFS from the player tile for every def (was one per def inside pickSpawnSpot)
    var Tt = N(cfg.TILE, 32), dists = logic.bfsTiles(grid, Math.floor(s.player.x / Tt), Math.floor(s.player.y / Tt), Math.max(N(cfg.SPAWN_MAX_TILES, 34), N(cfg.RELAX_MAX_TILES, 40)));
    // Pass 1 - spec 7 exactly (first strict, else first relaxed), but skip a pick that would leave the
    // remaining deck unable to fill the remaining cases (planner assumes the player ends near each spot).
    var firstAny = null, firstRel = null;
    for (var i = 0; i < deck.length; i++) {
      var r = logic.pickSpawnSpot(grid, spots, s.player.x, s.player.y, cam, deck[i].kinds, cfg, rng, lastSpotId, dists);
      if (!r) continue;
      if (!firstAny) firstAny = { idx: i, pick: r };
      if (!feasible(spots.indexOf(r.spot), full & ~(1 << i), left)) continue;
      if (r.relax === 0) return { idx: i, pick: r };
      if (!firstRel) firstRel = { idx: i, pick: r };
    }
    if (firstRel) return firstRel;
    // Pass 2 - the random spot pickSpawnSpot chose dead-ends: search every legal (def, spot) of the deck
    // with the same relax levels, keeping only plannable ones.
    var planned = plannedPick(grid, spots, cam, cfg, full, left, dists);
    if (planned) return planned;
    // Pass 3 - no plan exists: spec 7 pick anyway (kinds and distance always respected).
    return firstAny;   // null -> caller retries in 0.5 s
  }

  // ---- deck planner (pure data, cheap: <= spots BFS cached per grid, memo on spot x deck mask)
  var bfsCache = null, bfsGrid = null, planMemo = null;
  function spotDist(grid, spots, si) {
    if (bfsGrid !== grid) { bfsGrid = grid; bfsCache = []; }
    if (!bfsCache[si]) {
      var T = N(C().TILE, 32), sp = spots[si];
      bfsCache[si] = L().bfsTiles(grid, Math.floor(sp.x / T), Math.floor(sp.y / T), N(C().RELAX_MAX_TILES, 40));
    }
    return bfsCache[si];
  }
  // v1.2 perf: warm the per-spot BFS cache one spot per step while waiting / resolving (pure, no rng),
  // so the spawn frame does not pay for it. Same values as building them lazily at spawn.
  var warmIdx = 0;
  function warmPlanner() {
    var city = PE.city;
    if (!city || !city.grid || !city.spots) return;
    if (bfsGrid !== city.grid) { bfsGrid = city.grid; bfsCache = []; warmIdx = 0; }
    while (warmIdx < city.spots.length && bfsCache[warmIdx]) warmIdx++;
    if (warmIdx < city.spots.length) spotDist(city.grid, city.spots, warmIdx);
  }
  function tileVal(d, grid, sp) {
    var T = N(C().TILE, 32);
    return d[Math.floor(sp.y / T) * grid.w + Math.floor(sp.x / T)];
  }
  // Can `k` more cases be drawn from deck `mask` if the player stands at spots[si]?
  function feasible(si, mask, k) {
    if (k <= 0) return true;
    if (si < 0 || !mask) return false;
    var key = si + ":" + mask;
    if (planMemo[key] !== undefined) return planMemo[key];
    planMemo[key] = false;
    var cfg = C(), city = PE.city, grid = city.grid, spots = city.spots;
    var lo = N(cfg.RELAX_MIN_TILES, 8), hi = N(cfg.RELAX_MAX_TILES, 40) - 3;   // 3-tile margin: player stands near, not on, the spot
    var d = spotDist(grid, spots, si);
    for (var j = 0; j < deck.length; j++) {
      if (!(mask & (1 << j))) continue;
      var kinds = deck[j].kinds || [];
      for (var q = 0; q < spots.length; q++) {
        if (q === si || kinds.indexOf(spots[q].kind) < 0) continue;
        var v = tileVal(d, grid, spots[q]);
        if (v >= lo && v <= hi && feasible(q, mask & ~(1 << j), k - 1)) { planMemo[key] = true; return true; }
      }
    }
    return false;
  }
  function plannedPick(grid, spots, cam, cfg, full, left, dists) {
    var s = G.state, T = N(cfg.TILE, 32), logic = L();
    // same values as a RELAX_MAX BFS for every tile that matters (<= RELAX_MAX); reuses the spawn BFS when given
    var d = dists || logic.bfsTiles(grid, Math.floor(s.player.x / T), Math.floor(s.player.y / T), N(cfg.RELAX_MAX_TILES, 40));
    var M = N(cfg.SPAWN_OFFSCREEN_MARGIN, 64);
    var MIN = N(cfg.SPAWN_MIN_TILES, 18), MAX = N(cfg.SPAWN_MAX_TILES, 34);
    var RMIN = N(cfg.RELAX_MIN_TILES, 8), RMAX = N(cfg.RELAX_MAX_TILES, 40);
    var best = null, bestLv = 3, n = 0;
    for (var i = 0; i < deck.length; i++) {
      var kinds = deck[i].kinds || [], rest = full & ~(1 << i);
      for (var q = 0; q < spots.length; q++) {
        var sp = spots[q];
        if (sp.id === lastSpotId || kinds.indexOf(sp.kind) < 0) continue;
        var v = tileVal(d, grid, sp);
        if (v < 0) continue;
        var off = sp.x < cam.x - M || sp.x > cam.x + cam.w + M || sp.y < cam.y - M || sp.y > cam.y + cam.h + M;
        var lv = (v >= MIN && v <= MAX) ? (off ? 0 : 1) : ((v >= RMIN && v <= RMAX) ? 2 : 3);
        if (lv > bestLv || lv === 3 || !feasible(q, rest, left)) continue;
        if (lv < bestLv) { bestLv = lv; n = 0; }
        n++;
        if (rng() * n < 1) best = { idx: i, pick: { spot: sp, pathTiles: v, relax: lv } };   // reservoir pick
      }
    }
    return best;
  }

  function spawn() {
    var s = G.state, cfg = C(), logic = L();
    var c = chooseCase();
    if (!c) return false;
    var def = c.idx >= 0 ? deck.splice(c.idx, 1)[0] : c.def;
    var spot = c.pick.spot;
    lastSpotId = spot.id;
    // previous actors still walking off move to the leaving list
    if (s.scandal && s.scandal.actors) {
      for (var k = 0; k < s.scandal.actors.length; k++) leaving.push(s.scandal.actors[k]);
    }
    var roles = def.roles || [], actors = [], ext = 24;
    for (var i = 0; i < roles.length; i++) {
      var ro = roles[i] || {};
      var a = makePerson(spot.x + N(ro.dx, 0), spot.y + N(ro.dy, 0), ro.look || 'suit', 'scandal');
      a.dir = N(ro.dir, 4);
      a.prop = ro.prop || 'none';
      a.brain = { role: i, name: ro.name || '', bx: a.x, by: a.y, mode: 'live', timer: 0, fx: 0, fy: 1, turn: 1, startProp: a.prop };
      actors.push(a);
      ext = Math.max(ext, Math.abs(N(ro.dx, 0)) + 22, Math.abs(N(ro.dy, 0)) + 22,
        Math.abs(N(ro.pdx, 0)) + 22, Math.abs(N(ro.pdy, 0)) + 22);
    }
    s.caseNo++;
    var tip = String(def.tip || def.title || '').split('{area}').join(spot.name || spot.kind || 'somewhere');
    s.scandal = {
      def: def, spot: spot, t: 0, intensity: logic.intensityAt(0, cfg), live: true, status: 'live', actors: actors,
      focus: { x: spot.x, y: spot.y }, d: 0, prox: 0, inRange: false, tip: tip,
      lineIdx: 0, pending: [], ringR: Math.min(64, ext), endT: 0, photoI: 0, relax: c.pick.relax, pathTiles: c.pick.pathTiles,
      peaked: false, flareT: -1
    };
    s.phase = 'live';
    s.events.push({ type: 'spawn', def: def, tip: tip });
    updateProximity();
    return true;
  }

  function updateProximity() {
    var s = G.state, sc = s.scandal, logic = L(), cfg = C();
    if (!sc) return;
    sc.d = logic.dist(s.player.x, s.player.y, sc.focus.x, sc.focus.y);
    sc.prox = sc.status === 'live' ? logic.proximity(sc.d, cfg) : 0;
    sc.inRange = sc.status === 'live' && sc.d <= N(cfg.PHOTO_RANGE, 170);
  }

  function actorByRole(sc, r) {
    var a = sc.actors[r | 0];
    return a || sc.actors[0] || null;
  }

  function fireLine(sc, ln) {
    if (!ln) return;
    var a = actorByRole(sc, ln.r);
    if (!a) return;
    // only one scandal bubble at a time: a new line clears the others
    for (var i = 0; i < sc.actors.length; i++) {
      var o = sc.actors[i];
      if (o !== a && o.bubble && o.bubble.style === 'scandal') o.bubble = null;
    }
    say(a, ln.s, 'scandal', a.brain && a.brain.name);
  }

  function resolve(status) {
    var s = G.state, sc = s.scandal, cfg = C();
    sc.status = status; sc.live = false; sc.endT = 0;
    sc.photoI = sc.intensity; sc.intensity = 0;
    var away = status === 'busted';
    for (var i = 0; i < sc.actors.length; i++) {
      var a = sc.actors[i], b = a.brain;
      a.glow = 0; a.action = null;
      b.mode = away ? 'flee' : 'leave'; b.timer = 0;
      var vx = a.x - (away ? s.player.x : sc.focus.x), vy = a.y - (away ? s.player.y : sc.focus.y);
      if (!away && Math.abs(vx) + Math.abs(vy) < 1) { vx = a.x - s.player.x; vy = a.y - s.player.y; }
      var len = Math.sqrt(vx * vx + vy * vy);
      if (len < 1) { var ang = rng() * Math.PI * 2; vx = Math.cos(ang); vy = Math.sin(ang); len = 1; }
      b.fx = vx / len; b.fy = vy / len; b.turn = rng() < 0.5 ? -1 : 1;
    }
    var def = sc.def;
    sc.pending.length = 0;
    if (away) {
      var bust = def.bust || [];
      if (bust[0]) fireLine(sc, bust[0]);
      for (var k = 1; k < bust.length; k++) sc.pending.push({ at: 0.9 * k, r: bust[k].r, s: bust[k].s });
    } else {
      var ex = def.expire || [];
      if (ex[0]) fireLine(sc, ex[0]);
      s.results.push({ defId: def.id, title: def.title, caption: def.caption, points: 0, label: 'MISSED', dt: null, photo: false });
      say(s.player, pickLine('player_miss'), 'player');
    }
    s.phase = 'resolving';
    s.timer = s.caseNo >= s.total ? N(cfg.END_DELAY, 2) : N(cfg.GAP, 3);
    s.events.push({ type: 'resolve', status: status });
  }

  // ---------------------------------------------------------------- actors
  function walkOff(a, speed, dt) {
    var logic = L(), cfg = C(), grid = PE.city && PE.city.grid, b = a.brain;
    var step = speed * dt;
    var r = logic.moveAndCollide(grid, a.x, a.y, b.fx * step, b.fy * step, N(cfg.PERSON_RADIUS, 7), N(cfg.TILE, 32), mv);
    var moved = Math.abs(r.x - a.x) + Math.abs(r.y - a.y);
    a.dir = logic.dirFromVector(b.fx, b.fy);
    a.x = r.x; a.y = r.y; a.moving = true; a.animT += dt * speed / 55;
    if (moved < step * 0.3) {
      var ang = Math.atan2(b.fy, b.fx) + b.turn * Math.PI / 4;
      b.fx = Math.cos(ang); b.fy = Math.sin(ang);
    }
  }

  function offscreen(a, cam) {
    return a.x < cam.x - 64 || a.x > cam.x + cam.w + 64 || a.y < cam.y - 64 || a.y > cam.y + cam.h + 64;
  }

  function stepLeavingActor(a, dt, cam) {
    // returns true if the actor should be removed
    var cfg = C(), b = a.brain;
    b.timer += dt;
    if (b.mode === 'flee') {
      walkOff(a, N(cfg.NPC_SPEED, 55) * 1.3, dt);
      return b.timer >= N(cfg.BUSTED_FLEE_TIME, 4);
    }
    walkOff(a, N(cfg.NPC_SPEED, 55), dt);
    return b.timer >= 5 || offscreen(a, cam);
  }

  // Spec 4 peak cue: lean-in [RISE-ACTION_LEAD, RISE) = lerp to pdx/pdy, no fx; at the first step with
  // t >= RISE the action pops, peakProp swaps in, the flare starts and a 'peak' event fires; held to RISE+ACTION_TAIL.
  function stepLiveActors(sc, dt) {
    var cfg = C(), RISE = N(cfg.RISE, 11), s = G.state;
    var leanIn = sc.t >= RISE - N(cfg.ACTION_LEAD, 1);
    var hold = sc.t >= RISE && sc.t <= RISE + N(cfg.ACTION_TAIL, 1.5);
    var roles = sc.def.roles || [], act = (sc.def.peak && sc.def.peak.action) || null;
    var pop = false;
    if (sc.t >= RISE && !sc.peaked) {
      sc.peaked = true; sc.flareT = 0; pop = true;
      s.events.push({ type: 'peak' });
    }
    // v1.1.5 lean-in: fixed-duration ease from the lean-in start position (was an exponential ease-out whose
    // sub-pixel tail crept 1 px every 5-20 frames with the walk cycle running, right before the peak).
    // Arrives at RISE - (1 - LEAN_FRACTION) * ACTION_LEAD and holds still for the pop.
    var L0 = RISE - N(cfg.ACTION_LEAD, 1), LD = N(cfg.ACTION_LEAD, 1) * LEAN_FRACTION;
    var u = LD > 0 ? Math.max(0, Math.min(1, (sc.t - L0) / LD)) : 1;
    var e = u * u * (3 - 2 * u);                       // v1.1.6 smoothstep: starts and ends at zero velocity
    for (var i = 0; i < sc.actors.length; i++) {
      var a = sc.actors[i], ro = roles[i] || {}, b = a.brain;
      a.glow = sc.intensity;
      a.moving = false;
      if (leanIn && (typeof ro.pdx === 'number' || typeof ro.pdy === 'number')) {
        if (b.lx0 === undefined) { b.lx0 = a.x; b.ly0 = a.y; }
        var tx = sc.spot.x + N(ro.pdx, N(ro.dx, 0)), ty = sc.spot.y + N(ro.pdy, N(ro.dy, 0));
        var nx = b.lx0 + (tx - b.lx0) * e, ny = b.ly0 + (ty - b.ly0) * e;
        var step = Math.sqrt((nx - a.x) * (nx - a.x) + (ny - a.y) * (ny - a.y));
        a.x = nx; a.y = ny;
        if (u < 1 && dt > 0 && step / dt >= LEAN_WALK_MIN_SPEED) {   // legs only while visibly travelling, at ground speed
          a.moving = true;
          a.animT += step / N(cfg.NPC_SPEED, 55);
        }
      }
      if (pop && ro.peakProp) a.prop = ro.peakProp;
      a.action = hold ? act : null;
    }
  }

  function tickLeaving(dt, cam) {
    for (var i = leaving.length - 1; i >= 0; i--) {
      var a = leaving[i];
      L().tickBubble(a, dt);
      if (stepLeavingActor(a, dt, cam)) leaving.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- update
  G.update = function (dt, input) {
    var s = G.state;
    if (!s) return;
    s.events.length = 0;
    if (s.over) return;
    input = input || input0;
    var cfg = C(), logic = L(), T = N(cfg.TILE, 32), p = s.player;
    s.time += dt;
    if (s.photoCooldown > 0) s.photoCooldown = Math.max(0, s.photoCooldown - dt);

    // --- player movement
    var vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var vy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (vx || vy) {
      var len = Math.sqrt(vx * vx + vy * vy);
      var mult = input.sprint ? N(cfg.SPRINT_MULT, 1.5) : 1;
      var sp = N(cfg.PLAYER_SPEED, 140) * mult * dt / len;
      var r = logic.moveAndCollide(PE.city && PE.city.grid, p.x, p.y, vx * sp, vy * sp, N(cfg.PERSON_RADIUS, 7), T, mv);
      p.x = r.x; p.y = r.y;
      p.dir = logic.dirFromVector(vx, vy);
      p.moving = true; p.animT += dt * mult;
    } else {
      p.moving = false;
    }
    logic.tickBubble(p, dt);
    var cam = camFor(p);

    // --- phase machine
    var sc = s.scandal;
    if (sc && sc.flareT >= 0) sc.flareT += dt;
    if (s.phase === 'waiting' || s.phase === 'resolving') warmPlanner();
    if (s.phase === 'waiting') {
      s.timer -= dt;
      if (s.timer <= 0) { if (!spawn()) s.timer = 0.5; }
    } else if (s.phase === 'live' && sc) {
      sc.t += dt;
      sc.intensity = logic.intensityAt(sc.t, cfg);
      var lines = sc.def.lines || [];
      // lines are sorted by `at`; each fires once as t crosses it
      while (sc.lineIdx < lines.length && N(lines[sc.lineIdx] && lines[sc.lineIdx].at, 0) <= sc.t) {
        fireLine(sc, lines[sc.lineIdx]);
        sc.lineIdx++;
      }
      stepLiveActors(sc, dt);
      if (!logic.isLive(sc.t, cfg)) resolve('expired');
    } else if (s.phase === 'resolving') {
      s.timer -= dt;
      if (s.timer <= 0) {
        if (s.caseNo >= s.total) { s.phase = 'over'; s.over = true; }
        else if (!spawn()) { s.phase = 'waiting'; s.timer = 0.5; }
      }
    }

    // --- resolved scandal actors (current scandal object, not yet replaced)
    sc = s.scandal;
    if (sc) {
      for (var i = sc.actors.length - 1; i >= 0; i--) {
        var a = sc.actors[i];
        logic.tickBubble(a, dt);
        if (sc.status !== 'live' && stepLeavingActor(a, dt, cam)) sc.actors.splice(i, 1);
      }
      if (sc.status !== 'live') {
        sc.endT += dt;
        for (var q = sc.pending.length - 1; q >= 0; q--) {
          if (sc.endT >= sc.pending[q].at) { fireLine(sc, sc.pending[q]); sc.pending.splice(q, 1); }
        }
      }
      updateProximity();
    }
    tickLeaving(dt, cam);

    // --- photo
    if (input.photo && s.photoCooldown <= 0 && !s.over) {
      s.photoCooldown = N(cfg.PHOTO_COOLDOWN, 0.6);
      sc = s.scandal;
      var live = !!(sc && sc.status === 'live' && logic.isLive(sc.t, cfg));
      var res = logic.scorePhoto({ t: sc ? sc.t : 0, live: live, inRange: !!(live && sc.inRange) }, cfg);
      s.score += res.points;
      var ex = sc ? sc.focus.x : p.x, ey = sc ? sc.focus.y : p.y;
      s.events.push({ type: 'photo', result: res, x: ex, y: ey });
      if (res.kind === 'scored') {
        s.results.push({ defId: sc.def.id, title: sc.def.title, caption: sc.def.caption, points: res.points, label: res.label, dt: res.dt, photo: true });
        resolve('busted');
        if (res.points >= 400) say(p, pickLine('player_good'), 'player');
      } else {
        if (PE.npc && typeof PE.npc.reactToPhoto === 'function') PE.npc.reactToPhoto(p.x, p.y);
        say(p, pickLine('player_bad'), 'player');
      }
    }

    // --- ambient crowd
    if (PE.npc && typeof PE.npc.update === 'function') PE.npc.update(dt, p, cam);
  };

  // ---------------------------------------------------------------- queries / draw
  G.actors = function () {
    actorList.length = 0;
    var s = G.state;
    if (s && s.scandal) for (var i = 0; i < s.scandal.actors.length; i++) actorList.push(s.scandal.actors[i]);
    for (var j = 0; j < leaving.length; j++) actorList.push(leaving[j]);
    return actorList;
  };

  G.drawUnder = function (ctx, cam) {
    var s = G.state, art = PE.art;
    if (!s || !s.scandal || !art) return;
    var sc = s.scandal, I = sc.intensity, cfg = C();
    var fx = Math.round(sc.focus.x - cam.x), fy = Math.round(sc.focus.y - cam.y);
    if (fx < -160 || fy < -160 || fx > cam.w + 160 || fy > cam.h + 160) return;
    var BF = N(cfg.BUST_FADE, 0.3);
    if (sc.status === 'busted') I = sc.endT < BF ? sc.photoI * (1 - sc.endT / BF) : 0;
    else if (sc.status !== 'live') I = 0;
    if (I > 0.001) {
      if (typeof art.drawGroundRing === 'function') art.drawGroundRing(ctx, fx, fy, sc.ringR, Math.round(sc.ringR * 0.6), I);
      if (typeof art.drawGlow === 'function') {
        for (var i = 0; i < sc.actors.length; i++) {
          var a = sc.actors[i];
          art.drawGlow(ctx, Math.round(a.x - cam.x), Math.round(a.y - cam.y), a.dir, I, s.time);
        }
      }
    }
  };

  // Peak flare ABOVE people and buildings (spec 4 v0.3); main calls it after city.drawTop and ui.capture.
  // No flare if the scandal was busted during the lean-in (flareT stays -1: the peak never popped).
  G.drawOver = function (ctx, cam) {
    var s = G.state, art = PE.art;
    if (!s || !s.scandal || !art || typeof art.drawPeakFlare !== 'function') return;
    var sc = s.scandal, FL = N(C().PEAK_FLARE_TIME, 0.5);
    if (!(sc.flareT >= 0 && sc.flareT < FL)) return;
    var fx = Math.round(sc.focus.x - cam.x), fy = Math.round(sc.focus.y - cam.y);
    if (fx < -160 || fy < -160 || fx > cam.w + 160 || fy > cam.h + 160) return;
    art.drawPeakFlare(ctx, fx, fy, sc.flareT / FL);
  };

  G.state = null;
  G.frameEvents = [];
  PE.game = G;
})(globalThis.PE = globalThis.PE || {});
