#!/usr/bin/env node
// HUSH MONEY v2 "night" - telemetry analysis (QA O4). Owner: QA. Zero dependencies.
// Usage: node tests/tools/telemetry.js export1.json [export2.json ...]   (prints a summary + JSON)
// Expected export shape (contract request, see QA M1 report):
//   { v: 1, runs: [ { seed, startedAt (ms), endedAt (ms), cases: [ {
//       def, spot, caseNo, ambient, path: [[tx,ty], ...] (tiles visited in order),
//       tApproach (s, spawn -> shot/abort), tShadow (s of tApproach spent unlit or out of every cone),
//       aborted (bool), duration (s, spawn -> resolve),
//       result: null | { points, M, frame, los, lit, dist, faces, dt } } ] } ] }
'use strict';

const TARGETS = {
  routesPerSpot: 2,          // >= 2 distinct routes per spot across runs
  nightShadowShare: 0.5,     // >= 50% of night approach time in shadow
  abortsPerRun: [0.5, 1.5],  // 0 = no tension, > 2 = frustration
  perfectAngleShare: [0.3, 0.6], // > 0.8 = angle adds nothing
  casePerSec: [13, 18], caseTooSlow: 20,
  retryWindowMs: 60000,
};

const bucket = (a) => (a >= 0.75 ? 'dusk' : a >= 0.5 ? 'mid' : 'night');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function analyze(exports) {
  const runs = [];
  for (const ex of [].concat(exports)) for (const r of (ex && ex.runs) || []) runs.push(r);
  runs.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const cases = [];
  for (const r of runs) for (const c of r.cases || []) cases.push(c);

  // route variety: distinct paths per spot (a path is its tile sequence; spots seen once are excluded)
  const bySpot = {};
  for (const c of cases) { if (!c.spot || !Array.isArray(c.path)) continue; (bySpot[c.spot] = bySpot[c.spot] || new Set()).add(c.path.map((p) => p.join(',')).join(';')); }
  const counts = {}; for (const c of cases) if (c.spot) counts[c.spot] = (counts[c.spot] || 0) + 1;
  const multi = Object.keys(bySpot).filter((s) => counts[s] >= 2);
  const routesPerSpot = mean(multi.map((s) => bySpot[s].size));

  // time in shadow by light bucket
  const shadow = {};
  for (const c of cases) { const b = bucket(+c.ambient || 0); shadow[b] = shadow[b] || [0, 0]; shadow[b][0] += +c.tShadow || 0; shadow[b][1] += +(c.tApproach != null ? c.tApproach : c.duration) || 0; }
  const shadowShare = {}; for (const b of Object.keys(shadow)) shadowShare[b] = shadow[b][1] ? shadow[b][0] / shadow[b][1] : null;

  // aborts
  const abortsPerRun = mean(runs.map((r) => (r.cases || []).filter((c) => c.aborted).length));
  const abortsByDef = {}; for (const c of cases) { const d = abortsByDef[c.def] = abortsByDef[c.def] || { cases: 0, aborts: 0 }; d.cases++; if (c.aborted) d.aborts++; }

  // angle factor
  const shots = cases.filter((c) => c.result && typeof c.result.M === 'number').map((c) => (c.angle && typeof c.angle.frame === 'number' ? Object.assign({}, c, { result: Object.assign({}, c.angle, c.result) }) : c));
  const perfectAngleShare = shots.length ? shots.filter((c) => c.result.M >= 1 - 1e-9).length / shots.length : null;
  const hist = [0, 0, 0, 0, 0];  // M buckets 0.5-0.6, -0.7, -0.8, -0.9, -1.0
  for (const c of shots) hist[Math.min(4, Math.max(0, Math.floor((c.result.M - 0.5) / 0.1)))]++;
  const componentMeans = {};
  for (const k of ['frame', 'los', 'lit', 'dist', 'faces']) componentMeans[k] = mean(shots.map((c) => +c.result[k]).filter((v) => isFinite(v)));

  // retries: a run that starts within 60 s of the previous run's end
  let retries = 0;
  for (let i = 1; i < runs.length; i++) if (runs[i].startedAt != null && runs[i - 1].endedAt != null && runs[i].startedAt - runs[i - 1].endedAt <= TARGETS.retryWindowMs) retries++;

  const timePerCase = mean(cases.map((c) => +c.duration).filter((v) => isFinite(v)));

  const flags = [];
  if (routesPerSpot != null && routesPerSpot < TARGETS.routesPerSpot) flags.push('route variety ' + routesPerSpot.toFixed(2) + ' < 2 routes/spot (hiding may not matter)');
  if (shadowShare.night != null && shadowShare.night < TARGETS.nightShadowShare) flags.push('night shadow share ' + (100 * shadowShare.night).toFixed(0) + '% < 50%');
  if (abortsPerRun != null && abortsPerRun === 0) flags.push('0 aborts per run (no tension)');
  if (abortsPerRun != null && abortsPerRun > 2) flags.push('aborts per run ' + abortsPerRun.toFixed(2) + ' > 2 (frustration)');
  if (perfectAngleShare != null && perfectAngleShare > 0.8) flags.push('perfect-angle share ' + (100 * perfectAngleShare).toFixed(0) + '% > 80% (angle adds nothing)');
  if (timePerCase != null && timePerCase > TARGETS.caseTooSlow) flags.push('time per case ' + timePerCase.toFixed(1) + ' s > 20 s (pacing)');

  return {
    runs: runs.length, cases: cases.length, routesPerSpot, spotsWithRepeats: multi.length, shadowShare, abortsPerRun, abortsByDef,
    perfectAngleShare, mHistogram: hist, componentMeans, retries, retryRate: runs.length > 1 ? retries / (runs.length - 1) : null,
    timePerCase, flags,
  };
}

function summary(a) {
  const p = (v) => (v == null ? '-' : (100 * v).toFixed(0) + '%'), f = (v, d) => (v == null ? '-' : v.toFixed(d == null ? 2 : d));
  return [
    'runs ' + a.runs + ', cases ' + a.cases,
    'route variety: ' + f(a.routesPerSpot) + ' routes/spot over ' + a.spotsWithRepeats + ' repeated spots (target >= 2)',
    'time in shadow: dusk ' + p(a.shadowShare.dusk) + ', mid ' + p(a.shadowShare.mid) + ', night ' + p(a.shadowShare.night) + ' (night target >= 50%)',
    'aborts per run: ' + f(a.abortsPerRun) + ' (target 0.5-1.5)',
    'perfect angle (M = 1): ' + p(a.perfectAngleShare) + ' (target 30-60%), M histogram 0.5..1.0: ' + a.mHistogram.join('/'),
    'retries within 60 s: ' + a.retries + ' (' + p(a.retryRate) + ')',
    'time per case: ' + f(a.timePerCase, 1) + ' s (target 13-18)',
    a.flags.length ? 'FLAGS: ' + a.flags.join(' | ') : 'no flags',
  ].join('\n');
}

module.exports = { analyze, summary, TARGETS };

if (require.main === module) {
  const fs = require('fs');
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node tests/tools/telemetry.js export.json [...]'); process.exit(2); }
  const a = analyze(files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  console.log(summary(a));
  console.log(JSON.stringify(a, null, 2));
}
