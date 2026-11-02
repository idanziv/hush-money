// HUSH MONEY v2 night - night-game.js (owner: eng-lead). Fork of game.js v1.1.6 for night.html (docs/06).
// Same PE.game interface as v1 (ui.js / bots work unchanged) plus: district-only spawns, per-case env (dusk -> night),
// watchers with LOS cones, suspicion -> uneasy / cagey / abort, angle-multiplied photo score, facing input, telemetry.
// Headless-safe: DOM only via ctx in draw*. Night numbers come from PE.NIGHT (night-data.js) with 06 fallbacks.
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

  var NIGHT_CFG0 = { RISE: 13, FALL: 8, SPAWN_MIN_TILES: 14, SPAWN_MAX_TILES: 28 };
  var NC = null, NCsrc = null, NCbase = null;
  function C() {                                   // PE.CFG + 06 decision 7 prototype tuning + PE.NIGHT.CFG
    var src = PE.NIGHT && PE.NIGHT.CFG;
    if (!NC || NCsrc !== src || NCbase !== PE.CFG) {
      NC = Object.assign({}, PE.CFG || {}, NIGHT_CFG0, src || {}); NCsrc = src; NCbase = PE.CFG;
    }
    return NC;
  }
  G.cfg = C;
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
    // night map required (Omer): (re)init when the city was never built OR was built in day mode
    if (PE.city && (!PE.city.grid || !PE.city.night) && typeof PE.city.init === 'function') PE.city.init({ night: true });
    if (PE.npc && typeof PE.npc.init === 'function') PE.npc.init(logic.mulberry32((seed ^ 0x9E3779B9) >>> 0));
    var cfg = C(), T = N(cfg.TILE, 32);
    var start = nightStart(T);
    nSpots = null; nDefs = null;
    if (PE.stealth) PE.stealth.init(PE.city, cfg);
    var player = makePerson(start.x, start.y, 'detective', 'player');
    player.id = 'player'; player.dir = 2;
    deck = logic.shuffle(nightDefs(), rng);
    lastSpotId = null; leaving.length = 0;
    G.state = {
      seed: seed, time: 0, score: 0, caseNo: 0, total: N(cfg.SCANDALS_PER_RUN, 6), player: player,
      phase: 'waiting', timer: N(cfg.FIRST_DELAY, 2), scandal: null, results: [], photoCooldown: 0,
      events: [], over: false,
      env: envFor(1), quality: null
    };
    G.frameEvents = [];
    telStart(seed);
    return G.state;
  };

  // ---------------------------------------------------------------- spawn
  function chooseCase() {
    var logic = L(), cfg = C(), s = G.state, city = PE.city || {};
    var spots = nightSpots(), grid = city.grid;
    var cam = camFor(s.player), defs = nightDefs();
    if (!defs.length || !grid || !spots.length) return null;
    if (!deck.length) deck = logic.shuffle(defs, rng);
    var left = s.total - s.caseNo - 1;               // cases still to come after this one
    var full = (1 << deck.length) - 1;
    planMemo = Object.create(null);
    // Pass 1 - spec 7 exactly (first strict, else first relaxed), but skip a pick that would leave the
    // remaining deck unable to fill the remaining cases (planner assumes the player ends near each spot).
    var firstAny = null, firstRel = null;
    for (var i = 0; i < deck.length; i++) {
      var r = logic.pickSpawnSpot(grid, spots, s.player.x, s.player.y, cam, deck[i].kinds, cfg, rng, lastSpotId);
      if (!r) continue;
      if (!firstAny) firstAny = { idx: i, pick: r };
      if (!feasible(spots.indexOf(r.spot), full & ~(1 << i), left)) continue;
      if (r.relax === 0) return { idx: i, pick: r };
      if (!firstRel) firstRel = { idx: i, pick: r };
    }
    if (firstRel) return firstRel;
    // Pass 2 - the random spot pickSpawnSpot chose dead-ends: search every legal (def, spot) of the deck
    // with the same relax levels, keeping only plannable ones.
    var planned = plannedPick(grid, spots, cam, cfg, full, left);
    if (planned) return planned;
    // Pass 3 - no plan exists: spec 7 pick anyway (kinds and distance always respected).
    if (firstAny) return firstAny;
    // Night (small district, 8 spots): if the 0.5 s retries found nothing for 2 s (player parked where no def
    // has an 8-40 tile spot), relax DISTANCE, never kind: nearest spot of a deck def's kinds up to FAR_MAX tiles.
    return (s.retries || 0) >= 4 ? farPick(grid, spots, cfg) : null;
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
    var cfg = C(), city = PE.city, grid = city.grid, spots = nightSpots();
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
  function plannedPick(grid, spots, cam, cfg, full, left) {
    var s = G.state, T = N(cfg.TILE, 32), logic = L();
    var d = logic.bfsTiles(grid, Math.floor(s.player.x / T), Math.floor(s.player.y / T), N(cfg.RELAX_MAX_TILES, 40));
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
    s.env = envFor(s.caseNo);
    var tip = String(def.tip || def.title || '').split('{area}').join(spot.name || spot.kind || 'somewhere');
    s.scandal = {
      def: def, spot: spot, t: 0, intensity: logic.intensityAt(0, cfg), live: true, status: 'live', actors: actors,
      focus: { x: spot.x, y: spot.y }, d: 0, prox: 0, inRange: false, tip: tip,
      lineIdx: 0, pending: [], ringR: Math.min(64, ext), endT: 0, photoI: 0, relax: c.pick.relax, pathTiles: c.pick.pathTiles,
      peaked: false, flareT: -1
    };
    s.phase = 'live';
    s.events.push({ type: 'spawn', def: def, tip: tip });
    setupNight(s.scandal);
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
      if (o !== a && o.bubble && isScandalStyle(o.bubble.style)) o.bubble = null;
    }
    say(a, ln.s, lineStyle(sc), a.brain && a.brain.name);          // 'whisper' while cagey
  }

  function resolve(status) {
    var s = G.state, sc = s.scandal, cfg = C();
    sc.status = status; sc.live = false; sc.endT = 0;
    sc.photoI = sc.intensity; sc.intensity = 0;
    var away = status === 'busted', flee = away || status === 'aborted';   // abort: actors leave like busted (no chase)
    releaseWatchers(sc, flee);
    for (var i = 0; i < sc.actors.length; i++) {
      var a = sc.actors[i], b = a.brain;
      a.glow = 0; a.action = null;
      b.mode = flee ? 'flee' : 'leave'; b.timer = 0;
      var vx = a.x - (flee ? s.player.x : sc.focus.x), vy = a.y - (flee ? s.player.y : sc.focus.y);
      if (!flee && Math.abs(vx) + Math.abs(vy) < 1) { vx = a.x - s.player.x; vy = a.y - s.player.y; }
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
      s.results.push({ defId: def.id, title: def.title, caption: def.caption, points: 0, label: 'MISSED', dt: null, photo: false, aborted: status === 'aborted' });
      if (status === 'aborted') nervousLine(sc, 'abort');
      say(s.player, pickLine('player_miss'), 'player');
    }
    telResolve(sc, status);
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
      if (!input.lockFace) p.dir = logic.dirFromVector(vx, vy);
      p.moving = true; p.animT += dt * mult;
      if (s.scandal && s.scandal.tel) s.scandal.tel.walked += sp * len;
    } else {
      p.moving = false;
    }
    if (typeof input.face === 'number' && input.face >= 0 && input.face < 8) p.dir = input.face | 0;   // touch facing / turn in place
    logic.tickBubble(p, dt);
    var cam = camFor(p);

    // --- phase machine
    var sc = s.scandal;
    if (sc && sc.flareT >= 0) sc.flareT += dt;
    if (s.phase === 'waiting') {
      s.timer -= dt;
      if (s.timer <= 0) { if (!spawn()) { s.retries = (s.retries || 0) + 1; s.timer = 0.5; } else s.retries = 0; }
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
      stepNight(sc, dt, input);
      if (sc.status === 'live' && !logic.isLive(sc.t, cfg)) resolve('expired');
    } else if (s.phase === 'resolving') {
      s.timer -= dt;
      if (s.timer <= 0) {
        if (s.caseNo >= s.total) { s.phase = 'over'; s.over = true; telFinish(); }
        else if (!spawn()) { s.phase = 'waiting'; s.timer = 0.5; s.retries = 1; }
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
      if (res.kind === 'scored') res = angleResult(res, sc, p, cfg);
      if (sc && sc.tel) { sc.tel.photos++; if (res.kind !== 'scored') sc.tel.penalties++; }
      if (live && sc.seenNow && PE.stealth) {          // shooting in a watcher's sight bumps suspicion
        sc.susp = PE.stealth.suspicionStep(sc.susp, 0, { seen: true, dist: sc.seenDist, photo: true });
      }
      s.score += res.points;
      var ex = sc ? sc.focus.x : p.x, ey = sc ? sc.focus.y : p.y;
      s.events.push({ type: 'photo', result: res, x: ex, y: ey });
      if (res.kind === 'scored') {
        s.results.push({ defId: sc.def.id, title: sc.def.title, caption: sc.def.caption, points: res.points, label: res.label, dt: res.dt, photo: true, timing: res.timing, angle: res.angle,
          M: res.M, frame: res.frame, los: res.los, lit: res.lit, dist: res.dist, faces: res.faces });
        if (sc.tel) { sc.tel.timing = res.timing; sc.tel.angle = res.angle; sc.tel.dt = res.dt; }
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

  // ================================================================ NIGHT SYSTEMS (docs/06 decisions 4-8)
  // Reads PE.NIGHT (night-data.js, design-writer); every key has a 06 fallback:
  //   CFG (RISE 13, FALL 8, spawn 14-28, LINE_SHIFT) . DISTRICT . envForCase(n) / CASES . watchersFor(defId, n) / STAGING
  //   DEAL_GLANCE . SUSPICION (UNEASY_SCAN_MULT, CAGEY_STEP_PX, CAGEY_STYLE) . TIPS . LINES[defId].{uneasy,cagey,abort}
  //   DETECT / SUSP / M are read by stealth.js.
  // Watcher record (state.scandal.watchers[i]): {x, y, faceA, coneOn, cone, sees, person, isActor, role, scan, brightMult, name}
  var DIST0 = { x0: 19, y0: 28, x1: 46, y1: 56 };
  var DEFS0 = ['affair', 'drug_deal', 'bribe', 'protest', 'match_fix'];
  var RUN0 = { ambient: [0.90, 0.75, 0.55, 0.35, 0.20, 0.12], lampsFromCase: 3, watchers: [1, 1, 1, 2, 2, 2],
    ambientColor: ['#FFC48A', '#F29A6B', '#B07A98', '#5E5C8E', '#363F72', '#1E2A55'] };
  var LINES0 = {
    uneasy: ['Hm? Who goes there?', 'Did something move?'],
    cagey: ['Shh. We are being watched.', 'Not here. Act normal.'],
    abort: ['Forget it. Deal is off!', 'Yalla, scatter!']
  };
  var GLANCE0 = { START: -1.0, DUR: 1.2, DUR_MIN: 1.0, DUR_MAX: 1.5 };
  var STAGE_KEYS = ['kinds', 'lines', 'bust', 'expire', 'tip', 'caption', 'title', 'roles', 'peak'];
  var TURN_RATE = 4.2;                 // watcher head turn, rad/s (~240 deg/s)
  var CONE_HZ = 10;                    // cone polygons recomputed at 10 Hz (drawing only)
  var SHADOW_STEP_T = 1.0;
  var nSpots = null, nDefs = null;

  function NI() { return PE.NIGHT || {}; }
  function SU() { return NI().SUSPICION || {}; }
  function district() { return NI().DISTRICT || DIST0; }
  function inDistrict(x, y) {
    var T = N(C().TILE, 32), d = district(), tx = x / T, ty = y / T;
    return tx >= d.x0 && tx < d.x1 + 1 && ty >= d.y0 && ty < d.y1 + 1;
  }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function dirOf(a) { return L().dirFromVector(Math.cos(a), Math.sin(a)); }
  function dirAngle(d) { return (d * 45 - 90) * Math.PI / 180; }
  function walkable(x, y) {
    var g = PE.city && PE.city.grid, T = N(C().TILE, 32), tx = Math.floor(x / T), ty = Math.floor(y / T);
    return !!g && tx >= 0 && ty >= 0 && tx < g.w && ty < g.h && !g.solid[ty * g.w + tx];
  }
  function detectDims() { return (PE.stealth && PE.stealth.params) ? PE.stealth.params() : { fov: 70, range: 150, ambientAll: 0.5, litMin: 0.35 }; }
  function isScandalStyle(st) { return st === 'scandal' || st === 'whisper'; }
  function lineStyle(sc) { return sc && (sc.suspState === 'cagey') ? (SU().CAGEY_STYLE || 'whisper') : 'scandal'; }

  // Night spots: city.nightSpots, else spots flagged .night, else city.spots inside the district
  // (Noa's city.init({night:true}) replaces city.spots with the 8 night spots).
  function nightSpots() {
    if (nSpots) return nSpots;
    var city = PE.city || {}, out = [], i, all = city.spots || [];
    if (city.nightSpots && city.nightSpots.length) out = city.nightSpots.slice();
    if (!out.length) for (i = 0; i < all.length; i++) if (all[i] && all[i].night) out.push(all[i]);
    if (!out.length) for (i = 0; i < all.length; i++) if (all[i] && inDistrict(all[i].x, all[i].y)) out.push(all[i]);
    nSpots = out;
    return out;
  }
  // The 5 night defs as copies (v1 PE.SCANDALS untouched): staging overrides, TIPS, lines shifted by LINE_SHIFT,
  // kinds narrowed to kinds that exist among the night spots.
  function nightDefs() {
    if (nDefs) return nDefs;
    var ids = NI().DEFS || DEFS0, stg = NI().STAGING || {}, tips = NI().TIPS || {}, spots = nightSpots(), have = {}, i, j, out = [];
    var shift = N(C().LINE_SHIFT, 0);
    for (i = 0; i < spots.length; i++) have[spots[i].kind] = 1;
    var all = PE.SCANDALS || [];
    for (i = 0; i < all.length; i++) {
      var d = all[i];
      if (!d || ids.indexOf(d.id) < 0) continue;
      var c = Object.assign({}, d), st = stg[d.id] || {};
      for (j = 0; j < STAGE_KEYS.length; j++) if (st[STAGE_KEYS[j]] !== undefined) c[STAGE_KEYS[j]] = st[STAGE_KEYS[j]];
      if (tips[d.id]) c.tip = tips[d.id];
      if (shift && !st.lines) c.lines = (d.lines || []).map(function (ln) { return { at: ln.at + shift, r: ln.r, s: ln.s }; });
      var ok = [], k = c.kinds || [];
      for (j = 0; j < k.length; j++) if (have[k[j]]) ok.push(k[j]);
      if (!ok.length) ok = Object.keys(have);           // no night spot of its kinds: any night spot (reported)
      c.kinds = ok;
      out.push(c);
    }
    nDefs = out;
    return out;
  }
  function nightStart(T) {
    var city = PE.city || {}, list = [], i, ns = city.nightStarts || NI().STARTS;
    if (ns && ns.length) list = ns;
    else { var ps = city.playerStarts || []; for (i = 0; i < ps.length; i++) if (ps[i] && inDistrict(ps[i].x, ps[i].y)) list.push(ps[i]); }
    if (list.length) return list[Math.floor(rng() * list.length) % list.length];
    var d = district(), cx = (d.x0 + d.x1) >> 1, cy = (d.y0 + d.y1) >> 1;
    for (var r = 0; r < 24; r++) for (var y = cy - r; y <= cy + r; y++) for (var x = cx - r; x <= cx + r; x++) {
      if (walkable(x * T + T / 2, y * T + T / 2)) return { x: x * T + T / 2, y: y * T + T / 2 };
    }
    return city.playerStart || { x: 24 * T, y: 32 * T };
  }

  // Per-case environment (06 decision 7): {ambient, ambientColor, lampLevel, watchers, caseNo}.
  function envFor(caseNo) {
    caseNo = Math.max(1, caseNo | 0 || 1);
    var e;
    if (typeof NI().envForCase === 'function') e = NI().envForCase(caseNo);
    else {
      var i = Math.min(5, caseNo - 1);
      e = { ambient: RUN0.ambient[i], ambientColor: RUN0.ambientColor[i], lampLevel: caseNo >= RUN0.lampsFromCase ? 1 : 0, watchers: RUN0.watchers[i] };
    }
    e.caseNo = caseNo;
    return e;
  }
  G.envFor = envFor;

  function pickArr(arr) { return arr && arr.length ? arr[Math.floor(rng() * arr.length) % arr.length] : null; }
  // Nervous line for a def: PE.NIGHT.LINES[defId][cat] = {r|w, s}; fallback generic, spoken by actor 0 / watcher 0.
  function nervousLine(sc, cat) {
    var e = ((NI().LINES || {})[sc.def.id] || {})[cat], who = null, text = null;
    if (e && e.s) {
      text = e.s;
      if (typeof e.w === 'number' && sc.watchers[e.w]) who = sc.watchers[e.w].person;
      else who = sc.actors[e.r | 0] || sc.actors[0];
    } else {
      text = pickArr(LINES0[cat]);
      who = cat === 'uneasy' && sc.watchers[0] ? sc.watchers[0].person : sc.actors[0];
    }
    if (!who || !text) return;
    for (var i = 0; i < sc.actors.length; i++) if (sc.actors[i] !== who && sc.actors[i].bubble && isScandalStyle(sc.actors[i].bubble.style)) sc.actors[i].bubble = null;
    say(who, text, cat === 'cagey' ? (SU().CAGEY_STYLE || 'whisper') : 'scandal', who.brain && who.brain.name);
  }

  var FAR_MAX = 56;                    // tiles: 13 s at 4.375 tiles/s = 57 (reach before RISE even when relaxed)
  function farPick(grid, spots, cfg) {
    var s = G.state, T = N(cfg.TILE, 32), lo = N(cfg.RELAX_MIN_TILES, 8);
    var d = L().bfsTiles(grid, Math.floor(s.player.x / T), Math.floor(s.player.y / T), FAR_MAX), best = null, bv = 1e9;
    for (var i = 0; i < deck.length; i++) {
      var kinds = deck[i].kinds || [];
      for (var q = 0; q < spots.length; q++) {
        var sp = spots[q];
        if (sp.id === lastSpotId || kinds.indexOf(sp.kind) < 0) continue;
        var v = d[Math.floor(sp.y / T) * grid.w + Math.floor(sp.x / T)];
        if (v < 1) continue;
        var cost = v >= lo ? v - lo : 1000 + (lo - v);          // nearest at >= RELAX_MIN, else the farthest closer one
        if (cost < bv) { bv = cost; best = { idx: i, pick: { spot: sp, pathTiles: v, relax: 3 } }; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- watchers
  function stagedWatchers(defId, caseNo, count) {
    if (typeof NI().watchersFor === 'function') return NI().watchersFor(defId, caseNo) || [];
    var st = (NI().STAGING || {})[defId];
    return st && st.watchers ? st.watchers.slice(0, count) : [];
  }
  function setupNight(sc) {
    var s = G.state, env = s.env, count = N(env.watchers, 1) | 0, i;
    var list = stagedWatchers(sc.def.id, s.caseNo, count);
    sc.watchers = []; sc.extras = [];
    sc.susp = 0; sc.suspState = 'calm'; sc.seenNow = false; sc.seenDist = 0; sc.unseenFor = 99;
    sc.coneT = 0; sc.lit = 0; sc.exposed = false; sc.saidUneasy = false; sc.saidCagey = false;
    s.suspicion = 0;
    for (i = 0; i < list.length; i++) { var w = makeWatcher(sc, list[i], i); if (w) sc.watchers.push(w); }
    for (i = sc.watchers.length; i < count && !list.length; i++) sc.watchers.push(makeWatcher(sc, null, i));   // no staging: generic guards
    for (i = 0; i < sc.watchers.length; i++) resolveFace(sc, sc.watchers[i]);
    s.watchers = sc.watchers;
    sc.tel = telCase(sc);
  }
  function makeWatcher(sc, stg, k) {
    var sp = sc.spot, rec = { x: sp.x, y: sp.y, faceA: 0, base: 0, coneOn: true, cone: null, sees: false, person: null, isActor: false,
      role: -1, scan: (stg && stg.scan) || { kind: 'sweep', face: 'out', arc: 80, speed: 20, hold: 1.0 },
      brightMult: stg && typeof stg.brightMult === 'number' ? stg.brightMult : undefined,
      dealGlance: stg && typeof stg.dealGlance === 'number' ? stg.dealGlance : undefined,
      sweepPos: 0, sweepDir: 1, holdT: 0, patrolU: 0, name: '' };
    if (stg && typeof stg.role === 'number') {
      var a = sc.actors[stg.role];
      if (!a) return null;
      rec.person = a; rec.isActor = true; rec.role = stg.role; rec.name = a.brain.name;
    } else {
      var x, y;
      if (stg && typeof stg.dx === 'number') { x = sp.x + stg.dx; y = sp.y + N(stg.dy, 0); }
      else {                                                         // generic guard ~3 tiles out, with LOS to the deal
        var base = rng() * Math.PI * 2, ok = false;
        for (var tries = 0; tries < 18 && !ok; tries++) {
          var ang = base + k * Math.PI + ((tries + 1) >> 1) * 0.35 * (tries & 1 ? 1 : -1), dd = 92 + (tries % 3) * 14;
          x = sp.x + Math.cos(ang) * dd; y = sp.y + Math.sin(ang) * dd;
          ok = walkable(x, y) && (!PE.stealth || PE.stealth.los({ x: x, y: y }, sp));
        }
        if (!ok) { x = sp.x + (k ? -40 : 40); y = sp.y + 40; }
      }
      var p = makePerson(Math.round(x), Math.round(y), (stg && stg.look) || (k ? 'suit' : 'hoodie'), 'scandal');
      p.prop = (stg && stg.prop) || 'none';
      p.brain = { watcher: true, name: (stg && stg.name) || (k ? 'Bodyguard' : 'Lookout'), mode: 'watch', timer: 0, fx: 0, fy: 1, turn: 1 };
      rec.person = p; rec.name = p.brain.name;
      sc.extras.push(p);
    }
    rec.x = rec.person.x; rec.y = rec.person.y;
    rec.sweepPos = (rng() * 2 - 1) * N(rec.scan.arc, 80) / 2; rec.sweepDir = rng() < 0.5 ? -1 : 1;
    return rec;
  }
  // Resolve scan.face once at spawn: 0..7 | 'out' | 'in' | 'role' | 'move'
  function resolveFace(sc, w) {
    var f = w.scan.face, sp = sc.spot, p = w.person, a;
    if (typeof f === 'number') a = dirAngle(f);
    else if (f === 'in') a = Math.atan2(sp.y - p.y, sp.x - p.x);
    else if (f === 'role') { var ro = (sc.def.roles || [])[w.role] || {}; a = dirAngle(N(ro.dir, p.dir)); }
    else if (f === 'move') a = 0;
    else {                                                            // 'out' (default): away from the spot centre
      var dx = p.x - sp.x, dy = p.y - sp.y;
      a = (dx * dx + dy * dy < 4) ? dirAngle(p.dir) : Math.atan2(dy, dx);
    }
    w.base = a;
    w.faceA = w.scan.kind === 'glance' ? dirAngle(p.dir) : a;
    w.coneOn = w.scan.kind !== 'glance';
  }
  function stepWatchers(sc, dt) {
    var cfg = C(), RISE = N(cfg.RISE, 13), G0 = NI().DEAL_GLANCE || GLANCE0, i, j;
    var mult = sc.suspState === 'calm' ? 1 : N(SU().UNEASY_SCAN_MULT, 1.5);
    for (i = 0; i < sc.watchers.length; i++) {
      var w = sc.watchers[i], p = w.person, sk = w.scan, kind = sk.kind || 'sweep', target = w.base;
      if (kind === 'glance') {
        var on = false, spans = sk.spans || [];
        for (j = 0; j < spans.length; j++) if (sc.t >= spans[j][0] && sc.t < spans[j][1]) { on = true; break; }
        w.coneOn = on;
        if (!on) { w.faceA = PE.stealth.facingAngle(p); w.x = p.x; w.y = p.y; continue; }   // busy with the partner
      } else if (kind === 'sweep') {
        var half = N(sk.arc, 80) / 2;
        if (w.holdT > 0) w.holdT -= dt;
        else {
          w.sweepPos += w.sweepDir * N(sk.speed, 20) * mult * dt;
          if (w.sweepPos >= half) { w.sweepPos = half; w.sweepDir = -1; w.holdT = N(sk.hold, 0); }
          else if (w.sweepPos <= -half) { w.sweepPos = -half; w.sweepDir = 1; w.holdT = N(sk.hold, 0); }
        }
        target = w.base + w.sweepPos * Math.PI / 180;
      } else if (kind === 'patrol' && !w.isActor) {
        target = stepPatrol(sc, w, dt * mult);
      }
      // DEAL_GLANCE: everyone watching turns to the deal from RISE+START for its own dur (the sneak gap)
      var dur = Math.max(N(G0.DUR_MIN, 1), Math.min(N(G0.DUR_MAX, 1.5), N(w.dealGlance, N(G0.DUR, 1.2))));
      var g0 = RISE + N(G0.START, -1);
      if (sc.t >= g0 && sc.t < g0 + dur) target = Math.atan2(sc.focus.y - p.y, sc.focus.x - p.x);
      var d = angDiff(target, w.faceA), mt = TURN_RATE * dt;
      w.faceA += d > mt ? mt : (d < -mt ? -mt : d);
      p.dir = dirOf(w.faceA);
      w.x = p.x; w.y = p.y;
    }
  }
  // Patrol: closed loop of spot-relative points, `period` s per lap; returns the heading (looks along motion).
  function stepPatrol(sc, w, dt) {
    var pts = w.scan.pts || [], n = pts.length, p = w.person, i;
    if (n < 2) return w.base;
    var segL = 0, tot = 0;
    for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; tot += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])); }
    w.patrolU = (w.patrolU + dt / Math.max(0.5, N(w.scan.period, 8))) % 1;
    var dist = w.patrolU * tot;
    for (i = 0; i < n; i++) {
      var p0 = pts[i], p1 = pts[(i + 1) % n];
      segL = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1]));
      if (dist <= segL || i === n - 1) {
        var u = segL > 0 ? Math.min(1, dist / segL) : 0;
        var nx = sc.spot.x + p0[0] + (p1[0] - p0[0]) * u, ny = sc.spot.y + p0[1] + (p1[1] - p0[1]) * u;
        p.moving = true; p.animT += Math.sqrt((nx - p.x) * (nx - p.x) + (ny - p.y) * (ny - p.y)) / N(C().NPC_SPEED, 55);
        p.x = nx; p.y = ny;
        return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      }
      dist -= segL;
    }
    return w.base;
  }
  function releaseWatchers(sc, flee) {
    var s = G.state, ex = sc.extras || [];
    for (var i = 0; i < ex.length; i++) {
      var p = ex[i], b = p.brain;
      b.mode = flee ? 'flee' : 'leave'; b.timer = 0;
      var vx = p.x - (flee ? s.player.x : sc.focus.x), vy = p.y - (flee ? s.player.y : sc.focus.y), len = Math.sqrt(vx * vx + vy * vy);
      if (len < 1) { vx = 1; vy = 0; len = 1; }
      b.fx = vx / len; b.fy = vy / len; b.turn = rng() < 0.5 ? -1 : 1;
      leaving.push(p);
    }
    for (var j = 0; j < (sc.watchers || []).length; j++) { sc.watchers[j].sees = false; sc.watchers[j].coneOn = false; sc.watchers[j].cone = null; }
    sc.watchers = []; sc.extras = [];
    s.watchers = sc.watchers;
  }

  // ---------------------------------------------------------------- per-step night logic (live scandal)
  function stepNight(sc, dt, input) {
    var st = PE.stealth, s = G.state, p = s.player;
    if (!st || !sc.watchers || sc.status !== 'live') return;
    stepWatchers(sc, dt);
    var D = detectDims(), i;
    sc.coneT -= dt;
    if (sc.coneT <= 0) {
      sc.coneT += 1 / CONE_HZ; if (sc.coneT <= 0) sc.coneT = 1 / CONE_HZ;
      for (i = 0; i < sc.watchers.length; i++) {
        var cw = sc.watchers[i];
        cw.cone = cw.coneOn ? st.conePoly(cw, D.fov, D.range, 18, cw.cone) : cw.cone;
      }
    }
    sc.lit = st.lightAt(p.x, p.y, s.env);
    sc.exposed = N(s.env.ambient, 1) >= D.ambientAll || sc.lit >= D.litMin;
    var seenNow = false, best = Infinity, bright;
    for (i = 0; i < sc.watchers.length; i++) {
      var w = sc.watchers[i];
      w.sees = st.seen(w, p, s.env);
      if (w.sees) {
        seenNow = true;
        var dd = L().dist(w.x, w.y, p.x, p.y);
        if (dd < best) best = dd;
        if (typeof w.brightMult === 'number' && (bright === undefined || w.brightMult > bright)) bright = w.brightMult;
      }
    }
    sc.seenNow = seenNow; sc.seenDist = seenNow ? best : 0;
    sc.unseenFor = seenNow ? 0 : sc.unseenFor + dt;
    sc.susp = st.suspicionStep(sc.susp, dt, { seen: seenNow, dist: best, sprint: !!(input && input.sprint) && p.moving,
      unseenFor: sc.unseenFor, lit: sc.lit, brightMult: bright });
    s.suspicion = sc.susp;
    var ns = st.suspicionState(sc.susp);
    if (ns !== sc.suspState) onSuspState(sc, sc.suspState, ns);
    if (sc.status !== 'live') return;
    stepCagey(sc, dt);
    var t = sc.tel;
    if (t) {
      if (seenNow) t.seenS += dt;
      if (sc.exposed) t.exposedS += dt; else t.darkS += dt;
      if (sc.inRange) { t.inRangeS += dt; if (t.tApproach === null) t.tApproach = r2(sc.t); }
      // walked route as a tile list [[tx, ty], ...] (a new entry only when the player changes tile)
      var Tt = N(C().TILE, 32), ptx = Math.floor(p.x / Tt), pty = Math.floor(p.y / Tt), lp = t.path[t.path.length - 1];
      if (!lp || lp[0] !== ptx || lp[1] !== pty) t.path.push([ptx, pty]);
      if (sc.susp > t.maxSusp) t.maxSusp = sc.susp;
    }
  }
  function onSuspState(sc, from, to) {
    var s = G.state, order = { calm: 0, uneasy: 1, cagey: 2, abort: 3 };
    sc.suspState = to;
    s.events.push({ type: 'suspicion', state: to, from: from });
    if (order[to] <= order[from]) return;                          // calming down: no lines
    if (to === 'uneasy' && !sc.saidUneasy) {
      sc.saidUneasy = true; nervousLine(sc, 'uneasy');
      if (sc.tel && sc.tel.uneasyAt === null) sc.tel.uneasyAt = +sc.t.toFixed(2);
    } else if (to === 'cagey') {
      if (!sc.saidCagey) { sc.saidCagey = true; nervousLine(sc, 'cagey'); }
      if (sc.tel && sc.tel.cageyAt === null) sc.tel.cageyAt = +sc.t.toFixed(2);
      startShadowStep(sc);
    } else if (to === 'abort') {
      s.events.push({ type: 'abort', defId: sc.def.id });
      resolve('aborted');
    }
  }
  // Cagey (06 decision 5 + Tamar): actors turn their backs to the player and, before the lean-in,
  // step CAGEY_STEP_PX toward the darkest neighbour point (8 directions, walkable).
  function startShadowStep(sc) {
    var cfg = C(), L0 = N(cfg.RISE, 13) - N(cfg.ACTION_LEAD, 1), env = G.state.env, st = PE.stealth, step = N(SU().CAGEY_STEP_PX, 32);
    if (sc.t >= L0) return;
    for (var i = 0; i < sc.actors.length; i++) {
      var a = sc.actors[i], b = a.brain, bx = a.x, by = a.y, bestL = st.lightAt(a.x, a.y, env);
      for (var k = 0; k < 8; k++) {
        var ang = k * Math.PI / 4, x = a.x + Math.cos(ang) * step, y = a.y + Math.sin(ang) * step;
        if (!walkable(x, y)) continue;
        var l = st.lightAt(x, y, env);
        if (l < bestL - 0.02) { bestL = l; bx = x; by = y; }
      }
      b.shX0 = a.x; b.shY0 = a.y; b.shX1 = bx; b.shY1 = by; b.shT = 0;
    }
  }
  function isWatching(sc, a) {
    for (var i = 0; i < sc.watchers.length; i++) if (sc.watchers[i].person === a && sc.watchers[i].coneOn) return true;
    return false;
  }
  function stepCagey(sc, dt) {
    if (sc.suspState !== 'cagey' || SU().CAGEY_TURN === false) return;
    var p = G.state.player, cfg = C(), L0 = N(cfg.RISE, 13) - N(cfg.ACTION_LEAD, 1);
    for (var i = 0; i < sc.actors.length; i++) {
      var a = sc.actors[i], b = a.brain;
      if (!isWatching(sc, a)) a.dir = L().dirFromVector(a.x - p.x, a.y - p.y);   // backs to the camera (lookouts keep watching)
      if (typeof b.shT === 'number' && b.shT < SHADOW_STEP_T && sc.t < L0) {
        b.shT += dt;
        var u = Math.min(1, b.shT / SHADOW_STEP_T), e = u * u * (3 - 2 * u);
        var nx = b.shX0 + (b.shX1 - b.shX0) * e, ny = b.shY0 + (b.shY1 - b.shY0) * e;
        var spd = Math.sqrt((nx - a.x) * (nx - a.x) + (ny - a.y) * (ny - a.y)) / Math.max(1e-6, dt);
        a.moving = spd >= 6; if (a.moving) a.animT += spd * dt / N(cfg.NPC_SPEED, 55);
        a.x = nx; a.y = ny;
      }
    }
  }

  // ---------------------------------------------------------------- photo angle (06 decision 4): timing x M
  function angleResult(res, sc, p, cfg) {
    var a = PE.stealth ? PE.stealth.angleScore({ x: p.x, y: p.y, dir: p.dir, subjects: sc.actors, env: G.state.env, range: N(cfg.PHOTO_RANGE, 170) }) : null;
    var M = a ? a.M : 1, pts = Math.round(res.points * M);
    return { kind: 'scored', points: pts, label: L().gradeFor(pts, cfg), dt: res.dt, timing: res.points, angle: a,
      M: M, frame: a ? a.frame : 1, los: a ? a.los : 1, lit: a ? a.lit : 1, dist: a ? a.dist : 1, faces: a ? a.faces : 1 };
  }

  // ---------------------------------------------------------------- telemetry (QA O4)
  // One record per run; localStorage ring (key below, last TEL_MAX runs); exportTelemetry() -> JSON string.
  var TEL_KEY = 'hushmoney.night.telemetry', TEL_MAX = 30, tel = null;
  function r2(v) { return typeof v === 'number' ? Math.round(v * 100) / 100 : v; }
  function nowMs() { return (typeof Date !== 'undefined' && Date.now) ? Date.now() : null; }   // wall clock: telemetry only, never the sim
  function telStart(seed) { tel = { v: 1, seed: seed, startedAt: nowMs(), endedAt: null, cases: [], total: 0, duration: 0, aborted: 0, expired: 0, penalties: 0, quality: null, touch: null, saved: false }; }
  function telCase(sc) {
    var s = G.state;
    return { caseNo: s.caseNo, def: sc.def.id, spot: sc.spot.id, ambient: s.env.ambient, lamp: s.env.lampLevel, watchers: sc.watchers.length,
      relax: sc.relax, pathTiles: sc.pathTiles, path: [], tApproach: null, tShadow: 0, aborted: false, duration: 0, result: null, t0: r2(s.time), status: null, dur: 0, points: 0, timing: null, dt: null, angle: null,
      maxSusp: 0, seenS: 0, exposedS: 0, darkS: 0, inRangeS: 0, photos: 0, penalties: 0, walked: 0, uneasyAt: null, cageyAt: null };
  }
  function telResolve(sc, status) {
    var t = sc.tel, s = G.state;
    if (!t || t.status || !tel) return;
    var res = s.results[s.results.length - 1];
    t.status = status; t.dur = r2(s.time - t.t0); t.points = res ? res.points : 0;
    t.maxSusp = r2(t.maxSusp); t.seenS = r2(t.seenS); t.exposedS = r2(t.exposedS); t.darkS = r2(t.darkS); t.inRangeS = r2(t.inRangeS);
    t.walked = Math.round(t.walked); t.dt = r2(t.dt);
    if (t.angle) { var a = t.angle; t.angle = { M: r2(a.M), frame: r2(a.frame), los: r2(a.los), lit: r2(a.lit), dist: r2(a.dist), faces: r2(a.faces), m: a.meters }; }
    t.duration = t.dur; t.tShadow = t.darkS; t.aborted = status === 'aborted';
    t.result = { status: status, points: t.points, timing: t.timing, dt: t.dt, M: t.angle ? t.angle.M : null };
    if (status === 'aborted') tel.aborted++; else if (status === 'expired') tel.expired++;
    tel.penalties += t.penalties;
    tel.cases.push(t);
  }
  function telFinish() {
    var s = G.state;
    if (!tel || tel.saved) return;
    tel.total = s.score; tel.duration = r2(s.time); tel.endedAt = nowMs(); tel.quality = s.quality; tel.touch = !!(PE.touch && PE.touch.enabled);
    tel.saved = true;
    try {
      var ls = globalThis.localStorage;
      if (!ls) return;
      var arr = JSON.parse(ls.getItem(TEL_KEY) || '[]');
      if (!Array.isArray(arr)) arr = [];
      arr.push(tel);
      while (arr.length > TEL_MAX) arr.shift();
      ls.setItem(TEL_KEY, JSON.stringify(arr));
    } catch (e) { /* storage blocked: the run stays exportable via G.telemetry() */ }
  }
  G.telemetry = function () { return tel; };
  G.exportTelemetry = function () {
    var runs = [];
    try { var ls = globalThis.localStorage; runs = ls ? JSON.parse(ls.getItem(TEL_KEY) || '[]') : []; } catch (e) { runs = []; }
    if (!Array.isArray(runs)) runs = [];
    if (tel && !tel.saved) runs.push(tel);
    return JSON.stringify({ game: 'hush-money-night', v: 1, runs: runs }, null, 1);
  };
  G.clearTelemetry = function () { try { if (globalThis.localStorage) globalThis.localStorage.removeItem(TEL_KEY); } catch (e) { /* ignore */ } };

  // ---------------------------------------------------------------- queries / draw
  G.actors = function () {
    actorList.length = 0;
    var s = G.state;
    if (s && s.scandal) {
      for (var i = 0; i < s.scandal.actors.length; i++) actorList.push(s.scandal.actors[i]);
      var ex = s.scandal.extras;                         // staged extra watchers (lookouts, bodyguards)
      if (ex) for (var w = 0; w < ex.length; w++) actorList.push(ex[w]);
    }
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
  PE.nightGame = G;                                   // QA alias (night.html never loads v1 game.js)
})(globalThis.PE = globalThis.PE || {});
