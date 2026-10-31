// HUSH MONEY - sfx.js (owner: eng-lead)
// Tiny WebAudio synth. No audio files. Silently no-ops if WebAudio is unavailable.
(function (PE) {
  'use strict';

  var S = { muted: false };
  var ac = null, master = null, noiseBuf = null, failed = false;

  // iOS: the context starts (or returns from a call/background as 'interrupted') suspended; it only unlocks
  // inside a touchend/pointerup gesture, and older WebKit also needs a buffer started in that gesture.
  function wake() {
    if (!ac || ac.state === 'running') return;     // retried on every gesture until it runs
    try {
      if (ac.resume) { var p = ac.resume(); if (p && p.catch) p.catch(function () {}); }
      var src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, 22050);
      src.connect(ac.destination); src.start(0);
    } catch (e) { /* ignore: try again on the next gesture */ }
  }

  S.init = function () {
    if (ac || failed) { wake(); return; }
    try {
      var AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { failed = true; return; }
      ac = new AC();
      master = ac.createGain();
      master.gain.value = S.muted ? 0 : 0.5;
      master.connect(ac.destination);
      var len = Math.floor(ac.sampleRate * 0.25);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      var d = noiseBuf.getChannelData(0), seed = 12345;
      for (var i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
      wake();
    } catch (e) { failed = true; ac = null; }
  };

  function tone(type, f0, f1, t0, dur, vol) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(t0, dur, vol, freq) {
    var src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  var SOUNDS = {
    shutter: function (t) { noise(t, 0.05, 0.9, 3500); noise(t + 0.07, 0.09, 0.7, 2200); tone('square', 1800, 900, t, 0.03, 0.15); },
    perfect: function (t) { var n = [660, 880, 1100, 1320]; for (var i = 0; i < 4; i++) tone('square', n[i], n[i], t + 0.12 + i * 0.07, 0.12, 0.12); },
    fail: function (t) { tone('sawtooth', 320, 110, t + 0.08, 0.35, 0.18); },
    spawn: function (t) { tone('sine', 1250, 1250, t, 0.09, 0.25); tone('sine', 1250, 1250, t + 0.14, 0.09, 0.25); tone('sine', 1250, 1250, t + 0.28, 0.09, 0.25); },
    // bright two-note ping (B6 -> E7), distinct from the noise-based shutter
    peak: function (t) { tone('sine', 1976, 1976, t, 0.1, 0.3); tone('triangle', 1976, 1976, t, 0.08, 0.08); tone('sine', 2637, 2637, t + 0.09, 0.22, 0.3); tone('triangle', 5274, 5274, t + 0.09, 0.12, 0.04); },
    tick: function (t) { tone('triangle', 2400, 1800, t, 0.04, 0.2); }
  };

  S.play = function (name) {
    if (!ac || S.muted) return;
    var fn = SOUNDS[name];
    if (!fn) return;
    try {
      if (ac.state !== 'running') wake();
      fn(ac.currentTime + 0.005);
    } catch (e) { /* never break the game for audio */ }
  };

  S.toggleMute = function () {
    S.muted = !S.muted;
    if (master) { try { master.gain.value = S.muted ? 0 : 0.5; } catch (e) { /* ignore */ } }
    return S.muted;
  };

  PE.sfx = S;
})(globalThis.PE = globalThis.PE || {});
