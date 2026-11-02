// HUSH MONEY v2 "night" - night-data.js (owner: design-writer / systems & encounter designer)
// PE.NIGHT: tuning tables for the night prototype (docs/06). Pure data + tiny pure helpers, no DOM.
// Coded by: night-game.js / stealth.js (Yoni), light.js (Ilan), city.js night mode (Noa).
// Text rules as v1: ASCII, bubble lines <= 48 chars, tips <= 40 chars before {area}, fictional names.
//
// HOW THE TABLES ARE MEANT TO BE READ
// - CFG: merged over a COPY of PE.CFG by night-game (v1 PE.CFG is never mutated).
// - LINE_SHIFT: v1 def.lines were timed for RISE 11; night adds LINE_SHIFT (= 13 - 11) to every `at`,
//   so the cue line keeps landing 1.25 s before the peak. bust/expire lines are untouched.
// - CASES[i] = env for case i+1 ({ambient, ambientColor, lampLevel}) + `watchers` = how many entries of
//   STAGING[def].watchers are active (first N, capped at the list length).
// - STAGING[defId].watchers: priority-ordered. Each is EITHER an existing actor ({role: i}) OR an extra
//   person night-game spawns next to the actors ({name, look, prop, dx, dy}; px from the spot center).
//   scan.kind:
//     'fixed'  {face}                                 cone holds one direction
//     'sweep'  {face, arc, speed, hold}               centre dir +-arc/2 at speed deg/s, hold s at each end
//     'patrol' {pts:[[dx,dy]..], period, face:'move'} closed loop, period s per lap, looks along motion
//     'glance' {face, spans:[[t0,t1]..]}            actor busy with partner; cone ON only inside windows
//   face: 0..7 (v1 dir) | 'out' (away from the spot center) | 'in' (toward it) | 'role' (actor's dir) | 'move'.
//   Every active watcher also obeys DEAL_GLANCE (looks at the deal during the lean-in = the sneak gap).
// - LINES[defId]: {uneasy, cagey, abort}, each {r: roleIndex, s} or {w: watcherIndex, s} (exactly one).
//   Fired once per case when suspicion first crosses SUSPICION.UNEASY / CAGEY / ABORT.
(function (PE) {
  'use strict';

  var RISE = 13, FALL = 8, SHIFT = RISE - 11; // night timing (06 decision 7)

  PE.NIGHT = {
    // ------------------------------------------------------------ CFG overrides (decision 7)
    CFG: {
      RISE: RISE, FALL: FALL,
      SPAWN_MIN_TILES: 14, SPAWN_MAX_TILES: 28,
      LINE_SHIFT: SHIFT
    },

    // prototype district in tiles (decision 8), for reference / spawn filtering
    DISTRICT: { x0: 19, y0: 28, x1: 46, y1: 56 },

    // ------------------------------------------------------------ dusk -> night ramp (decision 7)
    // ambient 0..1 (>= DETECT.AMBIENT_LIT: everyone counts as lit), lampLevel 0..1 (lamps on from case 3)
    CASES: [
      { ambient: 0.90, ambientColor: '#FFC48A', lampLevel: 0.0, watchers: 1 }, // golden hour
      { ambient: 0.75, ambientColor: '#F29A6B', lampLevel: 0.0, watchers: 1 }, // sunset
      { ambient: 0.55, ambientColor: '#B07A98', lampLevel: 0.6, watchers: 1 }, // dusk, lamps flicker on
      { ambient: 0.35, ambientColor: '#5E5C8E', lampLevel: 0.85, watchers: 2 }, // blue hour: shadows matter
      { ambient: 0.20, ambientColor: '#363F72', lampLevel: 1.0, watchers: 2 }, // night
      { ambient: 0.12, ambientColor: '#1E2A55', lampLevel: 1.0, watchers: 2 } // deep night
    ],

    // ------------------------------------------------------------ detection (decision 5)
    DETECT: {
      CONE_DEG: 70, CONE_LEN: 175,  // watcher cone, LOS vs buildings + blocksSight cover. Dana M1 ruling: 175 (> the
                                    // 158 px photo standoff, so no shot can be taken from outside every cone)
      AMBIENT_LIT: 0.5,             // ambient >= this: anyone in cone + LOS is seen
      LIGHT_MIN: 0.35               // below it: seen only where lightAt(player) >= this (Dana: pillar, stays 0.35)
    },

    // ------------------------------------------------------------ suspicion (T2 starting values)
    SUSPICION: {
      MAX: 100,
      NEAR_PX: 60, FILL_NEAR: 40,   // per s while seen within NEAR_PX
      FAR_PX: 175, FILL_FAR: 20,    // per s while seen at NEAR_PX..FAR_PX (= CONE_LEN)
      SHUTTER_MULT: 2, SHUTTER_TIME: 0.5, // fill x2 for 0.5 s after any shutter press while seen
      BRIGHT_LIGHT: 0.6,            // watchers with brightMult fill x brightMult when lightAt(player) > this
      DECAY: 12, DECAY_DELAY: 1.0,  // per s, after 1 s unseen
      UNEASY: 35, CAGEY: 65, ABORT: 100,
      UNEASY_SCAN_MULT: 1.5,        // sweep/patrol speed x1.5 while >= UNEASY
      CAGEY_STEP_PX: 32,            // cagey: actors step 1 tile toward the darkest neighbour tile...
      CAGEY_TURN: true,             // ...and turn their backs to the player
      CAGEY_STYLE: 'whisper',       // bubble style for scandal lines while cagey (falls back to 'scandal')
      ABORT_FLEE_MULT: 1.3          // abort: actors leave like v1 busted (no chase), case MISSED, 0 points
    },

    // ------------------------------------------------------------ angle multiplier (decision 4)
    // points = timing points x M, M = BASE + SCALE * A, A = sum(W[k] * term_k), each term 0..1
    ANGLE: {
      BASE: 0.5, SCALE: 0.5,
      W: { frame: 0.35, los: 0.25, lit: 0.20, dist: 0.15, faces: 0.05 },
      PHOTO_CONE_DEG: 70,           // frame = share of actors inside the facing cone (length PHOTO_RANGE)
      LIT_NORM: 0.5,                // lit = clamp(mean subject light / LIT_NORM, 0, 1) (Dana, M1 step 1)
      DIST_FULL_MIN: 60, DIST_FULL_MAX: 120, DIST_ZERO: 170, // dist term: 1 in [60,120], linear to 0 at 170
      DIST_CLOSE_ZERO: 0,           // and linear 0 -> 1 from 0 to 60 px (too close = cropped)
      FACES_DEG: 90                 // faces = share of actors whose facing is within 90 deg of the camera
    },

    // ------------------------------------------------------------ night aiming (M1 step d)
    // At night only lit tiles can be seen, so lookouts watch the LIT part of the approach ring:
    //  - watcher 0: FIXED on the "obvious way in" = the first tile within PHOTO_RANGE-12 (with LOS to the spot)
    //    on the shortest walk from where the player is at spawn, if that tile is lit and visible to it;
    //  - other watchers (and watcher 0 when the obvious way in is dark): SWEEP centred on the ring sector
    //    (RING_MIN..RING_MAX px from the spot) with the most lit tiles it can see.
    // Dark approaches and dark shooting tiles stay safe: below LIGHT_MIN nothing is seen (AIM_LIT > litMin would aim
    // only at brighter tiles; tested 0.35: worse). STAGING[id].nightAim === false keeps the hand staging at night.
    // Dusk/mid cases (ambient >= AMBIENT_LIT) keep the hand staging below untouched.
    NIGHT_AIM: { ON: true, AIM_LIT: 0, RING_MIN: 100, STANDOFF: 158, BAND_PAD: 16, NEAR_TILES: 6, NEAR_W: 4, CONE_USE: 0.85, STEP_DEG: 5 },

    // ------------------------------------------------------------ lean-in glance (decision 7)
    // times relative to RISE: every active watcher turns to the deal (faces the spot center) from
    // RISE + START for its own dur (default DUR, clamped to [DUR_MIN, DUR_MAX]). Cone stays on, but points
    // inward: that is the sneak gap. Glance-kind actors simply have their cone off during it.
    DEAL_GLANCE: { START: -1.0, DUR: 1.2, DUR_MIN: 1.0, DUR_MAX: 1.5 },

    // ------------------------------------------------------------ staging (5 prototype scandals)
    STAGING: {
      affair: { // no guard: the lovers check their surroundings (look-arounds at v1 t=6 and at the cue)
        nightAim: false, // M1 d: lovers keep their glances at night (fixed lover cones trapped the shadow bot at n_blvd_w)
        watchers: [
          { role: 0, scan: { kind: 'glance', face: 'out', spans: [[6 + SHIFT, 7.2 + SHIFT], [9.4 + SHIFT, 10.0 + SHIFT]] } },
          { role: 1, scan: { kind: 'glance', face: 'out', spans: [[6.4 + SHIFT, 7.4 + SHIFT], [9.6 + SHIFT, 10.0 + SHIFT]] } }
        ]
      },
      drug_deal: { // lookout Moti at the alley mouth, facing out, slow sweep; Kobi checks his shoulder
        watchers: [
          { role: 2, scan: { kind: 'sweep', face: 'out', arc: 90, speed: 20, hold: 1.0 }, dealGlance: 1.5 },
          { role: 0, scan: { kind: 'glance', face: 'out', spans: [[3.0 + SHIFT, 4.0 + SHIFT], [7.0 + SHIFT, 8.0 + SHIFT]] } }
        ]
      },
      bribe: { // bodyguard behind the councilman, facing the street, wide sweep, hates bright light
        watchers: [
          { name: 'Yossi', look: 'suit', prop: 'phone', dx: -38, dy: 6,
            scan: { kind: 'sweep', face: 'out', arc: 120, speed: 25, hold: 0.5 }, brightMult: 2, dealGlance: 1.0 },
          { role: 0, scan: { kind: 'glance', face: 'out', spans: [[5.0 + SHIFT, 6.0 + SHIFT], [8.5 + SHIFT, 9.3 + SHIFT]] } }
        ]
      },
      protest: { // the aide is the moving threat; Gadi faces his crowd (back = blind side)
        watchers: [
          { name: 'Noam', look: 'assistant', prop: 'clipboard', dx: -32, dy: -32,
            scan: { kind: 'patrol', face: 'move', period: 8, pts: [[-32, -32], [32, -32], [32, 32], [-32, 32]] }, dealGlance: 1.2 },
          { role: 0, scan: { kind: 'fixed', face: 'role' }, dealGlance: 1.0 }
        ]
      },
      match_fix: { // bookie's nephew at the kiosk corner; Zion glances around
        watchers: [
          { name: 'Eli', look: 'hoodie', prop: 'phone', dx: 0, dy: 34,
            scan: { kind: 'sweep', face: 'out', arc: 90, speed: 30, hold: 0.8 }, dealGlance: 1.3 },
          { role: 1, scan: { kind: 'glance', face: 'out', spans: [[4.0 + SHIFT, 5.0 + SHIFT], [8.0 + SHIFT, 8.8 + SHIFT]] } }
        ]
      }
    },

    // ------------------------------------------------------------ night tips ({area} = spot.name)
    TIPS: {
      affair: 'Avner + "trainer" sneaking at {area}.',
      drug_deal: 'Kobi + lookout, "vitamins" at {area}.',
      bribe: 'Shaul, builder + bodyguard at {area}.',
      protest: 'Gadi\'s candlelit "rally" at {area}.',
      match_fix: 'Benny + bookie + nephew at {area}.'
    },

    // ------------------------------------------------------------ nervous lines (uneasy / cagey / abort)
    LINES: {
      affair: {
        uneasy: { r: 1, s: 'Avner... is someone standing in the dark?' },
        cagey: { r: 0, s: 'Shh. Whisper. Turn your face to the tree.' },
        abort: { r: 0, s: 'Forget it. My wife has spies. Taxi!' }
      },
      drug_deal: {
        uneasy: { r: 2, s: 'Kobi. The coat guy. Third time tonight.' },
        cagey: { r: 0, s: 'Into the shadow. Talk quiet, achi.' },
        abort: { r: 2, s: 'Abort! Abort! Everybody walk normal!' }
      },
      bribe: {
        uneasy: { w: 0, s: 'Boss. Trench coat. At night. Weird.' },
        cagey: { r: 0, s: 'Lower your voice. Envelope stays inside.' },
        abort: { r: 0, s: 'Meeting over. I was never here. Yossi!' }
      },
      protest: {
        uneasy: { w: 0, s: 'Gadi, a camera! ...Not one of ours.' },
        cagey: { r: 0, s: 'Okay, quieter anger. Whisper-chant, yalla.' },
        abort: { r: 0, s: 'Rally cancelled! Due to... weather!' }
      },
      match_fix: {
        uneasy: { w: 0, s: 'Uncle Zion, coat guy is looking at us.' },
        cagey: { r: 1, s: 'Turn around, champ. Talk to the fridge.' },
        abort: { r: 1, s: 'No deal. Go home. Practice your miss.' }
      }
    },

    // ------------------------------------------------------------ pure helpers (headless)
    // env for case number 1..6 (clamped)
    envForCase: function (caseNo) {
      var a = PE.NIGHT.CASES, i = Math.max(0, Math.min(a.length - 1, (caseNo | 0) - 1)), c = a[i];
      return { ambient: c.ambient, ambientColor: c.ambientColor, lampLevel: c.lampLevel, watchers: c.watchers };
    },
    // active watcher entries for a def at a case (first N); [] for unknown defs.
    // Night cases (ambient < AMBIENT_LIT): entries are re-aimed at the live spot by aimNight (see NIGHT_AIM).
    watchersFor: function (defId, caseNo) {
      var st = PE.NIGHT.STAGING[defId];
      if (!st || !st.watchers) return [];
      var env = PE.NIGHT.envForCase(caseNo), list = st.watchers.slice(0, env.watchers);
      if (!PE.NIGHT.NIGHT_AIM.ON || st.nightAim === false || env.ambient >= PE.NIGHT.DETECT.AMBIENT_LIT) return list;
      var aimed = null;
      try { aimed = aimNight(defId, list); } catch (e) { aimed = null; }
      return aimed || list;
    },
    // suspicion fill rate per second for a seen player at distance d px (0 if beyond the cone length)
    fillRate: function (d, opts) {
      var S = PE.NIGHT.SUSPICION, r = d <= S.NEAR_PX ? S.FILL_NEAR : (d <= S.FAR_PX ? S.FILL_FAR : 0);
      if (opts && opts.shutter) r *= S.SHUTTER_MULT;
      if (opts && opts.bright && opts.brightMult) r *= opts.brightMult;
      return r;
    },
    // 'calm' | 'uneasy' | 'cagey' | 'abort'
    stateFor: function (s) {
      var S = PE.NIGHT.SUSPICION;
      return s >= S.ABORT ? 'abort' : s >= S.CAGEY ? 'cagey' : s >= S.UNEASY ? 'uneasy' : 'calm';
    },
    // M from the five 0..1 terms (missing terms count 0)
    angleM: function (t) {
      var A = PE.NIGHT.ANGLE, W = A.W, a = 0;
      t = t || {};
      for (var k in W) { var v = +t[k]; if (v > 0) a += W[k] * (v > 1 ? 1 : v); }
      return A.BASE + A.SCALE * a;
    },
    // dist term 0..1 from camera-to-group-center px
    distTerm: function (d) {
      var A = PE.NIGHT.ANGLE;
      if (!(d >= 0)) return 0;
      if (d < A.DIST_FULL_MIN) return Math.max(0, (d - A.DIST_CLOSE_ZERO) / (A.DIST_FULL_MIN - A.DIST_CLOSE_ZERO));
      if (d <= A.DIST_FULL_MAX) return 1;
      return Math.max(0, (A.DIST_ZERO - d) / (A.DIST_ZERO - A.DIST_FULL_MAX));
    },
    // polaroid breakdown (<= 48 chars), e.g. "FRAME 3/3 LOS OK LIT 80% 9m FACE 1/3 x0.91"
    breakdown: function (r) {
      r = r || {};
      var n = r.n | 0, s = 'FRAME ' + (r.inFrame | 0) + '/' + n + ' LOS ' + (r.los >= 1 ? 'OK' : Math.round((r.los || 0) * 100) + '%') +
        ' LIT ' + Math.round((r.lit || 0) * 100) + '% ' + Math.round((r.d || 0) / 16) + 'm FACE ' + (r.facing | 0) + '/' + n +
        ' x' + (typeof r.M === 'number' ? r.M.toFixed(2) : '1.00');
      return s.length > 48 ? s.slice(0, 48) : s;
    }
  };

  // ------------------------------------------------------------ night aiming helper (pure; reads at call time)
  // Reads PE.nightGame.state (scandal.spot, player, env; night-game sets them before calling watchersFor),
  // PE.city.grid, PE.stealth.lightAt/los/params, PE.logic.bfsTiles. Returns copies of the entries, or null.
  function aimNight(defId, list) {
    var G = PE.nightGame || PE.ngame, s = G && G.state, sc = s && s.scandal, St = PE.stealth, city = PE.city || {}, grid = city.grid;
    if (!sc || !sc.spot || !St || !St.lightAt || !St.los || !grid || !PE.logic || !PE.logic.bfsTiles) return null;
    var A = PE.NIGHT.NIGHT_AIM, sp = sc.spot, env = s.env || PE.NIGHT.envForCase(s.caseNo), T = (PE.CFG && PE.CFG.TILE) || 32;
    var P = St.params ? St.params() : { fov: 70, range: 150, litMin: 0.35 }, half = P.fov * Math.PI / 360;
    var def = null, i, j, k, tx, ty, x, y;
    for (i = 0; i < (PE.SCANDALS || []).length; i++) if (PE.SCANDALS[i].id === defId) def = PE.SCANDALS[i];
    var roles = (def && def.roles) || [];
    function free(px, py) { var qx = Math.floor(px / T), qy = Math.floor(py / T); return qx >= 0 && qy >= 0 && qx < grid.w && qy < grid.h && !grid.solid[qy * grid.w + qx]; }
    // aim only at CLEARLY lit tiles (>= AIM_LIT, Noa's dark line); dim tiles (litMin..AIM_LIT) are still
    // detectable but never aimed at, so the dark pockets and dark shooting tiles stay unwatched
    var aimLit = Math.max(P.litMin, A.AIM_LIT || 0);
    function lit(px, py) { return St.lightAt(px, py, env) >= aimLit; }
    // standing band: lit walkable tiles RING_MIN..STANDOFF+BAND_PAD px from the spot with LOS to it (where a
    // photographer waits). Weight NEAR_W if close to the player's shortest walk (the obvious way in), else 1.
    var p = s.player, bd = p ? PE.logic.bfsTiles(grid, Math.floor(p.x / T), Math.floor(p.y / T), 90) : null;
    var band = [], bmin = 1e9, r0 = Math.ceil((A.STANDOFF + A.BAND_PAD) / T) + 1, stx = Math.floor(sp.x / T), sty = Math.floor(sp.y / T);
    for (ty = sty - r0; ty <= sty + r0; ty++) for (tx = stx - r0; tx <= stx + r0; tx++) {
      x = tx * T + T / 2; y = ty * T + T / 2;
      var d = Math.sqrt((x - sp.x) * (x - sp.x) + (y - sp.y) * (y - sp.y));
      if (d < A.RING_MIN || d > A.STANDOFF + A.BAND_PAD || !free(x, y) || !lit(x, y)) continue;
      if (!St.los({ x: x, y: y }, { x: sp.x, y: sp.y })) continue;
      var b = bd ? bd[ty * grid.w + tx] : -1;
      band.push({ x: x, y: y, b: b, w: 1 });
      if (b >= 0 && d <= A.STANDOFF && b < bmin) bmin = b;
    }
    for (k = 0; k < band.length; k++) if (band[k].b >= 0 && band[k].b <= bmin + A.NEAR_TILES) band[k].w = A.NEAR_W;
    var OFF = [[0, 0], [-10, -10], [10, -10], [-10, 10], [10, 10]];
    function seesTile(wx, wy, q) {           // >= 3 of 5 sample points in range + LOS (robust to tile-edge stops)
      var n = 0;
      for (var o = 0; o < OFF.length; o++) {
        var qx = q.x + OFF[o][0], qy = q.y + OFF[o][1], dx = qx - wx, dy = qy - wy;
        if (dx * dx + dy * dy <= (P.range - 8) * (P.range - 8) && St.los({ x: wx, y: wy }, { x: qx, y: qy })) n++;
      }
      return n >= 3;
    }
    function toDir(a) { var dd = (a * 180 / Math.PI + 90) / 45; dd %= 8; return dd < 0 ? dd + 8 : dd; } // inverse of night-game dirAngle
    function angDiff(a, b2) { var dd = a - b2; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; return dd; }
    var covered = new Uint8Array(band.length), out = [], cone = half * A.CONE_USE;
    for (i = 0; i < list.length; i++) {
      var e = list[i], wx, wy;
      if (typeof e.role === 'number') { var ro = roles[e.role] || {}; wx = sp.x + (ro.dx || 0); wy = sp.y + (ro.dy || 0); }
      else { wx = sp.x + (e.dx || 0); wy = sp.y + (e.dy || 0); }
      var c = Object.assign({}, e), vis = [];
      for (k = 0; k < band.length; k++) if (!covered[k] && seesTile(wx, wy, band[k])) vis.push([k, Math.atan2(band[k].y - wy, band[k].x - wx)]);
      if (vis.length) {
        var bestA = 0, bestN = -1;
        for (var deg = 0; deg < 360; deg += A.STEP_DEG) {
          var a = deg * Math.PI / 180, n = 0;
          for (j = 0; j < vis.length; j++) if (Math.abs(angDiff(vis[j][1], a)) <= cone) n += band[vis[j][0]].w;
          if (n > bestN) { bestN = n; bestA = a; }
        }
        if (bestN > 0) {
          c.scan = { kind: 'fixed', face: toDir(bestA) };
          for (j = 0; j < vis.length; j++) if (Math.abs(angDiff(vis[j][1], bestA)) <= cone) covered[vis[j][0]] = 1;
        }
      }
      out.push(c);
    }
    // last aim, read-only debug info for QA traces / tuning
    PE.NIGHT.lastAim = { spot: sp.id, def: defId, band: band.length, near: band.filter(function (q) { return q.w > 1; }).length,
      covered: Array.prototype.reduce.call(covered, function (s2, v) { return s2 + v; }, 0),
      scans: out.map(function (o) { return o.scan.kind + ':' + (typeof o.scan.face === 'number' ? o.scan.face.toFixed(2) : o.scan.face); }) };
    return out;
  }

  // ------------------------------------------------------------ stealth.js key names (pinned by eng-lead)
  // stealth.js reads PE.NIGHT.DETECT.{fov,range,ambientAll,litMin}, PE.NIGHT.SUSP and PE.NIGHT.M.
  // Derived from the tables above so there is ONE source of truth.
  var N = PE.NIGHT, D = N.DETECT, S = N.SUSPICION, A = N.ANGLE;
  var PHOTO_RANGE = (PE.CFG && PE.CFG.PHOTO_RANGE) || 170;
  D.fov = D.CONE_DEG; D.range = D.CONE_LEN; D.ambientAll = D.AMBIENT_LIT; D.litMin = D.LIGHT_MIN;
  N.SUSP = {
    seenRate: S.FILL_FAR, nearPx: S.NEAR_PX, nearMult: S.FILL_NEAR / S.FILL_FAR, // 40/s near, 20/s far
    farPx: S.FAR_PX, farMult: 1,                    // beyond FAR_PX the cone ends anyway
    sprintMult: 1.4,                                // eng-lead's addition, kept
    photoBump: (S.SHUTTER_MULT - 1) * S.FILL_NEAR * S.SHUTTER_TIME, // = 20: one shutter press while seen
    decay: S.DECAY, decayDelay: S.DECAY_DELAY,
    uneasy: S.UNEASY, cagey: S.CAGEY, abort: S.ABORT
  };
  N.M = {
    w: A.W, fov: A.PHOTO_CONE_DEG, litNorm: A.LIT_NORM,
    distNear: A.DIST_FULL_MAX / PHOTO_RANGE, distMin: 0 // dist 1 up to 120 px, linear to 0 at PHOTO_RANGE
  };
})(globalThis.PE = globalThis.PE || {});
