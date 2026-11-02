// HUSH MONEY v2 "night" - in-browser perf harness for spike/ and night.html (QA M1 item 4). Owner: QA.
// Paste/inject into the page (it touches nothing until run):  await __nightPerf.run({ hz: 120, frames: 600, throttle: 4 })
// - Takes over requestAnimationFrame and drives the page's own frame callback at exact 60/90/120 Hz timestamps.
// - Times every light pass: wraps PE.light.draw (or opts.lightFn = [object, 'method']).
// - throttle N: the light pass is re-run N-1 extra times per frame onto a scratch canvas and counted, which
//   approximates an N x slower CPU for the light pass (the pane cannot apply DevTools CPU throttling).
// Returns { hz, frames, light: {p50, p99, max}, frame: {p50, p99, max, overBudget}, budgetMs, gate: {lightP99<=2ms} }.
(function () {
  'use strict';
  const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  async function run(opts) {
    opts = Object.assign({ hz: 120, frames: 600, throttle: 1, warmup: 60 }, opts || {});
    const PE = window.PE || {};
    const target = opts.lightFn || (PE.light && typeof PE.light.draw === 'function' ? [PE.light, 'draw'] : null);
    const lightMs = [], frameMs = [];
    let scratch = null, inFrame = false, lightThisFrame = 0;
    let restoreLight = null;
    if (target) {
      const [obj, name] = target, orig = obj[name];
      obj[name] = function (ctx) {
        const a = performance.now();
        const r = orig.apply(this, arguments);
        for (let k = 1; k < opts.throttle; k++) {
          if (!scratch) { scratch = document.createElement('canvas'); scratch.width = ctx.canvas.width; scratch.height = ctx.canvas.height; }
          const args = Array.prototype.slice.call(arguments); args[0] = scratch.getContext('2d');
          orig.apply(this, args);
        }
        lightThisFrame += performance.now() - a;
        return r;
      };
      restoreLight = () => { obj[name] = orig; };
    }
    // take over rAF
    const origRaf = window.requestAnimationFrame;
    let cb = null;
    window.requestAnimationFrame = (f) => { cb = f; return 1; };
    await new Promise((res) => origRaf(() => res()));     // let the page's loop re-arm through our stub
    await new Promise((res) => setTimeout(res, 50));
    if (!cb) { window.requestAnimationFrame = origRaf; if (restoreLight) restoreLight(); throw new Error('page did not request a frame'); }
    let ts = performance.now();
    const step = 1000 / opts.hz;
    for (let i = 0; i < opts.frames + opts.warmup; i++) {
      const f = cb; cb = null; ts += step; lightThisFrame = 0;
      const a = performance.now(); f(ts); const ms = performance.now() - a;
      if (i >= opts.warmup) { frameMs.push(ms); if (target) lightMs.push(lightThisFrame); }
      if (!cb) break;
      if (i % 30 === 29) await new Promise((res) => setTimeout(res, 0));   // keep the tab responsive
    }
    // hand the loop back to the real rAF
    const pending = cb; window.requestAnimationFrame = origRaf; if (restoreLight) restoreLight();
    if (pending) origRaf(pending);
    const budget = 1000 / opts.hz;
    const out = {
      hz: opts.hz, frames: frameMs.length, throttle: opts.throttle, budgetMs: +budget.toFixed(2),
      light: target ? { p50: +pct(lightMs, 0.5).toFixed(3), p99: +pct(lightMs, 0.99).toFixed(3), max: +Math.max(...lightMs).toFixed(3) } : null,
      frame: { p50: +pct(frameMs, 0.5).toFixed(3), p99: +pct(frameMs, 0.99).toFixed(3), max: +Math.max(...frameMs).toFixed(3), overBudget: frameMs.filter((m) => m > budget).length },
    };
    out.gate = { lightP99_le_2ms_throttled: out.light ? out.light.p99 <= 2 : null, frameP99_le_9ms: out.frame.p99 <= 9 };
    return out;
  }
  async function suite(extra) {
    const rows = [];
    for (const hz of [60, 90, 120]) for (const throttle of [1, 4]) rows.push(await run(Object.assign({ hz, throttle, frames: 480 }, extra || {})));
    return rows;
  }
  window.__nightPerf = { run, suite };
})();
