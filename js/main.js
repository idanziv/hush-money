// HUSH MONEY - main.js (owner: eng-lead)
// Boot, input, fixed-timestep loop, camera, screen states, render pipeline (spec 2, 3, 11, 12).
(function (PE) {
  'use strict';

  var canvas = null, ctx = null;
  var state = 'title';            // title | playing | paused | results
  var seedParam = null, debug = false;
  var keys = Object.create(null);
  var input = { up: false, down: false, left: false, right: false, sprint: false, photo: false };
  var photoQueued = false;
  var acc = 0, lastT = 0, clock = 0;
  var fpsT = 0, fpsN = 0, fps = 0, updMs = 0, renMs = 0;
  var people = [];                // reused draw list
  var frameEv = [];               // reused frame event list
  var lastProx = 0;
  var resultsAt = 0;              // clock when the results screen opened (touch restart guard)
  var errMsg = null, errSeen = Object.create(null);

  function C() { return PE.CFG || {}; }
  function N(v, d) { return (typeof v === 'number' && !isNaN(v)) ? v : d; }

  // ---------------------------------------------------------------- errors
  function drawError(msg, full) {
    if (!ctx) return;
    try {
      ctx.save();
      ctx.globalAlpha = 1;
      if (full) { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      else { ctx.fillStyle = 'rgba(80,0,0,0.85)'; ctx.fillRect(0, canvas.height - 40, canvas.width, 40); }
      ctx.fillStyle = '#FF6A5A'; ctx.font = 'bold 12px Verdana, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      var lines = String(msg).split('\n').slice(0, full ? 30 : 2);
      var y0 = full ? 20 : canvas.height - 36;
      if (full) { ctx.fillText('HUSH MONEY failed to start:', 20, y0); y0 += 22; }
      for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i].slice(0, 140), 20, y0 + i * 16);
      ctx.restore();
    } catch (e) { /* nothing more we can do */ }
  }
  function report(e) {
    var msg = (e && (e.stack || e.message)) || String(e);
    if (!errSeen[msg]) { errSeen[msg] = true; if (globalThis.console) console.error(e); }
    errMsg = msg;
  }

  // ---------------------------------------------------------------- run / camera
  function newSeed() { return seedParam !== null ? seedParam : (Date.now() >>> 0); }

  function updateCam() {
    var gs = PE.game.state, cam = PE.cam, cfg = C(), T = N(cfg.TILE, 32);
    if (!gs || !cam) return;
    var mw = N(cfg.MAP_W, 96) * T, mh = N(cfg.MAP_H, 64) * T;
    cam.x = Math.max(0, Math.min(mw - cam.w, Math.round(gs.player.x - cam.w / 2)));
    cam.y = Math.max(0, Math.min(mh - cam.h, Math.round(gs.player.y - cam.h / 2)));
  }

  function startRun() {
    PE.game.newRun(newSeed());
    PE.game.frameEvents = frameEv; frameEv.length = 0;
    updateCam();
    acc = 0; photoQueued = false; lastProx = 0;
    state = 'playing';
  }

  // ---------------------------------------------------------------- input
  var PREVENT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  function onKeyDown(e) {
    var code = e.code || e.key;
    if (PREVENT[code]) e.preventDefault();
    if (PE.sfx) PE.sfx.init();
    keys[code] = true;
    if (e.repeat) return;
    if (code === 'KeyM') { if (PE.sfx) PE.sfx.toggleMute(); return; }
    if (code === 'Backquote') { debug = !debug; return; }
    switch (state) {
      case 'title':
        if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') startRun();
        break;
      case 'playing':
        if (code === 'Space' || code === 'KeyK') photoQueued = true;
        else if (code === 'KeyP' || code === 'Escape') { state = 'paused'; photoQueued = false; }
        break;
      case 'paused':
        if (code === 'KeyP' || code === 'Escape') { state = 'playing'; lastT = 0; }
        else if (code === 'KeyR') startRun();
        break;
      case 'results':
        if (code === 'KeyR' || code === 'Enter' || code === 'Space' || code === 'NumpadEnter') startRun();
        break;
    }
  }
  function onKeyUp(e) { keys[e.code || e.key] = false; }
  function clearKeys() { for (var k in keys) keys[k] = false; if (PE.touch) PE.touch.release(); }

  function readInput() {
    input.up = !!(keys.KeyW || keys.ArrowUp);
    input.down = !!(keys.KeyS || keys.ArrowDown);
    input.left = !!(keys.KeyA || keys.ArrowLeft);
    input.right = !!(keys.KeyD || keys.ArrowRight);
    input.sprint = !!(keys.ShiftLeft || keys.ShiftRight || keys.Shift);
    if (PE.touch) PE.touch.read(input);
  }

  // touch.js drives the same state machine as the keys above
  var touchApi = {
    state: function () { return state; },
    shoot: function () { if (state === 'playing') photoQueued = true; },
    pause: function () { if (state === 'playing') { state = 'paused'; photoQueued = false; } },
    resume: function () { if (state === 'paused') { state = 'playing'; lastT = 0; } },
    start: function () { if (state !== 'results' || clock - resultsAt > 0.8) startRun(); },
    mute: function () { if (PE.sfx) PE.sfx.toggleMute(); }
  };

  // ---------------------------------------------------------------- update
  function handleEvents(gs) {
    var sfx = PE.sfx;
    for (var i = 0; i < frameEv.length; i++) {
      var e = frameEv[i];
      if (!sfx) break;
      if (e.type === 'spawn') sfx.play('spawn');
      else if (e.type === 'photo') {
        sfx.play('shutter');
        if (e.result.kind === 'scored') { if (e.result.points >= 1500) sfx.play('perfect'); }
        else sfx.play('fail');
      } else if (e.type === 'resolve' && e.status === 'expired') sfx.play('fail');
      else if (e.type === 'peak') {
        var sc = gs.scandal, cam = PE.cam;
        var onScreen = sc && cam && sc.focus.x >= cam.x && sc.focus.x <= cam.x + cam.w && sc.focus.y >= cam.y && sc.focus.y <= cam.y + cam.h;
        if (sc && (sc.prox >= 1 || onScreen)) sfx.play('peak');
      }
    }
    var prox = gs.scandal && gs.scandal.status === 'live' ? gs.scandal.prox : 0;
    if (prox === 2 && lastProx !== 2 && sfx) sfx.play('tick');
    lastProx = prox;
  }

  function stepGame(dtReal) {
    var DT = N(C().DT, 1 / 60), gs = PE.game.state;
    acc += dtReal;
    var steps = 0;
    while (acc >= DT && steps < 5) {
      readInput();
      input.photo = photoQueued; photoQueued = false;
      PE.game.update(DT, input);
      var ev = gs.events;
      for (var i = 0; i < ev.length; i++) frameEv.push(ev[i]);
      updateCam();
      acc -= DT; steps++;
      if (gs.over) break;
    }
    if (steps >= 5 && acc >= DT) acc = 0;     // spiral-of-death guard
    handleEvents(gs);
    if (gs.over) { state = 'results'; photoQueued = false; resultsAt = clock; }
  }

  // ---------------------------------------------------------------- render
  function byY(a, b) { return a.y - b.y; }

  function pushVisible(list, cam) {
    if (!list) return;
    var x0 = cam.x - 64, y0 = cam.y - 64, x1 = cam.x + cam.w + 64, y1 = cam.y + cam.h + 64;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) people.push(p);
    }
  }

  function renderWorld(gs, cam, withOverlay) {
    var art = PE.art, city = PE.city, npc = PE.npc, i;
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, cam.w, cam.h);
    city.drawGround(ctx, cam);
    PE.game.drawUnder(ctx, cam);
    var vs = (npc && npc.vehicles) || [];
    for (i = 0; i < vs.length; i++) {
      var v = vs[i];
      var vx = Math.round(v.x - cam.x), vy = Math.round(v.y - cam.y);
      if (vx < -64 || vy < -64 || vx > cam.w + 64 || vy > cam.h + 64) continue;
      art.drawVehicle(ctx, vx, vy, v.type, v.dir, v.color);
    }
    if (art.drawPlayerMarker) art.drawPlayerMarker(ctx, Math.round(gs.player.x - cam.x), Math.round(gs.player.y - cam.y), clock);
    people.length = 0;
    pushVisible(npc && npc.people, cam);
    pushVisible(PE.game.actors(), cam);
    people.push(gs.player);
    people.sort(byY);
    var t = gs.time;
    for (i = 0; i < people.length; i++) {
      var p = people[i];
      var sx = Math.round(p.x - cam.x), sy = Math.round(p.y - cam.y);
      art.drawCharacter(ctx, sx, sy, p.look, p.dir, p.animT, p.moving, p.prop);
      if (p.action && art.drawActionFx) art.drawActionFx(ctx, sx, sy, p.action, t);
    }
    if (npc && npc.drawExtras) npc.drawExtras(ctx, cam);
    city.drawTop(ctx, cam, clock);
    // spec 11 v0.3: polaroid is captured here, before the flare and the overlay (no bubbles/rings in photos)
    if (state === 'playing') PE.ui.capture(canvas, gs, cam);
    if (PE.game.drawOver) PE.game.drawOver(ctx, cam);
    if (withOverlay) PE.ui.drawWorldOverlay(ctx, cam, gs, people);
  }

  function drawDebug(gs, cam) {
    var spots = (PE.city && PE.city.spots) || [], T = N(C().TILE, 32), i;
    ctx.save();
    ctx.font = 'bold 10px Verdana, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (i = 0; i < spots.length; i++) {
      var s = spots[i], sx = Math.round(s.x - cam.x), sy = Math.round(s.y - cam.y);
      if (sx < -60 || sy < -60 || sx > cam.w + 60 || sy > cam.h + 60) continue;
      var cur = gs.scandal && gs.scandal.spot === s;
      ctx.strokeStyle = cur ? '#4FD8FF' : '#FF00FF'; ctx.lineWidth = 1;
      ctx.strokeRect(sx - 1.5 * T + 0.5, sy - 1.5 * T + 0.5, 3 * T - 1, 3 * T - 1);
      ctx.fillStyle = '#000000'; ctx.fillRect(sx - 1.5 * T, sy - 1.5 * T - 13, 96, 13);
      ctx.fillStyle = '#FF9DFF'; ctx.fillText(s.id + ' ' + s.kind, sx - 1.5 * T + 2, sy - 1.5 * T - 12);
    }
    var sc = gs.scandal;
    var lines = [
      'FPS ' + fps.toFixed(0) + '  upd ' + updMs.toFixed(2) + ' ms  ren ' + renMs.toFixed(2) + ' ms',
      'seed ' + gs.seed + '  state ' + state + '  phase ' + gs.phase + '  timer ' + N(gs.timer, 0).toFixed(1),
      'player ' + Math.round(gs.player.x) + ',' + Math.round(gs.player.y) + '  tile ' + Math.floor(gs.player.x / T) + ',' + Math.floor(gs.player.y / T) +
        '  people ' + (people.length) + '  zone ' + ((PE.city && PE.city.zoneAt) ? PE.city.zoneAt(gs.player.x, gs.player.y) : '?'),
      sc ? ('case ' + gs.caseNo + ' ' + sc.def.id + ' @' + sc.spot.id + '  t ' + sc.t.toFixed(2) + '  I ' + N(sc.intensity, 0).toFixed(2) +
        '  d ' + Math.round(sc.d) + '  ' + sc.status + '  relax ' + sc.relax + '  path ' + sc.pathTiles) : 'no scandal'
    ];
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(4, 40, 470, lines.length * 14 + 6);
    ctx.fillStyle = '#FFFFFF';
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], 8, 43 + i * 14);
    ctx.restore();
  }

  function render() {
    var gs = PE.game.state, cam = PE.cam;
    ctx.imageSmoothingEnabled = false;
    if (state === 'title') {
      renderWorld(gs, cam, true);
      PE.ui.drawTitle(ctx, clock);
    } else {
      renderWorld(gs, cam, true);
      if (state !== 'results') PE.ui.drawHUD(ctx, gs, cam);
      if (state === 'playing' && PE.touch) PE.touch.draw(ctx, gs.scandal && gs.scandal.status === 'live' ? gs.scandal.prox : 0);
      if (state === 'paused') { PE.ui.drawPause(ctx); if (PE.touch) PE.touch.drawPause(ctx, PE.sfx && PE.sfx.muted); }
      if (state === 'results') PE.ui.drawResults(ctx, gs);
    }
    if (debug) drawDebug(gs, cam);
  }

  // ---------------------------------------------------------------- loop
  function frame(now) {
    globalThis.requestAnimationFrame(frame);
    var dtReal = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;
    if (dtReal > 0.25) dtReal = 0.25;
    if (dtReal < 0) dtReal = 0;
    fpsT += dtReal; fpsN++;
    if (fpsT >= 0.5) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }
    try {
      var t0 = performance.now();
      frameEv.length = 0;
      PE.game.frameEvents = frameEv;
      if (state === 'playing') { clock += dtReal; stepGame(dtReal); }
      else if (state === 'title' || state === 'results') {
        clock += dtReal;
        var gs = PE.game.state;
        if (PE.npc && PE.npc.update && dtReal > 0) PE.npc.update(Math.min(dtReal, 1 / 30), gs.player, PE.cam);
      }
      var t1 = performance.now();
      render();
      var t2 = performance.now();
      updMs = updMs * 0.9 + (t1 - t0) * 0.1;
      renMs = renMs * 0.9 + (t2 - t1) * 0.1;
    } catch (e) {
      report(e);
    }
    if (errMsg) drawError(errMsg, false);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    try {
      canvas = document.getElementById('game') || document.querySelector('canvas');
      ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      var cfg = C();
      PE.cam = { x: 0, y: 0, w: N(cfg.VIEW_W, 960), h: N(cfg.VIEW_H, 540) };
      var q = (globalThis.location && globalThis.location.search) || '';
      var m = /[?&]seed=(\d+)/.exec(q);
      if (m) seedParam = parseInt(m[1], 10) >>> 0;
      if (/[?&]debug=1/.test(q)) debug = true;
      if (!PE.CFG) throw new Error('PE.CFG missing (js/data.js not loaded?)');
      if (!PE.logic || !PE.art || !PE.city || !PE.npc || !PE.game || !PE.ui) {
        throw new Error('Missing module(s): ' + ['logic', 'art', 'city', 'npc', 'game', 'ui'].filter(function (k) { return !PE[k]; }).join(', '));
      }
      PE.art.init();
      PE.city.init();
      PE.city.initGraphics();
      if (PE.touch) {
        PE.touch.init(canvas, touchApi);
        if (PE.touch.enabled && PE.TEXT && PE.TEXT_TOUCH) for (var tk in PE.TEXT_TOUCH) PE.TEXT[tk] = PE.TEXT_TOUCH[tk];
      }
      PE.ui.init(canvas);
      PE.game.newRun(newSeed());
      PE.game.frameEvents = frameEv;
      updateCam();
      state = 'title';
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', clearKeys);
      window.addEventListener('pointerdown', function () { if (PE.sfx) PE.sfx.init(); });
      // iOS unlocks audio only on touchend / pointerup, not on a touch pointerdown
      window.addEventListener('pointerup', function () { if (PE.sfx) PE.sfx.init(); });
      window.addEventListener('touchend', function () { if (PE.sfx) PE.sfx.init(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { clearKeys(); if (state === 'playing') { state = 'paused'; photoQueued = false; } }
        lastT = 0;
      });
      globalThis.requestAnimationFrame(frame);
    } catch (e) {
      if (globalThis.console) console.error(e);
      drawError((e && (e.stack || e.message)) || String(e), true);
    }
  }

  PE.main = { boot: boot, getState: function () { return state; } };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(globalThis.PE = globalThis.PE || {});
