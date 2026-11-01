// HUSH MONEY - ui.js (owner: eng-lead)
// HUD, world overlay (bubble layout, proximity ring, viewfinder brackets, chevron), polaroid capture,
// title/pause/results screens (spec 3, 5, 10, 11, 14.10). DOM only inside init() and draw functions.
// Color rule (spec 5): GREEN (#39FF14) only on scandal elements: arrow, chevron, brackets, scandal bubble.
(function (PE) {
  'use strict';

  var U = {};
  var FONT = 'bold 11px Verdana, sans-serif';
  var GREEN = '#39FF14', CYAN = '#4FD8FF', AMBER = '#FFB000', GOLD = '#FFD23F', RED = '#FF4A3D';
  var PLATE = 'rgba(10,8,14,0.6)';
  var CACHE_CAP = 200;
  var TOP_STRIP = 30;                         // bubbles never enter the top 30 px
  var CAM_BOX_W = 74, CAM_BOX_H = 76;         // camera-icon box, bottom-right
  var CAM_BOX_W_TOUCH = 100;                  // touch: wider 16 px IN RANGE / NEAR label
  var CAM_LABEL_TOUCH = 'bold 16px Verdana, sans-serif';
  var SNAP_R = 58;                            // touch SNAP button radius 54 + 4 px margin

  var mctx = null;                 // measuring context
  var bubbleCache = new Map();     // key -> canvas (cap 200)
  var spriteCache = new Map();     // text sprites (cap 200)
  var camIcons = null, fixed = null;
  var titleCanvas = null, pauseCanvas = null;
  var st = {
    gs: null, pagerText: '', pagerT0: -99, popup: null, flashT0: -99,
    polaroids: [], resultsCanvas: null, resultsN: -1, resultsScore: NaN, best: null, newBest: false, savedFor: null
  };
  // memoised HUD sprites (rebuilt only when the value changes)
  var memoScore = { v: NaN, s: null }, memoCase = { v: NaN, s: null }, memoMeters = { v: NaN, s: null };
  var ltScore = null, ltCase = null, ltMeters = null;       // v1.2 perf: live text slots (created in init)
  // layout scratch (reused, no per-frame allocation)
  var ambientTmp = [], rx = [], ry = [], rw = [], rh = [], nRects = 0;
  var nearRing = null, polaroidPool = [];
  var sb = { x: 0, y: 0, w: 0, h: 0, on: false };   // placed scandal bubble rect
  var place = { x: 0, y: 0 };

  function C() { return PE.CFG || {}; }
  function N(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }
  function TXT() { return PE.TEXT || {}; }
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    var x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    return c;
  }
  function capSet(map, key, val) {
    map.set(key, val);
    if (map.size > CACHE_CAP) map.delete(map.keys().next().value);
    return val;
  }
  function measure(text, font) { mctx.font = font; return mctx.measureText(text).width; }

  function wrap(text, font, maxW) {           // cache-build time only
    var words = String(text).split(' '), lines = [], cur = '';
    mctx.font = font;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      while (mctx.measureText(w).width > maxW && w.length > 1) {   // hard-break very long words
        var cut = w.length - 1;
        while (cut > 1 && mctx.measureText(w.slice(0, cut)).width > maxW) cut--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, cut)); w = w.slice(cut);
      }
      var tryL = cur ? cur + ' ' + w : w;
      if (mctx.measureText(tryL).width <= maxW) cur = tryL;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (!lines.length) lines.push('');
    return lines;
  }

  function roundRect(x, left, top, w, h, r) {
    x.beginPath();
    x.moveTo(left + r, top); x.lineTo(left + w - r, top); x.quadraticCurveTo(left + w, top, left + w, top + r);
    x.lineTo(left + w, top + h - r); x.quadraticCurveTo(left + w, top + h, left + w - r, top + h);
    x.lineTo(left + r, top + h); x.quadraticCurveTo(left, top + h, left, top + h - r);
    x.lineTo(left, top + r); x.quadraticCurveTo(left, top, left + r, top);
    x.closePath();
  }

  // ---------------------------------------------------------------- sprites
  function fontPx(font) { var m = /(\d+)px/.exec(font); return m ? parseInt(m[1], 10) : 11; }

  function textSprite(text, font, color, outline) {      // call only on value change (see changed())
    var key = font + '|' + color + '|' + (outline || '') + '|' + text;
    var c = spriteCache.get(key);
    if (c) return c;
    var w = measure(text, font) + 6, h = fontPx(font) + 8;
    c = newCanvas(w, h);
    var x = c.getContext('2d');
    x.font = font; x.textBaseline = 'middle'; x.textAlign = 'left';
    if (outline) { x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = outline; x.strokeText(text, 3, h / 2); }
    x.fillStyle = color; x.fillText(text, 3, h / 2);
    return capSet(spriteCache, key, c);
  }
  function changed(slot, value) { if (slot.v === value && slot.s) return false; slot.v = value; return true; }

  var pinnedCache = new Map();     // v1.2 perf: prebuilt scandal + player line bubbles (bounded by data, <= 200)
  function buildBubble(text, style, name, pin) {
    var key = style + '\u0001' + (name || '') + '\u0001' + text;
    var c = pinnedCache.get(key) || bubbleCache.get(key);
    if (c) return c;
    var pad = 5, lh = 13, lines = wrap(text, FONT, 180), maxW = 0, i;
    for (i = 0; i < lines.length; i++) maxW = Math.max(maxW, measure(lines[i], FONT));
    var whisper = style === 'whisper', scandal = style === 'scandal' || whisper, tagH = (scandal && name) ? 15 : 0;   // v2 night: 'whisper' = dashed scandal bubble
    var tagW = tagH ? measure(name, FONT) + 10 : 0;
    var bw = Math.ceil(Math.max(maxW + pad * 2, 24)), bh = lines.length * lh + pad * 2 - 1;
    var W = Math.max(bw, tagW) + 4, H = tagH + bh + 10;
    c = newCanvas(W, H);
    var x = c.getContext('2d');
    var left = Math.floor((W - bw) / 2), top = tagH + 2;
    var border = scandal ? GREEN : (style === 'player' ? AMBER : '#222222');
    x.fillStyle = '#FFFFFF';
    roundRect(x, left, top, bw, bh, 5); x.fill();
    x.lineWidth = scandal ? 2 : 1.5; x.strokeStyle = border; if (whisper) x.setLineDash([4, 3]); x.stroke(); x.setLineDash([]);
    var cx = Math.floor(W / 2);
    x.beginPath(); x.moveTo(cx - 5, top + bh - 1); x.lineTo(cx, top + bh + 7); x.lineTo(cx + 5, top + bh - 1); x.closePath();
    x.fillStyle = '#FFFFFF'; x.fill();
    x.beginPath(); x.moveTo(cx - 5, top + bh); x.lineTo(cx, top + bh + 7); x.lineTo(cx + 5, top + bh);
    x.strokeStyle = border; x.stroke();
    x.font = FONT; x.textBaseline = 'top'; x.fillStyle = whisper ? '#555555' : '#141414';
    for (i = 0; i < lines.length; i++) x.fillText(lines[i], left + pad, top + pad + i * lh);
    if (tagH) {
      x.fillStyle = GREEN; x.fillRect(left, 0, tagW, tagH - 1);
      x.fillStyle = '#0A1A06'; x.fillText(name, left + 5, 1);
    }
    c._ox = cx;  // anchor x
    if (pin && pinnedCache.size < CACHE_CAP) { pinnedCache.set(key, c); return c; }
    return capSet(bubbleCache, key, c);
  }

  // v1.2 perf: build every known line's bubble ahead of time, ONE per idle frame (title screen, gaps), so lines
  // and quips never create a canvas mid-scene. Scandal (role name) + player lines are pinned; ambient go to the LRU.
  var preQ = null, preI = 0;
  function buildPreQueue() {
    preQ = [];
    var defs = PE.SCANDALS || [], i, j;
    for (i = 0; i < defs.length; i++) {
      var d = defs[i], roles = d.roles || [], all = [].concat(d.lines || [], d.bust || [], d.expire || []);
      for (j = 0; j < all.length; j++) if (all[j] && all[j].s) preQ.push(['scandal', (roles[all[j].r | 0] || roles[0] || {}).name, all[j].s, true]);
    }
    var L = PE.LINES || {};
    for (var cat in L) {
      var player = cat.indexOf('player_') === 0, arr = L[cat] || [];
      for (j = 0; j < arr.length; j++) preQ.push([player ? 'player' : 'ambient', undefined, arr[j], player]);
    }
  }
  U.idleBuild = function () {
    if (!mctx) return false;
    if (!preQ) buildPreQueue();
    if (preI >= preQ.length) return false;
    var e = preQ[preI++];
    if (e[2]) buildBubble(String(e[2]), e[0], e[1], e[3]);
    return true;
  };
  // Sprite cached on the bubble object itself: no per-frame key strings.
  function bubbleSprite(b) {
    if (b._spr && b._t === b.text && b._s === b.style && b._n === b.name) return b._spr;
    b._t = b.text; b._s = b.style; b._n = b.name;
    b._spr = buildBubble(String(b.text), b.style || 'ambient', b.name);
    return b._spr;
  }

  function makeCamIcon(color) {
    var c = newCanvas(44, 32), x = c.getContext('2d');
    x.fillStyle = '#000000'; roundRect(x, 1, 7, 42, 24, 4); x.fill();
    x.fillStyle = color; roundRect(x, 3, 9, 38, 20, 3); x.fill();
    x.fillRect(8, 4, 10, 6);
    x.fillStyle = '#111111'; x.beginPath(); x.arc(22, 19, 8, 0, Math.PI * 2); x.fill();
    x.fillStyle = color; x.beginPath(); x.arc(22, 19, 5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#111111'; x.beginPath(); x.arc(22, 19, 3, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#FFFFFF'; x.fillRect(33, 12, 4, 3);
    return c;
  }

  // ---------------------------------------------------------------- init
  U.init = function (canvas) {
    U.canvas = canvas;
    mctx = newCanvas(4, 4).getContext('2d');
    camIcons = { grey: makeCamIcon('#8A8A8A'), amber: makeCamIcon(AMBER), cyan: makeCamIcon(CYAN) };
    fixed = {
      inRange: textSprite('IN RANGE', touchMenus() ? CAM_LABEL_TOUCH : FONT, CYAN, '#000000'),
      near: textSprite('NEAR', touchMenus() ? CAM_LABEL_TOUCH : FONT, AMBER, '#000000'),
      muted: textSprite('MUTED (M)', FONT, '#BBBBBB', '#000000'),
      start: textSprite(TXT().start || 'Press Enter', 'bold 22px Verdana, sans-serif', '#FFFFFF', '#000000'),
      hint: null
    };
    loadSettings();
    ltScore = liveSlot(160); ltCase = liveSlot(140); ltMeters = liveSlot(64);
    try { var b = parseInt(globalThis.localStorage.getItem('hushmoney.best'), 10); st.best = isNaN(b) ? null : b; }
    catch (e) { st.best = null; }
  };

  function resetFor(gs) {
    st.gs = gs; st.pagerT0 = -99; st.popup = null; st.flashT0 = -99;
    st.polaroids = []; st.resultsCanvas = null; st.resultsN = -1; st.newBest = false; st.savedFor = null;
  }
  function ensure(gs) { if (gs !== st.gs) resetFor(gs); }

  function fmtDt(dt) {
    if (typeof dt !== 'number') return '';
    var a = Math.abs(dt);
    if (a < 0.05) return 'dead on';
    return a.toFixed(2) + 's ' + (dt < 0 ? 'early' : 'late');
  }
  function gradeColor(points) {
    if (points >= 1500) return GOLD;
    if (points >= 750) return '#FFFFFF';
    if (points >= 400) return '#FFE08A';
    if (points >= 150) return '#CFCFCF';
    return '#9A9A9A';
  }

  // v1.2 perf: "live" text = one reused canvas per HUD slot, redrawn in place when its text changes (no
  // createElement per score / meter / popup). Same pixels as textSprite: w = text + 6, h = font px + 8, text at (3, h/2).
  function liveSlot(minW) { return { c: null, width: 0, height: 0, text: null, font: null, color: null, minW: minW }; }
  function liveText(lt, text, font, color) {
    if (lt.c && lt.text === text && lt.font === font && lt.color === color) return lt;
    var w = Math.ceil(measure(text, font) + 6), h = fontPx(font) + 8;
    if (!lt.c || lt.c.width < w || lt.c.height < h) lt.c = newCanvas(Math.max(w, lt.minW), Math.max(h, lt.c ? lt.c.height : 0));
    var x = lt.c.getContext('2d');
    x.clearRect(0, 0, lt.c.width, lt.c.height);
    x.font = font; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = '#000000'; x.strokeText(text, 3, h / 2);
    x.fillStyle = color; x.fillText(text, 3, h / 2);
    lt.width = w; lt.height = h; lt.text = text; lt.font = font; lt.color = color;
    return lt;
  }
  function blit(ctx, lt, x, y, dw, dh) {          // draw a live slot (or a plain sprite) at x, y
    if (!lt.c) { if (dw) ctx.drawImage(lt, x, y, dw, dh); else ctx.drawImage(lt, x, y); return; }
    ctx.drawImage(lt.c, 0, 0, lt.width, lt.height, x, y, dw || lt.width, dh || lt.height);
  }
  var popA = liveSlot(320), popB = liveSlot(240), popC = liveSlot(260);
  function makePopup(a, b, c, color, t0) {
    return {
      a: liveText(popA, a, 'bold 22px Verdana, sans-serif', color),
      b: liveText(popB, b, 'bold 15px Verdana, sans-serif', color),
      c: c ? liveText(popC, c, FONT, '#FFFFFF') : null, t0: t0
    };
  }

  function consumeEvents(gs) {
    var ev = (PE.game && PE.game.frameEvents) || [];
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (!e) continue;
      if (e.type === 'spawn') {
        st.pagerText = e.tip || (gs.scandal && gs.scandal.tip) || (e.def && (e.def.tip || e.def.title)) || 'New tip.';
        st.pagerT0 = gs.time;
      } else if (e.type === 'photo') {
        st.flashT0 = gs.time;
        var r = e.result || {};
        if (r.kind === 'scored') st.popup = makePopup(r.label, '+' + PE.logic.formatShekels(r.points), fmtDt(r.dt) + (typeof r.M === 'number' ? '   angle x' + r.M.toFixed(2) : ''), gradeColor(r.points), gs.time);
        else st.popup = makePopup(r.label || 'WASTED FILM', PE.logic.formatShekels(r.points), r.kind === 'too_far' ? 'get closer' : 'no scandal here', RED, gs.time);
      } else if (e.type === 'resolve' && e.status === 'aborted') {          // v2 night
        st.popup = makePopup('BLOWN COVER', 'they spotted you', '', RED, gs.time);
      } else if (e.type === 'resolve' && e.status === 'expired') {
        st.popup = makePopup('MISSED', 'the story walked away', '', '#B0B0B0', gs.time);
      }
    }
  }

  // ---------------------------------------------------------------- bubble layout (spec 10)
  function overlapsAny(x, y, w, h) {
    for (var i = 0; i < nRects; i++) {
      if (x < rx[i] + rw[i] && x + w > rx[i] && y < ry[i] + rh[i] && y + h > ry[i]) return i;
    }
    return -1;
  }
  function addRect(x, y, w, h) { rx[nRects] = x; ry[nRects] = y; rw[nRects] = w; rh[nRects] = h; nRects++; }

  // Clamp a bubble rect into the view, below the top strip and out of the camera-icon box. Writes `place`.
  function clampPlace(x, y, w, h, cam) {
    var W = cam.w, H = cam.h;
    if (x < 2) x = 2; else if (x + w > W - 2) x = W - 2 - w;
    if (y + h > H - 2) y = H - 2 - h;
    if (y < TOP_STRIP + 2) y = TOP_STRIP + 2;
    if (x + w > W - (touchMenus() ? CAM_BOX_W_TOUCH : CAM_BOX_W) && y + h > H - CAM_BOX_H) y = H - CAM_BOX_H - h - 2;   // above the camera icon
    place.x = x | 0; place.y = y | 0;
  }

  function anchor(p, spr, cam) {
    clampPlace(Math.round(p.x - cam.x) - spr._ox, Math.round(p.y - cam.y) - 30 - spr.height, spr.width, spr.height, cam);
  }

  function drawSpr(ctx, b, spr, x, y) {
    var fade = N(b.ttl, 1) < 0.25 ? Math.max(0, N(b.ttl, 1) / 0.25) : 1;
    if (fade < 1) ctx.globalAlpha = fade;
    ctx.drawImage(spr, x, y);
    if (fade < 1) ctx.globalAlpha = 1;
  }

  // Ambient / player bubble: placed; on overlap nudged up once above the blocker; else skipped (ambient).
  function placeNudged(ctx, p, cam, force) {
    var b = p.bubble, spr = bubbleSprite(b), w = spr.width, h = spr.height;
    anchor(p, spr, cam);
    var hit = overlapsAny(place.x, place.y, w, h);
    if (hit >= 0) {
      var nx = place.x;
      clampPlace(nx, ry[hit] - h - 2, w, h, cam);
      if (place.y + h > ry[hit] || overlapsAny(place.x, place.y, w, h) >= 0) {
        if (!force) return false;
        anchor(p, spr, cam);   // player bubble always shows, at its own anchor
      }
    }
    addRect(place.x, place.y, w, h);
    drawSpr(ctx, b, spr, place.x, place.y);
    return true;
  }

  function byDist(a, b) { return a._bd - b._bd; }
  function isScandalStyle(st) { return st === 'scandal' || st === 'whisper'; }   // v1 never emits 'whisper'

  // ---------------------------------------------------------------- v1.2 settings: speech filter
  // PE.settings.speech = 'all' | 'marks' | 'off' (localStorage 'hushmoney.speech', try/catch; default 'all').
  var SPEECH_MODES = ['all', 'marks', 'off'], SPEECH_KEY = 'hushmoney.speech';
  PE.settings = PE.settings || {};
  if (SPEECH_MODES.indexOf(PE.settings.speech) < 0) PE.settings.speech = 'all';
  function speechMode() { var v = PE.settings && PE.settings.speech; return SPEECH_MODES.indexOf(v) >= 0 ? v : 'all'; }
  function loadSettings() {
    try { var v = globalThis.localStorage && globalThis.localStorage.getItem(SPEECH_KEY); if (SPEECH_MODES.indexOf(v) >= 0) PE.settings.speech = v; }
    catch (e) { /* storage blocked: keep the default */ }
  }
  U.setSpeech = function (v) {
    if (SPEECH_MODES.indexOf(v) < 0) return speechMode();
    PE.settings.speech = v;
    try { if (globalThis.localStorage) globalThis.localStorage.setItem(SPEECH_KEY, v); } catch (e) { /* not persisted */ }
    return v;
  };
  U.cycleSpeech = function () { return U.setSpeech(SPEECH_MODES[(SPEECH_MODES.indexOf(speechMode()) + 1) % SPEECH_MODES.length]); };

  function layoutBubbles(ctx, cam, gs, people) {
    var i, q, p = gs.player;
    nRects = 0; sb.on = false;
    // HUD boxes at the top (pager, case-1 hint): no bubble may enter them
    var pt = gs.time - st.pagerT0, hudBottom = 0;
    if (pt >= 0 && pt < 5 && st.pagerText) hudBottom = 4 + getPager().height;
    if (gs.caseNo === 1 && gs.scandal && gs.scandal.status === 'live') hudBottom = hintY(gs) + hintSprite().height;
    var hudW = 460;
    if (touchMenus() && hudBottom > 0) {
      if (pt >= 0 && pt < 5 && st.pagerText) hudW = Math.max(hudW, getPager().width + 4);
      if (gs.caseNo === 1 && gs.scandal && gs.scandal.status === 'live') hudW = Math.max(hudW, hintSprite().width + 4);
    }
    var hudL = Math.round(cam.w / 2 - hudW / 2);
    // v1.2 speech option: 'off' draws no bubble, 'marks' only the scandal (mark) bubbles. Hidden bubbles build no
    // canvas and add no layout rect, so the arrow / chevron / no-go logic ignores them.
    var speech = speechMode();
    if (speech === 'off') return;
    // 1. scandal bubble(s) first (normally exactly one); never hidden: shifted below the HUD box if needed
    for (i = 0; i < people.length; i++) {
      q = people[i];
      if (!q || !q.bubble || !isScandalStyle(q.bubble.style) || !q.bubble.text) continue;
      var spr = bubbleSprite(q.bubble);
      anchor(q, spr, cam);
      if (hudBottom > 0 && place.y < hudBottom + 2 && place.x < hudL + hudW && place.x + spr.width > hudL) {
        clampPlace(place.x, hudBottom + 4, spr.width, spr.height, cam);
      }
      addRect(place.x, place.y, spr.width, spr.height);
      if (!sb.on) { sb.on = true; sb.x = place.x; sb.y = place.y; sb.w = spr.width; sb.h = spr.height; }
      drawSpr(ctx, q.bubble, spr, place.x, place.y);
    }
    if (speech === 'marks') return;
    if (hudBottom > 0) addRect(hudL, 0, hudW, hudBottom + 2);
    // v1.1.3 touch: SNAP button (touch.js SHUT_X/Y/R = W-112, H-142, 54) is a no-go box for ambient bubbles
    if (touchMenus()) addRect(cam.w - 112 - SNAP_R, cam.h - 142 - SNAP_R, SNAP_R * 2, SNAP_R * 2);
    // 2. the player's quip
    if (p && p.bubble && p.bubble.text) placeNudged(ctx, p, cam, true);
    // 3. ambient + vehicle bubbles, nearest first, capped
    var maxAmb = N(C().MAX_AMBIENT_BUBBLES, 3);
    ambientTmp.length = 0;
    for (i = 0; i < people.length; i++) {
      q = people[i];
      if (!q || q === p || !q.bubble || !q.bubble.text || isScandalStyle(q.bubble.style) || q.kind === 'player') continue;
      q._bd = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      ambientTmp.push(q);
    }
    var vs = PE.npc && PE.npc.vehicles;
    if (vs) {
      for (i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v || !v.bubble || !v.bubble.text || v.x < cam.x - 64 || v.y < cam.y - 64 || v.x > cam.x + cam.w + 64 || v.y > cam.y + cam.h + 64) continue;
        v._bd = Math.abs(v.x - p.x) + Math.abs(v.y - p.y);
        ambientTmp.push(v);
      }
    }
    if (ambientTmp.length > 1) ambientTmp.sort(byDist);
    var drawn = 0;
    for (i = 0; i < ambientTmp.length && drawn < maxAmb; i++) if (placeNudged(ctx, ambientTmp[i], cam, false)) drawn++;
  }

  // ---------------------------------------------------------------- world overlay
  function drawBrackets(ctx, cam, sc) {
    var a = sc.actors, n = a.length;
    if (!n) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < n; i++) {
      if (a[i].x < x0) x0 = a[i].x; if (a[i].x > x1) x1 = a[i].x;
      if (a[i].y < y0) y0 = a[i].y; if (a[i].y > y1) y1 = a[i].y;
    }
    // sprite box around feet points (24x24 cells, feet at bottom center), then + 14 px
    var l = Math.round(x0 - cam.x) - 12 - 14, r = Math.round(x1 - cam.x) + 12 + 14;
    var t = Math.round(y0 - cam.y) - 24 - 14, b = Math.round(y1 - cam.y) + 4 + 14, k = 9;
    ctx.strokeStyle = GREEN; ctx.lineWidth = 2; ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(l, t + k); ctx.lineTo(l, t); ctx.lineTo(l + k, t);
    ctx.moveTo(r - k, t); ctx.lineTo(r, t); ctx.lineTo(r, t + k);
    ctx.moveTo(r, b - k); ctx.lineTo(r, b); ctx.lineTo(r - k, b);
    ctx.moveTo(l + k, b); ctx.lineTo(l, b); ctx.lineTo(l, b - k);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawChevron(ctx, cam, gs, sc) {
    var a = PE.logic.edgeArrow(cam, sc.focus.x, sc.focus.y, 24, 28);
    if (!a.onScreen) return;
    var cx = Math.round(a.x), fy = Math.round(a.y);
    var top = fy;
    for (var i = 0; i < sc.actors.length; i++) { var hy = Math.round(sc.actors[i].y - cam.y) - 26; if (hy < top) top = hy; }
    var cy = Math.min(fy - 28, top - 8);
    cy -= Math.round(Math.abs(Math.sin(gs.time * 5)) * 4);          // bob upward only
    // never overlap the scandal bubble: hop above it
    if (sb.on && cx + 10 > sb.x && cx - 10 < sb.x + sb.w && cy + 6 > sb.y && cy - 8 < sb.y + sb.h) cy = sb.y - 10;
    if (cy < TOP_STRIP + 8) return;
    ctx.globalAlpha = 0.4 + 0.6 * N(sc.intensity, 0);
    ctx.strokeStyle = '#000000'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - 8, cy - 5); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx + 8, cy - 5); ctx.stroke();
    ctx.strokeStyle = GREEN; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 8, cy - 5); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx + 8, cy - 5); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  U.drawWorldOverlay = function (ctx, cam, gs, people) {
    if (!mctx || !gs) return;
    ensure(gs);
    var p = gs.player, sc = gs.scandal;
    var live = sc && sc.status === 'live';
    var px = Math.round(p.x - cam.x), py = Math.round(p.y - cam.y) - 8;
    if (live) {
      var R = N(C().PHOTO_RANGE, 170);
      if (sc.prox === 1) {
        // v1.2 perf: dashed ring baked once into a sprite (same stroke, alpha applied at blit)
        if (!nearRing || nearRing._r !== R) {
          nearRing = newCanvas(2 * R + 8, 2 * R + 8); nearRing._r = R;
          var nx = nearRing.getContext('2d');
          nx.strokeStyle = '#FFFFFF'; nx.lineWidth = 2; nx.setLineDash([8, 8]);
          nx.beginPath(); nx.arc(R + 4, R + 4, R, 0, Math.PI * 2); nx.stroke();
        }
        ctx.globalAlpha = 0.4;
        ctx.drawImage(nearRing, px - R - 4, py - R - 4);
      } else if (sc.prox === 2) {
        ctx.globalAlpha = 0.45; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        drawBrackets(ctx, cam, sc);
      }
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
    layoutBubbles(ctx, cam, gs, people || []);
    if (live) drawChevron(ctx, cam, gs, sc);
  };

  // ---------------------------------------------------------------- polaroid
  U.capture = function (canvas, gs, cam) {
    if (!gs || !canvas) return;
    ensure(gs);
    var ev = (PE.game && PE.game.frameEvents) || [];
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (!e || e.type !== 'photo' || !e.result || e.result.kind !== 'scored') continue;
      var W = canvas.width, H = canvas.height;
      // 120x90 world px around the focus (biased up so heads are in frame), scaled to 160x120
      var sx = Math.round(e.x - cam.x - 60), sy = Math.round(e.y - cam.y - 57);
      sx = Math.max(0, Math.min(W - 120, sx)); sy = Math.max(0, Math.min(H - 90, sy));
      // v1.2 perf: one pooled canvas per case slot, reused across runs (results of the finished run are rebuilt fresh)
      var slot = Math.max(0, gs.results.length - 1);
      var pc = polaroidPool[slot] || (polaroidPool[slot] = newCanvas(160, 120));
      var px = pc.getContext('2d');
      px.clearRect(0, 0, 160, 120);
      px.drawImage(canvas, sx, sy, 120, 90, 0, 0, 160, 120);
      st.polaroids[slot] = pc;
      st.resultsCanvas = null;
    }
  };

  // ---------------------------------------------------------------- HUD
  var pagerCanvases = {};                 // v1.2 perf: one canvas per (line count, touch) - redrawn per tip
  function pagerSprite(text) {
    var c;
    // v1.1.2 touch: 18 px tip (12 CSS px at 740x360), wrap budget PAGER_TOUCH_TEXT_W px, max 3 lines
    var big = touchMenus(), tf = big ? 'bold ' + MENU_TOUCH_PX + 'px Verdana, sans-serif' : FONT;
    var lh = big ? 22 : 14, top = big ? 28 : 23;
    var lines = wrap(text, tf, big ? PAGER_TOUCH_TEXT_W : 400).slice(0, 3);
    var w = big ? PAGER_TOUCH_TEXT_W + 28 : 440, h = top + 3 + lines.length * lh;
    var pk = lines.length + (big ? 't' : 'd');
    c = pagerCanvases[pk] || (pagerCanvases[pk] = newCanvas(w + 8, h + 8));
    var x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = PLATE; roundRect(x, 0, 0, w + 8, h + 8, 8); x.fill();
    x.fillStyle = '#111111'; roundRect(x, 4, 4, w, h, 6); x.fill();
    x.fillStyle = '#9DB86A'; roundRect(x, 7, 7, w - 6, h - 6, 4); x.fill();
    x.fillStyle = '#2B3A1E'; x.font = big ? 'bold 12px Verdana, sans-serif' : 'bold 9px Verdana, sans-serif'; x.textBaseline = 'top';
    x.fillText('PAGER  ))) NEW TIP', 14, 10);
    x.font = tf;
    for (var i = 0; i < lines.length; i++) x.fillText(lines[i], 14, top + i * lh);
    return c;
  }

  function getPager() {
    if (!st.pagerSpr || st.pagerSprFor !== st.pagerText) { st.pagerSpr = pagerSprite(st.pagerText); st.pagerSprFor = st.pagerText; }
    return st.pagerSpr;
  }

  function hintSprite() {
    if (fixed.hint) return fixed.hint;
    var text = TXT().hint1 || 'Follow the green arrow. Get IN RANGE. Shoot on the flash.';
    var hf = FONT;
    if (touchMenus()) {                         // v1.1.2: 18 px on touch, shrunk (>= 11) to fit 760 px
      var px = MENU_TOUCH_PX;
      while (px > 11 && measure(text, 'bold ' + px + 'px Verdana, sans-serif') > 760) px--;
      hf = 'bold ' + px + 'px Verdana, sans-serif';
    }
    var t = textSprite(text, hf, '#FFFFFF', '#000000');
    var c = newCanvas(t.width + 16, t.height + 6), x = c.getContext('2d');
    x.fillStyle = PLATE; roundRect(x, 0, 0, c.width, c.height, 6); x.fill();
    x.drawImage(t, 8, 3);
    fixed.hint = c;
    return c;
  }

  // hint sits under the pager slot (fixed y so it does not jump when the pager hides)
  function hintY(gs) {
    var h = st.pagerText ? getPager().height : 48;
    return 4 + Math.max(h, 48) + 4;
  }

  var topBox = { l: 0, r: 0, b: 0 };           // touch: pager + hint box this frame (edge arrow avoids it)
  var plates = [0, 0, 0, 0, 0, 0, 0, 0];   // score + CASE plate rects (x, y, w, h) for the edge arrow
  function plate(ctx, spr, x, y, slot) {
    var o = slot * 4;
    plates[o] = x - 4; plates[o + 1] = y - 2; plates[o + 2] = spr.width + 8; plates[o + 3] = spr.height + 4;
    ctx.fillStyle = PLATE;
    ctx.fillRect(x - 4, y - 2, spr.width + 8, spr.height + 4);
    blit(ctx, spr, x, y);
  }

  function drawEdgeArrow(ctx, cam, sc) {
    var a = PE.logic.edgeArrow(cam, sc.focus.x, sc.focus.y, 24, 28);
    if (a.onScreen) return;
    var x = Math.round(a.x), y = Math.round(a.y), ang = a.angle;
    // keep the arrow (r ~14) and its label clear of the score and CASE plates: slide it down the side edge
    for (var k = 0; k < 2; k++) {
      var o = k * 4;
      if (x + 16 > plates[o] && x - 16 < plates[o] + plates[o + 2] && y - 16 < plates[o + 1] + plates[o + 3]) y = plates[o + 1] + plates[o + 3] + 18;
    }
    // v1.1.2 touch: the wide pager / case-1 hint (top center): slide sideways along the top edge past them
    if (topBox.b > 0 && y - 16 < topBox.b && x + 16 > topBox.l && x - 16 < topBox.r) x = x < cam.w / 2 ? topBox.l - 18 : topBox.r + 18;
    var m = Math.round(sc.d / 16);
    if (changed(memoMeters, m)) memoMeters.s = liveText(ltMeters, m + 'm', FONT, GREEN);
    var label = memoMeters.s;
    var lox = Math.round(-Math.cos(ang) * 26 - label.width / 2), loy = Math.round(-Math.sin(ang) * 22 - label.height / 2);
    // v1.0.1: arrow + label box also slides along its edge past the scandal bubble (e.g. one clamped to the bottom)
    if (sb.on) {
      var bx0 = Math.min(-16, lox) - 2, bx1 = Math.max(16, lox + label.width) + 2;
      var by0 = Math.min(-16, loy) - 2, by1 = Math.max(16, loy + label.height) + 2;
      if (x + bx1 > sb.x && x + bx0 < sb.x + sb.w && y + by1 > sb.y && y + by0 < sb.y + sb.h) {
        var W = cam.w, H = cam.h, E = 28;
        if (Math.abs(a.x - E) < 1 || Math.abs(a.x - (W - E)) < 1) {          // left/right edge: slide vertically
          var up = sb.y - by1, dn = sb.y + sb.h - by0;
          y = (up >= E && (Math.abs(up - y) <= Math.abs(dn - y) || dn > H - E)) ? up : (dn <= H - E ? dn : up);
        } else {                                                            // top/bottom edge: slide horizontally
          var lf = sb.x - bx1, rt = sb.x + sb.w - bx0;
          x = (lf >= E && (Math.abs(lf - x) <= Math.abs(rt - x) || rt > W - E)) ? lf : (rt <= W - E ? rt : lf);
        }
      }
    }
    ctx.globalAlpha = 0.4 + 0.6 * N(sc.intensity, 0);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -11); ctx.lineTo(-5, 0); ctx.lineTo(-10, 11); ctx.closePath();
    ctx.fillStyle = GREEN; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000000'; ctx.stroke();
    ctx.restore();
    blit(ctx, label, x + lox, y + loy);
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }

  U.drawHUD = function (ctx, gs, cam) {
    if (!mctx || !gs) return;
    ensure(gs);
    consumeEvents(gs);
    var W = cam ? cam.w : 960, H = cam ? cam.h : 540, now = gs.time, spr;
    // score + case on plates
    if (changed(memoScore, gs.score)) memoScore.s = liveText(ltScore, PE.logic.formatShekels(gs.score), 'bold 20px Verdana, sans-serif', gs.score < 0 ? RED : GOLD);
    spr = memoScore.s;
    plate(ctx, spr, 10, 6, 0);
    var cn = Math.max(1, Math.min(gs.total, gs.caseNo));
    if (changed(memoCase, cn * 100 + gs.total)) memoCase.s = liveText(ltCase, 'CASE ' + cn + '/' + gs.total, 'bold 16px Verdana, sans-serif', '#FFFFFF');
    spr = memoCase.s;
    plate(ctx, spr, W - 10 - spr.width, 8, 1);
    var sc = gs.scandal;
    var pt = now - st.pagerT0;
    topBox.b = 0;
    // pager / case-1 hint box (top center): the edge arrow slides past it (touch v1.1.2, desktop v1.1.3)
    var tw = 0;
    if (pt >= 0 && pt < 5 && st.pagerText) { tw = getPager().width; topBox.b = 4 + getPager().height; }
    if (gs.caseNo === 1 && sc && sc.status === 'live') { tw = Math.max(tw, hintSprite().width); topBox.b = hintY(gs) + hintSprite().height; }
    topBox.l = Math.round((W - tw) / 2); topBox.r = topBox.l + tw;
    if (sc && sc.status === 'live') drawEdgeArrow(ctx, cam || { x: 0, y: 0, w: W, h: H }, sc);
    // pager (5 s on spawn, blinks for the first 0.6 s)
    if (pt >= 0 && pt < 5 && st.pagerText) {
      spr = getPager();
      if (pt > 0.6 || Math.floor(pt * 10) % 2 === 0) {
        var slide = pt < 0.15 ? Math.round((1 - pt / 0.15) * -spr.height) : (pt > 4.7 ? Math.round(((pt - 4.7) / 0.3) * -spr.height) : 0);
        ctx.drawImage(spr, Math.round((W - spr.width) / 2), 4 + slide);
      }
    }
    // case-1 hint until case 1 resolves
    if (gs.caseNo === 1 && sc && sc.status === 'live') {
      spr = hintSprite();
      ctx.drawImage(spr, Math.round((W - spr.width) / 2), hintY(gs));
    }
    // feedback popup (1.8 s)
    var pop = st.popup;
    if (pop) {
      var at = now - pop.t0;
      if (at >= 0 && at < 1.8) {
        var scl = at < 0.15 ? 1.5 - (at / 0.15) * 0.5 : 1, y0 = H - 112;
        if (at > 1.5) ctx.globalAlpha = Math.max(0, (1.8 - at) / 0.3);
        var aw = Math.round(pop.a.width * scl), ah = Math.round(pop.a.height * scl);
        blit(ctx, pop.a, Math.round((W - aw) / 2), Math.round(y0 - ah / 2), aw, ah);
        blit(ctx, pop.b, Math.round((W - pop.b.width) / 2), y0 + 16);
        if (pop.c) blit(ctx, pop.c, Math.round((W - pop.c.width) / 2), y0 + 36);
        ctx.globalAlpha = 1;
      } else if (at >= 1.8) st.popup = null;
    }
    // camera icon: grey none, amber near, cyan in range; dimmed during cooldown
    var prox = (sc && sc.status === 'live') ? sc.prox : 0;
    var icon = prox === 2 ? camIcons.cyan : (prox === 1 ? camIcons.amber : camIcons.grey);
    var ix = W - 62, iy = H - 62, cd = N(gs.photoCooldown, 0), CD = N(C().PHOTO_COOLDOWN, 0.6);
    if (cd > 0) ctx.globalAlpha = 0.35;
    ctx.drawImage(icon, ix, iy);
    ctx.globalAlpha = 1;
    if (cd > 0) {
      ctx.fillStyle = '#000000'; ctx.fillRect(ix, iy + 34, 44, 4);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(ix, iy + 34, Math.round(44 * (1 - cd / CD)), 4);
    }
    var lab = prox === 2 ? fixed.inRange : (prox === 1 ? fixed.near : null);
    if (lab) ctx.drawImage(lab, Math.min(W - 2 - lab.width, Math.round(ix + 22 - lab.width / 2)), Math.min(H - lab.height, iy + 38));
    if (PE.sfx && PE.sfx.muted) ctx.drawImage(fixed.muted, 10, H - 24);
    // shutter flash 120 ms
    var ft = now - st.flashT0;
    if (ft >= 0 && ft < 0.12) {
      ctx.globalAlpha = 0.85 * (1 - ft / 0.12);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  };

  // ---------------------------------------------------------------- screens
  // v1.1.1: touch-mode menu text >= 12 CSS px on a 740x360 phone (canvas scale ~0.667 -> 18 canvas px).
  // Desktop (PE.touch.enabled false) keeps the original sizes. Decided at cache-build time only.
  var MENU_TOUCH_PX = 18;
  var PAGER_TOUCH_TEXT_W = 560;   // pager tip wrap budget (canvas px) at bold 18 px; pager spans x 182..778
  function touchMenus() { return !!(PE.touch && PE.touch.enabled); }
  // centered text that shrinks (never below 11 px) if a line would not fit maxW
  function centerFit(x, text, y, px, color, W, maxW) {
    var f = 'bold ' + px + 'px Verdana, sans-serif';
    while (px > 11 && measure(text, f) > maxW) { px--; f = 'bold ' + px + 'px Verdana, sans-serif'; }
    centerText(x, text, y, f, color, W);
  }

  function controlsList() {
    var c = TXT().controls;
    if (c && c.length) return c;
    return ['WASD / Arrows: walk', 'Shift: jog', 'Space / K: photo', 'P / Esc: pause', 'R: restart', 'M: mute'];
  }

  function centerText(x, text, y, font, color, W) {
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 4; x.strokeStyle = '#000000'; x.strokeText(text, W / 2, y);
    x.fillStyle = color; x.fillText(text, W / 2, y);
  }

  U.drawTitle = function (ctx, t) {
    if (!mctx) return;
    var W = ctx.canvas ? ctx.canvas.width : 960, H = ctx.canvas ? ctx.canvas.height : 540;
    if (!titleCanvas) {
      titleCanvas = newCanvas(W, H);
      var x = titleCanvas.getContext('2d'), T = TXT();
      x.fillStyle = 'rgba(12,8,18,0.72)'; x.fillRect(0, 0, W, H);
      x.font = 'bold 72px Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#5A1E00'; x.fillText(T.title || 'HUSH MONEY', W / 2 + 5, 140 + 5);
      x.fillStyle = GOLD; x.fillText(T.title || 'HUSH MONEY', W / 2, 140);
      centerText(x, T.subtitle || 'Photograph the scandal. Sell the silence.', 200, 'bold 18px Verdana, sans-serif', '#FFFFFF', W);
      var cl = controlsList();
      var big = touchMenus(), step = big ? 26 : 22;
      for (var i = 0; i < cl.length; i++) {
        if (big) centerFit(x, cl[i], 258 + i * step, MENU_TOUCH_PX, '#D8D0C0', W, W - 40);
        else centerText(x, cl[i], 258 + i * 22, 'bold 13px Verdana, sans-serif', '#D8D0C0', W);
      }
    }
    ctx.drawImage(titleCanvas, 0, 0);
    if (Math.floor(N(t, 0) * 2) % 2 === 0) ctx.drawImage(fixed.start, Math.round((W - fixed.start.width) / 2), H - 70);
  };

  U.drawPause = function (ctx) {
    if (!mctx) return;
    var W = ctx.canvas ? ctx.canvas.width : 960, H = ctx.canvas ? ctx.canvas.height : 540;
    if (!pauseCanvas) {
      pauseCanvas = newCanvas(W, H);
      var x = pauseCanvas.getContext('2d');
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, 0, W, H);
      centerText(x, 'PAUSED', 130, 'bold 44px Verdana, sans-serif', GOLD, W);
      var cl = controlsList();
      var big = touchMenus();
      for (var i = 0; i < cl.length; i++) {
        if (big) centerFit(x, cl[i], 196 + i * 26, MENU_TOUCH_PX, '#FFFFFF', W, W - 40);
        else centerText(x, cl[i], 200 + i * 22, 'bold 13px Verdana, sans-serif', '#FFFFFF', W);
      }
      var hf = big ? 'bold ' + MENU_TOUCH_PX + 'px Verdana, sans-serif' : 'bold 14px Verdana, sans-serif';
      var hint = wrap(TXT().pause || 'P / Esc: resume    R: restart    M: mute', hf, W - 80).slice(0, 2);
      // touch: the hint sits above the RESTART / SOUND buttons (touch.js, y 478..518)
      var hy = big ? (hint.length > 1 ? H - 120 : H - 96) : H - 90, hs = big ? 24 : 20;
      for (var j = 0; j < hint.length; j++) centerText(x, hint[j], hy + j * hs, hf, '#D8D0C0', W);
    }
    ctx.drawImage(pauseCanvas, 0, 0);
  };

  // ---------------------------------------------------------------- v1.2 options panel (pause -> OPTIONS)
  // Layout (canvas px): SPEECH row x 330..630, y 228..280; BACK x 405..555, y 306..350. touch.js hit-tests via optionsHit().
  var OPT_ROW = { x: 330, y: 228, w: 300, h: 52 }, OPT_BACK = { x: 405, y: 306, w: 150, h: 44 };
  var OPT0 = { title: 'OPTIONS', speech: { all: 'SPEECH: EVERYONE', marks: 'SPEECH: MARKS ONLY', off: 'SPEECH: OFF' }, back: 'BACK' };
  var optCache = {};
  function optText() {
    var o = TXT().options || {}, sp = o.speech || {};
    return { title: o.title || OPT0.title, back: o.back || OPT0.back,
      speech: { all: sp.all || OPT0.speech.all, marks: sp.marks || OPT0.speech.marks, off: sp.off || OPT0.speech.off } };
  }
  function optButton(x, r, label, font, accent) {
    x.fillStyle = 'rgba(37,29,43,0.95)'; x.fillRect(r.x, r.y, r.w, r.h);
    x.lineWidth = 2; x.strokeStyle = accent; x.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#FFFFFF';
    x.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }
  // Cached full-screen panel per speech value (3 canvases max); built once, blitted per frame.
  U.drawOptions = function (ctx) {
    if (!mctx) return;
    var W = ctx.canvas ? ctx.canvas.width : 960, H = ctx.canvas ? ctx.canvas.height : 540, mode = speechMode();
    var c = optCache[mode];
    if (!c) {
      var big = touchMenus(), t = optText(), f = 'bold ' + (big ? MENU_TOUCH_PX : 15) + 'px Verdana, sans-serif';
      c = optCache[mode] = newCanvas(W, H);
      var x = c.getContext('2d');
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, 0, W, H);
      centerText(x, t.title, 150, 'bold 40px Verdana, sans-serif', GOLD, W);
      optButton(x, OPT_ROW, t.speech[mode], f, GOLD);
      optButton(x, OPT_BACK, t.back, f, '#8A7A96');
      var hint = big ? 'Tap SPEECH to change' : 'Enter / Space - change     Esc - back';
      centerText(x, hint, H - 96, big ? 'bold ' + MENU_TOUCH_PX + 'px Verdana, sans-serif' : 'bold 14px Verdana, sans-serif', '#D8D0C0', W);
    }
    ctx.drawImage(c, 0, 0);
  };
  function inR(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  U.optionsHit = function (x, y) { return inR(OPT_ROW, x, y) ? 'speech' : (inR(OPT_BACK, x, y) ? 'back' : null); };

  function buildResults(gs, W, H) {
    var c = newCanvas(W, H), x = c.getContext('2d'), logic = PE.logic, i, j;
    x.fillStyle = 'rgba(16,10,20,0.9)'; x.fillRect(0, 0, W, H);
    centerText(x, 'BLACKMAIL PORTFOLIO', 34, 'bold 26px Verdana, sans-serif', GOLD, W);
    var cw = 290, ch = 180, gap = 15, x0 = Math.round((W - (3 * cw + 2 * gap)) / 2), y0 = 62, sum = 0;
    var n = Math.max(gs.results.length, gs.total);
    for (i = 0; i < Math.min(6, n); i++) {
      var r = gs.results[i], col = i % 3, row = (i / 3) | 0;
      var cx = x0 + col * (cw + gap), cy = y0 + row * (ch + 10);
      x.fillStyle = '#251D2B'; x.fillRect(cx, cy, cw, ch);
      x.strokeStyle = '#4A3B52'; x.lineWidth = 1; x.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
      var fx = cx + 10, fy = cy + 12;
      x.fillStyle = '#000000'; x.fillRect(fx + 3, fy + 3, 132, 120);
      x.fillStyle = '#F4F1E8'; x.fillRect(fx, fy, 132, 120);
      var img = st.polaroids[i];
      if (img && r && r.photo) {
        x.drawImage(img, 0, 0, 160, 120, fx + 6, fy + 6, 120, 90);
      } else {
        x.fillStyle = '#3A3A3A'; x.fillRect(fx + 6, fy + 6, 120, 90);
        x.save(); x.translate(fx + 66, fy + 51); x.rotate(-0.25);
        x.font = 'bold 18px Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.strokeStyle = RED; x.lineWidth = 2; x.strokeRect(-52, -14, 104, 28);
        x.fillStyle = RED; x.fillText(r ? 'MISSED' : '---', 0, 1);
        x.restore();
      }
      x.font = 'bold 10px Verdana, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillStyle = '#333333';
      x.fillText('CASE ' + (i + 1), fx + 8, fy + 101);
      var tx = cx + 152, tw = cw - 160;
      if (!r) { x.fillStyle = '#888888'; x.font = FONT; x.fillText('(not reached)', tx, cy + 16); continue; }
      sum += N(r.points, 0);
      var head = r.photo ? (r.caption || r.title || '') : 'MISSED: ' + (r.title || '');
      var lines = wrap(head, FONT, tw).slice(0, 6);
      x.font = FONT; x.fillStyle = r.photo ? '#FFFFFF' : '#B0B0B0';
      for (j = 0; j < lines.length; j++) x.fillText(lines[j], tx, cy + 14 + j * 14);
      var py = cy + ch - 62;
      x.font = 'bold 18px Verdana, sans-serif'; x.fillStyle = r.photo ? gradeColor(r.points) : '#888888';
      x.fillText(r.photo ? '+' + logic.formatShekels(r.points) : logic.formatShekels(0), tx, py);
      x.font = 'bold 10px Verdana, sans-serif';
      x.fillText(r.label || '', tx, py + 24);
      if (r.photo) { x.fillStyle = '#B8B0C0'; x.fillText(fmtDt(r.dt), tx, py + 38); }
      if (r.photo && r.angle) {                                             // v2 night: polaroid breakdown line
        var bd = (PE.NIGHT && typeof PE.NIGHT.breakdown === 'function') ? PE.NIGHT.breakdown(r.angle) : 'x' + N(r.M, 1).toFixed(2);
        x.font = 'bold 9px Verdana, sans-serif'; x.fillStyle = '#B8B0C0'; x.fillText(bd, cx + 10, cy + ch - 12);
      }
      if (r.aborted) { x.font = 'bold 10px Verdana, sans-serif'; x.fillStyle = RED; x.fillText('BLOWN COVER', tx, py + 38); }
    }
    var fyy = y0 + 2 * (ch + 10) + (touchMenus() ? 0 : 8);   // touch: room for the 18 px hint below
    var pen = gs.score - sum;
    centerText(x, 'TOTAL  ' + logic.formatShekels(gs.score) + (pen < 0 ? '   (wasted film ' + logic.formatShekels(pen) + ')' : ''),
      fyy + 12, 'bold 20px Verdana, sans-serif', gs.score < 0 ? RED : GOLD, W);
    centerText(x, logic.rankFor(gs.score, C()), fyy + 40, 'bold 16px Verdana, sans-serif', '#FFFFFF', W);
    var bestTxt = st.newBest ? 'NEW BEST SCORE!' : ('Best: ' + (st.best === null ? '-' : logic.formatShekels(st.best)));
    centerText(x, bestTxt, fyy + 62, 'bold 12px Verdana, sans-serif', st.newBest ? CYAN : '#CFC6D8', W);
    if (touchMenus()) centerFit(x, TXT().resultsHint || 'R / Enter: blackmail again', H - 11, MENU_TOUCH_PX, '#D8D0C0', W, W - 40);
    else centerText(x, TXT().resultsHint || 'R / Enter: blackmail again', H - 14, 'bold 12px Verdana, sans-serif', '#D8D0C0', W);
    return c;
  }

  U.drawResults = function (ctx, gs) {
    if (!mctx || !gs) return;
    ensure(gs);
    var W = ctx.canvas ? ctx.canvas.width : 960, H = ctx.canvas ? ctx.canvas.height : 540;
    if (st.savedFor !== gs) {
      st.savedFor = gs;
      if (st.best === null || gs.score > st.best) {
        st.newBest = st.best !== null || gs.score > 0;
        st.best = gs.score;
        try { globalThis.localStorage.setItem('hushmoney.best', String(gs.score)); } catch (e) { /* storage blocked */ }
      }
    }
    if (!st.resultsCanvas || st.resultsN !== gs.results.length || st.resultsScore !== gs.score) {
      st.resultsCanvas = buildResults(gs, W, H); st.resultsN = gs.results.length; st.resultsScore = gs.score;
    }
    ctx.drawImage(st.resultsCanvas, 0, 0);
  };

  // ================================================================ v2 NIGHT HUD (additive: only night-main calls these)
  // drawNightWorld(ctx, cam, gs): photo wedge (70 deg / PHOTO_RANGE, faint white) + suspicion eye and meter over watchers.
  // drawNightHUD(ctx, gs, cam): your exposure (IN SHADOW / LIT, SEEN!) + case suspicion bar, under the score plate.
  // All sprites pre-rendered on first use; no per-frame strings or allocation.
  var nightSpr = null;
  function makeEye(iris, open) {
    var c = newCanvas(24, 16), x = c.getContext('2d');
    x.fillStyle = '#000000'; x.beginPath(); x.ellipse(12, 8, 11, open ? 7 : 4, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#F4F1E8'; x.beginPath(); x.ellipse(12, 8, 9.5, open ? 5.5 : 2.5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = iris; x.beginPath(); x.arc(12, 8, open ? 4 : 2.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#000000'; x.beginPath(); x.arc(12, 8, open ? 1.8 : 1.2, 0, Math.PI * 2); x.fill();
    return c;
  }
  function buildNightSprites() {
    var R = N(C().PHOTO_RANGE, 170), fov = N(PE.NIGHT && PE.NIGHT.ANGLE && PE.NIGHT.ANGLE.PHOTO_CONE_DEG, 70) * Math.PI / 180;
    var size = R * 2 + 4, m = size / 2, wedges = [], d;
    for (d = 0; d < 8; d++) {
      var c = newCanvas(size, size), x = c.getContext('2d'), a = (d * 45 - 90) * Math.PI / 180;
      x.beginPath(); x.moveTo(m, m); x.arc(m, m, R, a - fov / 2, a + fov / 2); x.closePath();
      x.fillStyle = 'rgba(255,255,255,0.09)'; x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.5; x.stroke();
      wedges.push(c);
    }
    nightSpr = {
      wedges: wedges,
      eyes: [[makeEye('#7A7A7A', false), makeEye('#7A7A7A', true)], [makeEye(AMBER, false), makeEye(AMBER, true)], [makeEye(RED, false), makeEye(RED, true)]],
      shadow: textSprite('IN SHADOW', FONT, '#9FB4E8', '#000000'),
      lit: textSprite('LIT', FONT, AMBER, '#000000'),
      seen: textSprite('SEEN!', FONT, RED, '#000000'),
      susp: textSprite('SUSPICION', 'bold 9px Verdana, sans-serif', '#D8D0C0', '#000000')
    };
  }
  function suspIdx(st) { return st === 'cagey' || st === 'abort' ? 2 : (st === 'uneasy' ? 1 : 0); }
  function suspColor(v) { return v >= 65 ? RED : (v >= 35 ? AMBER : '#D8D0C0'); }

  U.drawNightWorld = function (ctx, cam, gs) {
    if (!mctx || !gs) return;
    if (!nightSpr) buildNightSprites();
    var p = gs.player, sc = gs.scandal, i;
    var wd = nightSpr.wedges[((p.dir | 0) % 8 + 8) % 8];
    ctx.drawImage(wd, Math.round(p.x - cam.x - wd.width / 2), Math.round(p.y - 8 - cam.y - wd.height / 2));
    if (!sc || sc.status !== 'live' || !sc.watchers) return;
    var si = suspIdx(sc.suspState), frac = Math.max(0, Math.min(1, N(sc.susp, 0) / 100)), col = suspColor(N(sc.susp, 0));
    for (i = 0; i < sc.watchers.length; i++) {
      var w = sc.watchers[i], sx = Math.round(w.x - cam.x), sy = Math.round(w.y - cam.y) - 44;
      if (sx < -30 || sy < -30 || sx > cam.w + 30 || sy > cam.h + 30) continue;
      var eye = nightSpr.eyes[si][w.sees ? 1 : 0];
      if (!w.coneOn && !w.sees) ctx.globalAlpha = 0.45;                      // busy (glance kind, off-window)
      ctx.drawImage(eye, sx - 12, sy - 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000000'; ctx.fillRect(sx - 13, sy + 9, 26, 5);
      ctx.fillStyle = col; ctx.fillRect(sx - 12, sy + 10, Math.round(24 * frac), 3);
    }
  };

  U.drawNightHUD = function (ctx, gs, cam) {
    if (!mctx || !gs) return;
    if (!nightSpr) buildNightSprites();
    var sc = gs.scandal;
    if (!sc || sc.status !== 'live' || !sc.watchers) return;
    var x0 = 6, y0 = 40, lab = sc.exposed ? nightSpr.lit : nightSpr.shadow;
    ctx.fillStyle = PLATE; ctx.fillRect(x0, y0, 122, 40);
    ctx.drawImage(lab, x0 + 4, y0 + 2);
    if (sc.seenNow) ctx.drawImage(nightSpr.seen, x0 + 8 + lab.width, y0 + 2);
    ctx.drawImage(nightSpr.susp, x0 + 4, y0 + 20);
    var v = N(sc.susp, 0), bx = x0 + 8 + nightSpr.susp.width, bw = 122 - (bx - x0) - 6;
    ctx.fillStyle = '#000000'; ctx.fillRect(bx, y0 + 25, bw, 7);
    ctx.fillStyle = suspColor(v); ctx.fillRect(bx + 1, y0 + 26, Math.round((bw - 2) * Math.min(1, v / 100)), 5);
  };

  PE.ui = U;
})(globalThis.PE = globalThis.PE || {});
