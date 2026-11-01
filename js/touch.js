// HUSH MONEY - touch.js (owner: eng-lead)
// Mobile controls: floating stick (left half), shutter (right half), pause button, menu taps.
// Touch/pen pointers only; mouse and keyboard play is untouched. All sprites pre-rendered in init.
(function (PE) {
  'use strict';

  var W = 960, H = 540;
  var R = 64;                          // stick travel radius (game px)
  var DEAD = 0.22;                     // dead zone, fraction of R
  var SHUT_X = W - 112, SHUT_Y = H - 142, SHUT_R = 54;
  var PAUSE_X = W - 30, PAUSE_Y = 70, PAUSE_HIT = 34;
  var TOP_BAND = 52;                   // score / CASE plates: no shooting from there
  var BTN_W = 150, BTN_H = 40, BTN_Y = H - 62;   // pause screen buttons
  var RESTART_X = W / 2 - 165, MUTE_X = W / 2 + 15;
  var OPTIONS_X = W / 2 + 195;                 // v1.2: OPTIONS button x 675..825, right of SOUND

  var T = { enabled: false };
  var canvas = null, api = null;
  var stick = { id: -1, bx: 0, by: 0, kx: 0, ky: 0 };
  var menuId = -1;                     // pointer that went down on a menu screen
  var shotT = -1;                      // performance.now() of the last shutter press (button flash)
  var spr = null;

  function now() { return (globalThis.performance && performance.now) ? performance.now() : Date.now(); }
  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function makeShutter(color) {
    var s = SHUT_R * 2 + 8, c = newCanvas(s, s), x = c.getContext('2d'), m = s / 2;
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.arc(m, m, SHUT_R, 0, Math.PI * 2); x.fill();
    x.lineWidth = 4; x.strokeStyle = color; x.beginPath(); x.arc(m, m, SHUT_R - 2, 0, Math.PI * 2); x.stroke();
    x.fillStyle = color; x.globalAlpha = 0.85; x.beginPath(); x.arc(m, m, SHUT_R - 14, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1; x.fillStyle = '#111111';
    x.font = 'bold 15px Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('SNAP', m, m + 1);
    return c;
  }
  function makeRing(r, fill, stroke) {
    var s = r * 2 + 6, c = newCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = fill; x.beginPath(); x.arc(s / 2, s / 2, r, 0, Math.PI * 2); x.fill();
    x.lineWidth = 3; x.strokeStyle = stroke; x.beginPath(); x.arc(s / 2, s / 2, r - 1.5, 0, Math.PI * 2); x.stroke();
    return c;
  }
  function makePause() {
    var c = makeRing(18, 'rgba(0,0,0,0.55)', 'rgba(255,255,255,0.8)'), x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(16, 13, 4, 16); x.fillRect(24, 13, 4, 16);
    return c;
  }
  function makeButton(text) {
    var c = newCanvas(BTN_W, BTN_H), x = c.getContext('2d');
    x.fillStyle = 'rgba(37,29,43,0.95)'; x.fillRect(0, 0, BTN_W, BTN_H);
    x.lineWidth = 2; x.strokeStyle = '#FFD23F'; x.strokeRect(1, 1, BTN_W - 2, BTN_H - 2);
    x.fillStyle = '#FFFFFF'; x.font = 'bold 18px Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';   // 12 CSS px at 740x360
    x.fillText(text, BTN_W / 2, BTN_H / 2 + 1);
    return c;
  }

  // ---------------------------------------------------------------- pointer mapping
  var gp = { x: 0, y: 0 };
  function toGame(e) {
    var r = canvas.getBoundingClientRect();
    gp.x = (e.clientX - r.left) * W / (r.width || 1);
    gp.y = (e.clientY - r.top) * H / (r.height || 1);
    return gp;
  }
  function isTouch(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; }
  function inRect(p, x, y, w, h) { return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; }
  function portrait() { return globalThis.innerHeight > globalThis.innerWidth; }
  function blocked() { return T.enabled && portrait(); }   // #rotate overlay covers the canvas

  function goFullscreen() {
    var d = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var req = d.requestFullscreen || d.webkitRequestFullscreen;   // iPad Safari: webkit only; iPhone: none
    if (!req) return;
    try {
      var p = req.call(d, { navigationUI: 'hide' });
      if (p && p.then) p.then(function () {
        if (globalThis.screen && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
      }).catch(function () {});
    } catch (e) { /* not allowed here: play windowed */ }
  }

  function onDown(e) {
    if (!isTouch(e)) return;
    T.enabled = true;
    if (e.cancelable) e.preventDefault();
    if (api.state() !== 'playing') { menuId = e.pointerId; return; }   // menus act on pointerup (a real tap)
    if (blocked()) return;                                              // no walking/shooting behind #rotate
    var p = toGame(e);
    if ((p.x - PAUSE_X) * (p.x - PAUSE_X) + (p.y - PAUSE_Y) * (p.y - PAUSE_Y) <= PAUSE_HIT * PAUSE_HIT) { api.pause(); stick.id = -1; return; }
    if (p.x < W / 2) {
      if (stick.id !== -1) return;
      stick.id = e.pointerId;
      stick.bx = p.x; stick.by = p.y;          // base at the finger: zero deflection on touch-down
      stick.kx = p.x; stick.ky = p.y;
    } else if (p.y > TOP_BAND) {
      api.shoot(); shotT = now();
    }
  }
  function onMove(e) {
    if (e.pointerId !== stick.id) return;
    if (e.cancelable) e.preventDefault();
    var p = toGame(e);
    stick.kx = p.x; stick.ky = p.y;
  }
  function onUp(e) {
    if (e.pointerId === stick.id) { stick.id = -1; return; }
    // only a tap that also began on this menu counts (not the finger that just hit pause or took the last photo)
    if (e.pointerId !== menuId) return;
    menuId = -1;
    if (!isTouch(e) || e.type === 'pointercancel') return;
    var st = api.state(), p = toGame(e);
    if (blocked()) { if (st === 'title') goFullscreen(); return; }     // fullscreen + landscape lock, no start yet
    if (st === 'title') { goFullscreen(); api.start(); }
    else if (st === 'results') api.start();
    else if (st === 'options') {                   // v1.2 options panel: SPEECH row cycles, BACK returns; elsewhere nothing
      var hit = PE.ui && PE.ui.optionsHit ? PE.ui.optionsHit(p.x, p.y) : null;
      if (hit === 'speech' && api.cycleSpeech) api.cycleSpeech();
      else if (hit === 'back' && api.back) api.back();
    }
    else if (st === 'paused') {
      if (inRect(p, RESTART_X, BTN_Y, BTN_W, BTN_H)) api.start();
      else if (inRect(p, MUTE_X, BTN_Y, BTN_W, BTN_H)) api.mute();
      else if (api.options && inRect(p, OPTIONS_X, BTN_Y, BTN_W, BTN_H)) api.options();
      else if (!portrait()) api.resume();
    }
  }

  // ---------------------------------------------------------------- API
  T.init = function (cv, handlers) {
    canvas = cv; api = handlers;
    W = cv.width; H = cv.height;
    try { T.enabled = !!(globalThis.matchMedia && matchMedia('(pointer: coarse)').matches); } catch (e) { T.enabled = false; }
    spr = {
      shutter: [makeShutter('#9A9A9A'), makeShutter('#FFB000'), makeShutter('#4FD8FF')],
      base: makeRing(R, 'rgba(0,0,0,0.3)', 'rgba(255,255,255,0.55)'),
      knob: makeRing(28, 'rgba(255,255,255,0.55)', 'rgba(0,0,0,0.6)'),
      knobJog: makeRing(28, 'rgba(255,210,63,0.75)', 'rgba(0,0,0,0.6)'),
      pause: makePause(),
      restart: makeButton('RESTART'),
      soundOn: makeButton('SOUND: ON'),
      soundOff: makeButton('SOUND: OFF'),
      options: makeButton(((PE.TEXT && PE.TEXT.options && PE.TEXT.options.title) || 'OPTIONS'))
    };
    window.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // no page scroll / pinch / double-tap zoom / long-press callout while playing
    document.addEventListener('touchstart', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', function () { if (T.enabled && portrait()) api.pause(); });
  };

  T.release = function () { stick.id = -1; };

  // v2 night (additive, read-only): raw stick deflection for facing hysteresis / turn-in-place.
  // Writes {active, dx, dy, len, r} into out (game px; r = stick radius) and returns it. v1 never calls it.
  T.stick = function (out) {
    out = out || {};
    out.active = stick.id !== -1; out.r = R;
    out.dx = out.active ? stick.kx - stick.bx : 0; out.dy = out.active ? stick.ky - stick.by : 0;
    out.len = Math.sqrt(out.dx * out.dx + out.dy * out.dy);
    return out;
  };

  // Merge the stick into the keyboard input (8 directions, like WASD; push to the rim to jog).
  T.read = function (input) {
    if (stick.id === -1) return;
    var dx = stick.kx - stick.bx, dy = stick.ky - stick.by, len = Math.sqrt(dx * dx + dy * dy);
    if (len < R * DEAD) return;
    var sec = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;   // 0 = right, 2 = down
    if (sec === 7 || sec === 0 || sec === 1) input.right = true;
    if (sec >= 1 && sec <= 3) input.down = true;
    if (sec >= 3 && sec <= 5) input.left = true;
    if (sec >= 5 && sec <= 7) input.up = true;
    if (len >= R) input.sprint = true;
  };

  T.draw = function (ctx, prox) {
    if (!T.enabled || !spr) return;
    var s = spr.shutter[prox === 2 ? 2 : (prox === 1 ? 1 : 0)], k;
    var pressed = shotT >= 0 && now() - shotT < 120;
    ctx.globalAlpha = pressed ? 1 : 0.8;
    ctx.drawImage(s, SHUT_X - s.width / 2, SHUT_Y - s.height / 2);
    ctx.globalAlpha = 1;
    ctx.drawImage(spr.pause, PAUSE_X - spr.pause.width / 2, PAUSE_Y - spr.pause.height / 2);
    if (stick.id === -1) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(spr.base, 120 - spr.base.width / 2, H - 130 - spr.base.height / 2);
      ctx.drawImage(spr.knob, 120 - spr.knob.width / 2, H - 130 - spr.knob.height / 2);
      ctx.globalAlpha = 1;
      return;
    }
    var dx = stick.kx - stick.bx, dy = stick.ky - stick.by, len = Math.sqrt(dx * dx + dy * dy);
    var f = len > R ? R / len : 1;
    k = len >= R ? spr.knobJog : spr.knob;
    // draw the base fully on screen even when the finger went down at an edge (logic still uses the finger)
    var bx = Math.max(R + 4, Math.min(W / 2 - R, stick.bx)), by = Math.max(R + 4, Math.min(H - R - 4, stick.by));
    ctx.drawImage(spr.base, Math.round(bx - spr.base.width / 2), Math.round(by - spr.base.height / 2));
    ctx.drawImage(k, Math.round(bx + dx * f - k.width / 2), Math.round(by + dy * f - k.height / 2));
  };

  T.drawPause = function (ctx, muted) {
    if (!T.enabled || !spr) return;
    ctx.drawImage(spr.restart, RESTART_X, BTN_Y);
    ctx.drawImage(muted ? spr.soundOff : spr.soundOn, MUTE_X, BTN_Y);
  };
  // v1.2: OPTIONS button on the pause screen (separate call so drawPause keeps its RESTART + SOUND contract).
  T.drawPauseOptions = function (ctx) {
    if (!T.enabled || !spr) return;
    ctx.drawImage(spr.options, OPTIONS_X, BTN_Y);
  };

  PE.touch = T;
})(globalThis.PE = globalThis.PE || {});
