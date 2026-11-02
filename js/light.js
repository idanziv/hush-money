/* HUSH MONEY v2 night - js/light.js  (owner: gfx-eng, Ilan Shapira)
 * Lights, darkness, character shadows and vision cones for night.html (docs/06 decisions 3 and 9). Canvas 2D.
 *
 * LOOK (Dana's ruling: clarity over realism; Noa directs the palette)
 *   - Visual brightness of the world = lerp(0.35, 1.0, frac), frac = clamp((env.ambient - 0.12) / 0.78).
 *     Case 1 (ambient 0.90) renders full, case 6 (0.12) sits on Noa's 35% floor. env.ambient still drives DETECTION in stealth.js.
 *   - The darkness is a VEIL, not a multiply: one half-res (full) / quarter-res (lite) RGBA buffer holding the per-case
 *     env.ambientColor at alpha ~ (1 - brightness), lamp light punches holes in it (lit = clear) and adds a low-alpha warm/cool
 *     wash of the light's own colour. The buffer is upscaled NEAREST with source-over (measured ~7x cheaper than bilinear multiply on a CPU canvas).
 *   - A lamp contribution L (0..1, identical to stealth.lightAt) opens the veil by min(1, L / HOLE). HOLE = 0.7, so the gameplay
 *     line L = 0.35 is the half-lit edge you can see: lit-enough-to-be-seen reads as lit.
 *   - Falloff is i * (1 - smoothstep(d / r)) from stealth.js (PE.stealth.falloff if exported, else an identical local copy).
 *   - Occluders = BUILDING + KIOSK tiles + cover with blocksSight (same as stealth.js). Soft shadows: 3 jittered bake samples in 'full'.
 *   - Lamps (and every light) scale with env.lampLevel and switch on from light.fromCase vs env.caseNo, exactly like stealth.js.
 *
 * API (pinned)
 *   light.init(city, quality)                          bake chunk lightmaps from city.lights / city.cover; quality 'full' | 'lite'
 *   light.drawShadows(ctx, cam, people, env)           blob shadows: sun-directional at dusk, radial away from the lamps at night
 *   light.draw(ctx, cam, timeSec, env, dynLights, quality)   the darkening pass (call after the world, before the emissive layer)
 *        dynLights: npc.vehicles ({x, y, dir 0..7, type:'car'|'scooter'} -> headlights) and/or generic
 *                   {x, y, r, color, intensity, angle?} (angle in radians present = cone, else round)
 *   light.drawCones(ctx, cam, cones)                   flat cones; cones = [{pts: [ox,oy,x0,y0,...] world px (stealth.conePoly), seen, alert}]
 *   light.sampleAt(x, y, env) -> 0..1                  LAMP light the bake shows at a world point (headless; ambient excluded) - QA agreement hook
 *   light.brightnessAt(x, y, env) -> 0..1              full visual brightness at a point (ambient remap + lamp hole)
 *   light.grade(env) -> {frac, brightness, veilAlpha, veilColor, lamp, caseNo}
 *   light.defaultQuality() -> 'lite' on coarse pointers or ?lite=1, 'full' otherwise (?lite=0 forces full)
 *   light.stats = {quality, bakeMs, bytes, chunks, lights, occluders, lastMs, bufW, bufH}
 * env = {ambient, ambientColor, lampLevel, caseNo?}. No game state is read or written. No DOM at load.
 */
