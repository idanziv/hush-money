// HUSH MONEY - static source checks (spec v0.2 sections 5, 12, 14.11). Owner: QA.
// Reads js/*.js as text; needs no game file to be loaded.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal fake 2D canvas: every method is a no-op (optionally logged); enough for art.init() to run headlessly.
function fakeCtx(log) {
  const store = {};
  return new Proxy({}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p in store) return store[p];
      if (p === 'getImageData' || p === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(0), width: w, height: h });
      if (p === 'measureText') return (str) => ({ width: String(str).length * 6 });
      if (/^create(Linear|Radial)Gradient$|^createPattern$/.test(String(p))) return () => ({ addColorStop() {} });
      return (...a) => { if (log) log.push(p); };
    },
    set(t, p, v) { store[p] = v; return true; },
  });
}

module.exports = (t) => {
  const JS = path.join(t.ROOT, 'js');
  const files = () => {
    if (!fs.existsSync(JS)) t.skip('SKIPPED (file missing: js/)');
    return fs.readdirSync(JS).filter((f) => f.endsWith('.js')).sort();
  };
  const src = (f) => fs.readFileSync(path.join(JS, f), 'utf8');
  const GREEN_RE = /39FF14/i;

  // Name of the innermost enclosing function-ish declaration for a line (heuristic, for review output only).
  function enclosing(lines, idx) {
    for (let i = idx; i >= 0; i--) {
      const m = /(?:function\s+([\w$]+)|([\w$.]+)\s*=\s*function|case\s+'([\w-]+)')/.exec(lines[i]);
      if (m) return m[1] || m[2] || ('case ' + m[3]);
    }
    return '(top level)';
  }

  // Lines that use the literal, or an identifier that was assigned the literal.
  function greenUses(text) {
    const lines = text.split(/\r?\n/), ids = new Set(), out = [];
    lines.forEach((l) => { const m = /([\w$]+)\s*[:=]\s*['"]#39FF14['"]/i.exec(l); if (m) ids.add(m[1]); });
    const idRe = ids.size ? new RegExp('\\b(' + [...ids].map((s) => s.replace(/\$/g, '\\$')).join('|') + ')\\b') : null;
    lines.forEach((l, i) => {
      const isDef = /([\w$]+)\s*[:=]\s*['"]#39FF14['"]/i.test(l);
      if (GREEN_RE.test(l) || (idRe && idRe.test(l))) out.push({ line: i + 1, text: l.trim(), fn: enclosing(lines, i), isDef });
    });
    return out;
  }

  t.test('color rule: #39FF14 literal only in data.js, art.js, ui.js', () => {
    const bad = [];
    for (const f of files()) {
      if (f === 'data.js' || f === 'art.js' || f === 'ui.js') continue;
      src(f).split(/\r?\n/).forEach((l, i) => { if (GREEN_RE.test(l)) bad.push('js/' + f + ':' + (i + 1) + ': ' + l.trim().slice(0, 100)); });
    }
    t.none(bad, '#39FF14 outside data/art/ui');
    const d = path.join(JS, 'data.js');
    if (fs.existsSync(d)) {
      const n = src('data.js').split(/\r?\n/).filter((l) => GREEN_RE.test(l));
      t.ok(n.length === 1 && /GLOW_COLOR/.test(n[0]), 'data.js uses #39FF14 only for CFG.GLOW_COLOR (' + n.length + ' lines)');
    }
  });

  t.test('color rule (review): #39FF14 uses in ui.js / art.js listed; non-scandal uses flagged (info, not a fail)', () => {
    const allow = { 'ui.js': /arrow|chevron|bracket|bubble|tag|scandal|viewfinder/i, 'art.js': /glow|ring|flare/i };
    let flagged = 0, total = 0;
    for (const f of ['ui.js', 'art.js']) {
      if (!fs.existsSync(path.join(JS, f))) continue;
      for (const u of greenUses(src(f))) {
        if (u.isDef) continue;
        total++;
        const ok = allow[f].test(u.fn) || allow[f].test(u.text);
        if (!ok) { flagged++; console.log('       REVIEW js/' + f + ':' + u.line + ' [' + u.fn + '] ' + u.text.slice(0, 110)); }
      }
    }
    console.log('       info: ' + total + ' #39FF14 uses in ui.js/art.js, ' + flagged + ' flagged for review');
  });

  t.test('no Math.random in data/logic/city/npc/game (seeded RNG only)', () => {
    const bad = [];
    for (const f of ['data.js', 'logic.js', 'city.js', 'npc.js', 'game.js']) {
      if (!fs.existsSync(path.join(JS, f))) continue;
      src(f).split(/\r?\n/).forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, '');
        if (/Math\.random\s*\(/.test(code)) bad.push('js/' + f + ':' + (i + 1) + ': ' + l.trim().slice(0, 100));
      });
    }
    t.none(bad, 'Math.random in game logic');
  });

  t.test('shadowBlur only in art.js (pre-render) - never in per-frame files', () => {
    const bad = [];
    for (const f of files()) {
      if (f === 'art.js') continue;
      src(f).split(/\r?\n/).forEach((l, i) => { if (/shadowBlur|\.filter\s*=/.test(l.replace(/\/\/.*$/, ''))) bad.push('js/' + f + ':' + (i + 1) + ': ' + l.trim().slice(0, 100)); });
    }
    t.none(bad, 'shadowBlur / ctx.filter outside art.js');
  });

  t.test('art.drawPeakFlare: flash-disc cutoff follows CFG.PEAK_FLASH_TIME / PEAK_FLARE_TIME (fallback 0.16)', () => {
    const file = path.join(JS, 'art.js');
    if (!fs.existsSync(file)) t.skip('SKIPPED (file missing: js/art.js)');
    const doc = { createElement: () => { const c = { width: 0, height: 0 }, x = fakeCtx(null); c.getContext = () => x; return c; } };
    const load = (cfg) => {
      const sb = { document: doc, PE: cfg ? { CFG: cfg } : {}, console };
      vm.createContext(sb);
      vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
      t.ok(sb.PE.art && sb.PE.art.init() !== false, 'art.init() ran on a fake canvas');
      return sb.PE.art;
    };
    const disc = (art, k) => { const log = []; art.drawPeakFlare(fakeCtx(log), 100, 100, k); return log.includes('drawImage'); };
    const base = load({ PEAK_FLARE_TIME: 0.5, PEAK_FLASH_TIME: 0.08 });          // cutoff 0.16
    t.eq([disc(base, 0.01), disc(base, 0.15), disc(base, 0.17), disc(base, 0.5)], [true, true, false, false], 'spec CFG: disc only for k < 0.16');
    const longer = load({ PEAK_FLARE_TIME: 0.5, PEAK_FLASH_TIME: 0.25 });        // cutoff 0.5
    t.eq([disc(longer, 0.3), disc(longer, 0.49), disc(longer, 0.51)], [true, true, false], 'PEAK_FLASH_TIME 0.25: disc until k 0.5');
    const none = load(null);                                                       // fallback 0.16
    t.eq([disc(none, 0.15), disc(none, 0.17)], [true, false], 'no CFG: fallback cutoff 0.16');
  });
};
