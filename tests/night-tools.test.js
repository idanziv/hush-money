// HUSH MONEY v2 "night" - self-tests for QA tools: telemetry analysis (O4) and the in-browser perf harness. Owner: QA.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TEL = require('./tools/telemetry.js');

module.exports = (t) => {
  const run = (start, cases) => ({ seed: 1, startedAt: start, endedAt: start + 120000, cases });
  const cs = (def, spot, amb, path, o) => Object.assign({ def, spot, caseNo: 1, ambient: amb, path, tApproach: 10, tShadow: 0, aborted: false, duration: 15, result: { points: 1500, M: 1, frame: 1, los: 1, lit: 1, dist: 1, faces: 1, dt: 0 } }, o || {});

  t.test('telemetry: route variety, shadow share by light, aborts, perfect-angle share, retries, time per case', () => {
    const A = [[1, 1], [1, 2], [1, 3]], B = [[1, 1], [2, 1], [3, 1]];
    const ex = { v: 1, runs: [
      run(0, [cs('affair', 's1', 0.9, A, { tShadow: 2 }), cs('bribe', 's2', 0.12, A, { tShadow: 8, aborted: true, result: null })]),
      run(130000, [cs('affair', 's1', 0.9, B, { tShadow: 4, result: { points: 900, M: 0.8, frame: 1, los: 1, lit: 0, dist: 0.5, faces: 0, dt: 0.4 } }), cs('bribe', 's2', 0.12, A, { tShadow: 6 })]),
      run(400000, [cs('protest', 's3', 0.55, B, { duration: 25 })]),
    ] };
    const a = TEL.analyze(ex);
    t.eq([a.runs, a.cases], [3, 5], 'counts');
    t.near(a.routesPerSpot, 1.5, 1e-9, 'routes per repeated spot (s1: 2 routes, s2: 1 route)');
    t.near(a.shadowShare.night, 14 / 20, 1e-9, 'night shadow share');
    t.near(a.shadowShare.dusk, 6 / 20, 1e-9, 'dusk shadow share');
    t.near(a.abortsPerRun, 1 / 3, 1e-9, 'aborts per run');
    t.eq(a.abortsByDef.bribe, { cases: 2, aborts: 1 }, 'aborts by def');
    t.near(a.perfectAngleShare, 3 / 4, 1e-9, 'perfect-angle share');
    t.eq(a.retries, 1, 'retries within 60 s (130 s start after a 120 s run)');
    t.near(a.timePerCase, (15 * 4 + 25) / 5, 1e-9, 'time per case');
    t.ok(a.flags.some((f) => /route variety/.test(f)), 'flags low route variety');
    t.ok(typeof TEL.summary(a) === 'string', 'summary prints');
  });

  t.test('telemetry: empty / partial exports never throw', () => {
    const a = TEL.analyze([{}, { runs: [] }, { runs: [{ cases: [{ def: 'x' }] }] }]);
    t.eq(a.runs, 1, 'one run'); t.eq(a.flags.filter((f) => /NaN/.test(f)), [], 'no NaN flags');
    TEL.summary(a);
  });

  t.test('perf harness (tests/tools/night-perf.js): drives a stub page at 120 Hz, times the light pass, restores rAF', async () => {
    let queue = [], now = 0, lightCalls = 0;
    const sb = {
      performance: { now: () => now }, setTimeout: (f) => { f(); return 1; },
      document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ canvas: {} }) }) },
    };
    sb.window = sb;
    const realRaf = (f) => { queue.push(f); return 1; };
    sb.requestAnimationFrame = realRaf;
    const tick = () => { const q = queue; queue = []; for (const f of q) f(now); };      // one browser frame
    sb.PE = { light: { draw() { lightCalls++; now += 0.5; } } };
    const loop = () => { now += 1; sb.PE.light.draw({ canvas: { width: 960, height: 540 } }); sb.requestAnimationFrame(loop); };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'tools', 'night-perf.js'), 'utf8'), sb);
    sb.requestAnimationFrame(loop);                     // the page's loop is armed
    const p = sb.__nightPerf.run({ hz: 120, frames: 50, warmup: 5, throttle: 4 });
    tick();                                             // the harness waits one real frame; the page re-arms via the stub
    const out = await p;
    t.eq(out.frames, 50, 'frames measured');
    t.near(out.light.p50, 2.0, 1e-9, 'light pass x4 throttle = 4 x 0.5 ms');
    t.ok(out.frame.p50 >= 3, 'frame time includes the light pass (' + out.frame.p50 + ')');
    t.eq(out.gate.lightP99_le_2ms_throttled, true, 'gate at exactly 2.0 ms passes');
    t.ok(lightCalls >= 55 * 4, 'light pass re-run for the throttle (' + lightCalls + ' calls)');
    t.ok(sb.requestAnimationFrame === realRaf, 'rAF handed back');
    t.eq(queue.length, 1, 'the page loop is re-armed on the real rAF');
  });
};