(function (PE) {
  'use strict';

  var light = PE.light = PE.light || {};
  var TS = 32, CPX = 512;
  var HOLE = 0.7, TINT_K = 0.24, VEIL_MIN = 0.06, VEIL_SLOPE = 0.908, COL_MIN = 0.30, B_FLOOR = 0.35, AMB_LO = 0.12, AMB_HI = 0.90;
  var SUN_A = 1.15;                                       // dusk shadow direction (screen radians: south, a little east)
  var QUALITY = { full: { s: 0.5, ns: 3, maxDyn: 6 }, lite: { s: 0.25, ns: 1, maxDyn: 3 } };

  function num(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function falloffLocal(d, r) { if (d >= r) return 0; var u = d / r; u = u < 0 ? 0 : u; return 1 - u * u * (3 - 2 * u); }
  function F(d, r) { var s = PE.stealth; return (s && typeof s.falloff === 'function') ? s.falloff(d, r) : falloffLocal(d, r); }
  function hexRgb(h) { var m = /^#?([0-9a-fA-F]{6})$/.exec(String(h)); if (!m) return null; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  // ---------------------------------------------------------------- state
  var st = {
    ready: false, gfx: false, city: null, q: 'full', S: 0.5, LW: 480, LH: 270, CHL: 256, NCX: 6, NCY: 4,
    lights: [], occ: [], sets: [], M: null, mctx: null, V: null, vctx: null, tmp: null, tint: Object.create(null), tintN: 0
  };
  light.stats = { quality: 'full', bakeMs: 0, bytes: 0, chunks: 0, lights: 0, occluders: 0, lastMs: 0, bufW: 0, bufH: 0 };

  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  // ---------------------------------------------------------------- occluders and lights (headless data)
  function gather(city) {
    var i, x, y, T = city.T || {}, g = city.grid;
    st.occ = [];
    var bl = city.buildings || [];
    for (i = 0; i < bl.length; i++) st.occ.push([bl[i].x * TS, bl[i].y * TS, (bl[i].x + bl[i].w) * TS, (bl[i].y + bl[i].h) * TS]);
    if (g && g.tile && typeof T.KIOSK === 'number') {
      for (y = 0; y < g.h; y++) for (x = 0; x < g.w; x++) if (g.tile[y * g.w + x] === T.KIOSK) st.occ.push([x * TS, y * TS, (x + 1) * TS, (y + 1) * TS]);
    }
    var cv = city.cover || [];
    for (i = 0; i < cv.length; i++) if (cv[i] && cv[i].blocksSight) st.occ.push([cv[i].x * TS, cv[i].y * TS, (cv[i].x + (cv[i].w || 1)) * TS, (cv[i].y + (cv[i].h || 1)) * TS]);
    st.lights = [];
    var ls = city.lights || [];
    for (i = 0; i < ls.length; i++) {
      var s = ls[i], L = { x: s.x, y: s.y, r: num(s.r, 96), i: num(s.intensity, 1), rgb: hexRgb(s.color) || [255, 220, 160], from: num(s.fromCase, 0), kind: s.kind, near: [] };
      for (var k = 0; k < st.occ.length; k++) {
        var o = st.occ[k];
        if (o[2] > L.x - L.r && o[0] < L.x + L.r && o[3] > L.y - L.r && o[1] < L.y + L.r && !(L.x > o[0] && L.x < o[2] && L.y > o[1] && L.y < o[3])) L.near.push(o);
      }
      st.lights.push(L);
    }
    var froms = [];
    for (i = 0; i < st.lights.length; i++) if (froms.indexOf(st.lights[i].from) < 0) froms.push(st.lights[i].from);
    froms.sort(function (a, b) { return a - b; });
    st.sets = froms.map(function (v) { return { from: v, ch: [] }; });
    st.NCX = Math.ceil(num(city.W, 96) * TS / CPX); st.NCY = Math.ceil(num(city.H, 64) * TS / CPX);
  }

  // segment (lx,ly)->(px,py) against a rect, shrunk a hair so grazing a wall face does not count
  function hits(o, lx, ly, px, py) {
    var x0 = o[0] + 0.01, y0 = o[1] + 0.01, x1 = o[2] - 0.01, y1 = o[3] - 0.01;
    if (px > x0 && px < x1 && py > y0 && py < y1) return true;
    var t0 = 0, t1 = 1, dx = px - lx, dy = py - ly, a, b, t;
    if (Math.abs(dx) < 1e-9) { if (lx < x0 || lx > x1) return false; }
    else { a = (x0 - lx) / dx; b = (x1 - lx) / dx; if (a > b) { t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
    if (Math.abs(dy) < 1e-9) { if (ly < y0 || ly > y1) return false; }
    else { a = (y0 - ly) / dy; b = (y1 - ly) / dy; if (a > b) { t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false; }
    return true;
  }
  function blocked(L, x, y) { for (var k = 0; k < L.near.length; k++) if (hits(L.near[k], L.x, L.y, x, y)) return true; return false; }

  // ---------------------------------------------------------------- grade (ambient remap, cached)
  var gc = { key: '', g: null };
  function grade(env) {
    env = env || {};
    var amb = num(env.ambient, 1), lamp = clamp01(num(env.lampLevel, 0)), cn = typeof env.caseNo === 'number' ? env.caseNo : 99;
    var key = amb + '|' + env.ambientColor + '|' + lamp + '|' + cn;
    if (gc.key === key && gc.g) return gc.g;
    var frac = clamp01((amb - AMB_LO) / (AMB_HI - AMB_LO)), B = B_FLOOR + (1 - B_FLOOR) * frac;
    var rgb = hexRgb(env.ambientColor);
    if (!rgb && PE.art && typeof PE.art.nightGrade === 'function') rgb = hexRgb(PE.art.nightGrade(amb).color);
    if (!rgb) rgb = [255, 255, 255];
    var va = VEIL_MIN + (1 - B) * VEIL_SLOPE, cs = COL_MIN + (1 - COL_MIN) * frac;
    var vc = 'rgb(' + Math.round(rgb[0] * cs) + ',' + Math.round(rgb[1] * cs) + ',' + Math.round(rgb[2] * cs) + ')';
    gc.key = key;
    gc.g = { frac: frac, brightness: B, veilAlpha: va, veilColor: vc, veil: 'rgba(' + Math.round(rgb[0] * cs) + ',' + Math.round(rgb[1] * cs) + ',' + Math.round(rgb[2] * cs) + ',' + va.toFixed(3) + ')', lamp: lamp, caseNo: cn };
    return gc.g;
  }
  light.grade = function (env) { var g = grade(env); return { frac: g.frac, brightness: g.brightness, veilAlpha: g.veilAlpha, veilColor: g.veilColor, lamp: g.lamp, caseNo: g.caseNo }; };

  // ---------------------------------------------------------------- headless sampling (QA hook)
  // LAMP light at (x, y): sum of active lights i * falloff over unoccluded segments, x lampLevel, clamped to 1.
  light.sampleAt = function (x, y, env) {
    if (!st.ready) return 0;
    var lamp = clamp01(num(env && env.lampLevel, 0)), cn = env && typeof env.caseNo === 'number' ? env.caseNo : 99, sum = 0;
    if (lamp <= 0) return 0;
    for (var j = 0; j < st.lights.length; j++) {
      var L = st.lights[j];
      if (L.from > cn) continue;
      var dx = x - L.x, dy = y - L.y, d2 = dx * dx + dy * dy;
      if (d2 >= L.r * L.r) continue;
      if (blocked(L, x, y)) continue;
      sum += L.i * F(Math.sqrt(d2), L.r);
    }
    sum *= lamp;
    return sum > 1 ? 1 : sum;
  };
  // Visual brightness: ambient remap, opened toward 1 by the lamp hole (what the player sees at that point).
  light.brightnessAt = function (x, y, env) {
    var B = grade(env).brightness, L = light.sampleAt(x, y, env);
    return B + (1 - B) * Math.min(1, L / HOLE);
  };

  // ---------------------------------------------------------------- quality
  light.defaultQuality = function () {
    var q = (typeof location !== 'undefined' && location.search) || '';
    if (/[?&]lite=1/.test(q)) return 'lite';
    if (/[?&]lite=0/.test(q)) return 'full';
    try { if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'lite'; } catch (e) { /* headless */ }
    return 'full';
  };

  // ---------------------------------------------------------------- bake
  function addShadow(t, o, lx, ly, far) {
    t.rect(o[0], o[1], o[2] - o[0], o[3] - o[1]);
    var px = [o[0], o[2], o[2], o[0]], py = [o[1], o[1], o[3], o[3]];
    for (var a = 0; a < 4; a++) {
      var b = (a + 1) & 3, ax = px[a], ay = py[a], bx = px[b], by = py[b];
      var da = Math.sqrt((ax - lx) * (ax - lx) + (ay - ly) * (ay - ly)) || 1, db = Math.sqrt((bx - lx) * (bx - lx) + (by - ly) * (by - ly)) || 1;
      var ex = ax + (ax - lx) / da * far, ey = ay + (ay - ly) / da * far, fx = bx + (bx - lx) / db * far, fy = by + (by - ly) / db * far;
      var area = (ax * by - bx * ay) + (bx * fy - fx * by) + (fx * ey - ex * fy) + (ex * ay - ax * ey);   // keep winding positive: the nonzero union never cancels
      t.moveTo(ax, ay);
      if (area >= 0) { t.lineTo(bx, by); t.lineTo(fx, fy); t.lineTo(ex, ey); } else { t.lineTo(ex, ey); t.lineTo(fx, fy); t.lineTo(bx, by); }
      t.closePath();
    }
  }

  function bake() {
    var t0 = now(), S = st.S, CHL = st.CHL, rmax = 0, j, s, k, m, bytes = 0, chunks = 0;
    for (j = 0; j < st.lights.length; j++) rmax = Math.max(rmax, st.lights[j].r);
    if (!st.lights.length) { light.stats.bakeMs = now() - t0; return; }
    var tsz = Math.ceil(2 * rmax * S) + 2, c = tsz / 2;
    st.tmp = mk(tsz, tsz);
    var t = st.tmp.getContext('2d'), ns = QUALITY[st.q].ns;
    for (j = 0; j < st.lights.length; j++) {
      var L = st.lights[j];
      for (s = 0; s < ns; s++) {
        var an = s * Math.PI * 2 / ns, lx = L.x + (ns > 1 ? Math.cos(an) * 5 : 0), ly = L.y + (ns > 1 ? Math.sin(an) * 5 : 0);
        t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1; t.clearRect(0, 0, tsz, tsz);
        var gr = t.createRadialGradient(c, c, 0, c, c, L.r * S), col = L.rgb[0] + ',' + L.rgb[1] + ',' + L.rgb[2];
        for (k = 0; k <= 11; k++) { var u = k / 11; gr.addColorStop(u, 'rgba(' + col + ',' + clamp01(L.i * F(u * L.r, L.r) / HOLE).toFixed(3) + ')'); }
        t.fillStyle = gr; t.fillRect(0, 0, tsz, tsz);
        if (L.near.length) {
          t.setTransform(S, 0, 0, S, c - lx * S, c - ly * S);
          t.globalCompositeOperation = 'destination-out'; t.fillStyle = '#000';
          t.beginPath(); for (m = 0; m < L.near.length; m++) addShadow(t, L.near[m], lx, ly, L.r * 2); t.fill();
        }
        var gx0 = lx * S - c, gy0 = ly * S - c;
        for (var cy = Math.max(0, Math.floor(gy0 / CHL)); cy <= Math.min(st.NCY - 1, Math.floor((gy0 + tsz) / CHL)); cy++) {
          for (var cx = Math.max(0, Math.floor(gx0 / CHL)); cx <= Math.min(st.NCX - 1, Math.floor((gx0 + tsz) / CHL)); cx++) {
            for (k = 0; k < st.sets.length; k++) {
              if (L.from > st.sets[k].from) continue;                // set k holds every light with fromCase <= its value
              var idx = cy * st.NCX + cx, ch = st.sets[k].ch[idx];
              if (!ch) { ch = st.sets[k].ch[idx] = mk(CHL, CHL); chunks++; bytes += CHL * CHL * 4; }
              var cc = ch.getContext('2d');
              cc.globalCompositeOperation = 'lighter'; cc.globalAlpha = 1 / ns;
              cc.drawImage(st.tmp, Math.round(gx0 - cx * CHL), Math.round(gy0 - cy * CHL));
            }
          }
        }
      }
    }
    st.tmp = null;
    try { for (k = 0; k < st.sets.length; k++) for (j = 0; j < st.sets[k].ch.length; j++) if (st.sets[k].ch[j]) st.sets[k].ch[j].getContext('2d').getImageData(0, 0, 1, 1); } catch (e) { /* flush only */ }
    light.stats.bakeMs = now() - t0; light.stats.bytes = bytes + st.LW * st.LH * 8; light.stats.chunks = chunks;
  }

  light.init = function (city, quality) {
    city = city || PE.city || {};
    var q = QUALITY[quality] ? quality : 'full', P = QUALITY[q];
    st.city = city; st.q = q; st.S = P.s; st.LW = Math.round(960 * P.s); st.LH = Math.round(540 * P.s); st.CHL = CPX * P.s;
    st.tint = Object.create(null); st.tintN = 0; gc.key = ''; st.gfx = false;
    gather(city);
    st.ready = true;
    var stt = light.stats;
    stt.quality = q; stt.lights = st.lights.length; stt.occluders = st.occ.length; stt.bufW = st.LW; stt.bufH = st.LH; stt.bytes = 0; stt.chunks = 0; stt.bakeMs = 0;
    if (typeof document !== 'undefined') {
      try {
        st.M = mk(st.LW, st.LH); st.mctx = st.M.getContext('2d');
        st.V = mk(st.LW, st.LH); st.vctx = st.V.getContext('2d');
        bake();
        st.gfx = true;
      } catch (e) { st.gfx = false; if (typeof console !== 'undefined' && console.error) console.error(e); }
    }
    return light;
  };

  // ---------------------------------------------------------------- dynamic lights (headlights etc.)
  function tinted(kind, color) {
    var key = kind + '|' + color, c = st.tint[key];
    if (c) return c;
    var spr = PE.art && PE.art.lightSprite && PE.art.lightSprite(kind);
    if (!spr) return null;
    if (st.tintN >= 16) { st.tint = Object.create(null); st.tintN = 0; }
    c = mk(spr.width, spr.height);
    var g = c.getContext('2d'); g.drawImage(spr, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    st.tint[key] = c; st.tintN++;
    return c;
  }
  var DX8 = [0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071], DY8 = [-1, -0.7071, 0, 0.7071, 1, 0.7071, 0, -0.7071];
  function dyn1(m, cam, x, y, r, color, inten, ang, S) {
    var sx = (x - cam.x) * S, sy = (y - cam.y) * S, kind = ang === null ? 'round' : 'cone', spr = tinted(kind, color);
    if (!spr || inten <= 0) return;
    m.globalAlpha = inten > 1 ? 1 : inten;
    if (ang === null) { var d = 2 * r * S; m.setTransform(1, 0, 0, 1, 0, 0); m.drawImage(spr, sx - d / 2, sy - d / 2, d, d); }
    else { var sc = r * S / 128, co = Math.cos(ang) * sc, si = Math.sin(ang) * sc; m.setTransform(co, si, -si, co, sx, sy); m.drawImage(spr, 0, -32); }
  }

  // ---------------------------------------------------------------- the darkening pass
  // The ONE place that knows how the finished light buffer reaches the screen: swap this (and build the buffer
  // with WebGL2) if the Pixel gate fails. Nearest upscale + source-over of the RGBA veil.
  function composite(ctx, buf, w, h) {
    var sm = ctx.imageSmoothingEnabled;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, w, h);
    ctx.imageSmoothingEnabled = sm;
  }

  light.draw = function (ctx, cam, timeSec, env, dynLights, quality) {
    if (!st.ready || !st.gfx || !ctx || !env || !cam) return;
    if (quality && quality !== st.q && QUALITY[quality]) light.init(st.city, quality);
    if (!st.gfx) return;
    var t0 = now(), g = grade(env), S = st.S, CHL = st.CHL, m = st.mctx, v = st.vctx, LW = st.LW, LH = st.LH, i, j;
    var w = cam.w || 960, h = cam.h || 540, camX = Math.round(cam.x), camY = Math.round(cam.y);
    // 1. light accumulation (lamp colour x strength, alpha = how much the veil opens)
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.globalAlpha = 1; m.clearRect(0, 0, LW, LH);
    m.globalCompositeOperation = 'lighter';
    var lamp = g.lamp;
    if (lamp > 0.005 && st.sets.length) {
      var set = null;
      for (i = 0; i < st.sets.length; i++) if (st.sets[i].from <= g.caseNo) set = st.sets[i];
      if (set) {
        var t = num(timeSec, 0), a = lamp < 0.999 ? lamp * (1 - 0.06 * (0.5 + 0.5 * Math.sin(t * 23) * Math.sin(t * 7.3))) : lamp;   // lamps flicker on while ramping
        var gx = Math.round(camX * S), gy = Math.round(camY * S);
        var cx0 = Math.max(0, Math.floor(camX / CPX)), cx1 = Math.min(st.NCX - 1, Math.floor((camX + w - 1) / CPX));
        var cy0 = Math.max(0, Math.floor(camY / CPX)), cy1 = Math.min(st.NCY - 1, Math.floor((camY + h - 1) / CPX));
        m.globalAlpha = a;
        for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
          var ch = set.ch[cy * st.NCX + cx];
          if (ch) m.drawImage(ch, cx * CHL - gx, cy * CHL - gy);
        }
      }
    }
    if (dynLights && dynLights.length) {
      var dk = 0.25 + 0.75 * (1 - g.frac), maxDyn = QUALITY[st.q].maxDyn, nd = 0;
      for (j = 0; j < dynLights.length && nd < maxDyn; j++) {
        var d = dynLights[j];
        if (!d || d.x < camX - 160 || d.x > camX + w + 160 || d.y < camY - 160 || d.y > camY + h + 160) continue;
        if (d.type === 'car' || d.type === 'scooter') {
          var dr = ((num(d.dir, 2) | 0) & 7), car = d.type === 'car', fx = d.x + DX8[dr] * 10, fy = d.y + DY8[dr] * 10;
          dyn1(m, cam, fx, fy, car ? 128 : 84, '#FFF1C8', (car ? 0.85 : 0.65) * dk, Math.atan2(DY8[dr], DX8[dr]), S);
          dyn1(m, cam, d.x, d.y, 30, '#FFF1C8', 0.45 * dk, null, S);
        } else {
          dyn1(m, cam, d.x, d.y, num(d.r, 64), d.color || '#FFF1C8', num(d.intensity, 1) * dk, typeof d.angle === 'number' ? d.angle : null, S);
        }
        nd++;
      }
    }
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalAlpha = 1; m.globalCompositeOperation = 'source-over';
    // 2. veil: ambientColor at alpha (1 - brightness), opened by the light mask, plus a low-alpha wash of the light colours
    v.setTransform(1, 0, 0, 1, 0, 0); v.globalAlpha = 1;
    v.globalCompositeOperation = 'copy'; v.fillStyle = g.veil; v.fillRect(0, 0, LW, LH);
    v.globalCompositeOperation = 'destination-out'; v.drawImage(st.M, 0, 0);
    v.globalCompositeOperation = 'source-over'; v.globalAlpha = TINT_K; v.drawImage(st.M, 0, 0);
    v.globalAlpha = 1;
    // 3. to screen
    composite(ctx, st.V, w, h);
    light.stats.lastMs = now() - t0;
  };

  // ---------------------------------------------------------------- character shadows (drawn before the darkness)
  light.drawShadows = function (ctx, cam, people, env) {
    var art = PE.art;
    if (!ctx || !cam || !people || !art || typeof art.drawBlobShadow !== 'function') return;
    var g = grade(env), lamp = g.lamp, cn = g.caseNo, sunW = g.frac, sx0 = Math.cos(SUN_A) * sunW, sy0 = Math.sin(SUN_A) * sunW;
    var ls = st.lights, nl = lamp > 0.005 ? ls.length : 0, x0 = cam.x - 48, y0 = cam.y - 48, x1 = cam.x + (cam.w || 960) + 48, y1 = cam.y + (cam.h || 540) + 48;
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      if (!p || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      var vx = sx0, vy = sy0;
      for (var j = 0; j < nl; j++) {
        var L = ls[j];
        if (L.from > cn) continue;
        var dx = p.x - L.x, dy = p.y - L.y;
        if (dx > L.r || dx < -L.r || dy > L.r || dy < -L.r) continue;
        var d2 = dx * dx + dy * dy; if (d2 >= L.r * L.r || d2 < 1) continue;
        var d = Math.sqrt(d2), wgt = L.i * F(d, L.r) * lamp;
        if (wgt > 0.01) { vx += dx / d * wgt; vy += dy / d * wgt; }
      }
      var mag = Math.sqrt(vx * vx + vy * vy);
      if (mag < 0.06) art.drawBlobShadow(ctx, p.x - cam.x, p.y - cam.y, SUN_A, 1, 0.3);
      else { var k = mag > 1 ? 1 : mag; art.drawBlobShadow(ctx, p.x - cam.x, p.y - cam.y, Math.atan2(vy, vx), 1 + 1.7 * k, 0.32 + 0.3 * k); }
    }
  };

  // ---------------------------------------------------------------- vision cones (emissive layer: never dimmed)
  // Flat Monaco-style fan + crisp rim. Colour by state: calm pale yellow, alert amber/orange, seen red. Never green.
  light.drawCones = function (ctx, cam, cones) {
    if (!ctx || !cam || !cones) return;
    var pa = ctx.globalAlpha, camX = Math.round(cam.x), camY = Math.round(cam.y);
    for (var i = 0; i < cones.length; i++) {
      var c = cones[i], p = c && (c.pts || c.poly);
      if (!p || p.length < 6) continue;
      if (p[0] < camX - 240 || p[0] > camX + (cam.w || 960) + 240 || p[1] < camY - 240 || p[1] > camY + (cam.h || 540) + 240) continue;
      var al = clamp01(num(c.alert, 0)), fill, rim, fa;
      if (c.seen) { fill = '#FF4A3D'; rim = '#FF8A7A'; fa = 0.32; }
      else if (al >= 0.65) { fill = '#FF7A3D'; rim = '#FFB58A'; fa = 0.26; }
      else if (al >= 0.35) { fill = '#FFC23D'; rim = '#FFE08A'; fa = 0.22; }
      else { fill = '#FFE08A'; rim = '#FFF3C4'; fa = 0.16 + 0.12 * al; }
      ctx.beginPath(); ctx.moveTo(Math.round(p[0] - camX), Math.round(p[1] - camY));
      for (var k = 2; k + 1 < p.length; k += 2) ctx.lineTo(Math.round(p[k] - camX), Math.round(p[k + 1] - camY));
      ctx.closePath();
      ctx.globalAlpha = pa * fa; ctx.fillStyle = fill; ctx.fill();
      ctx.globalAlpha = pa * 0.5; ctx.strokeStyle = rim; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.globalAlpha = pa;
  };
})(globalThis.PE = globalThis.PE || {});
