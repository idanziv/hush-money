// HUSH MONEY - data.js content & contract tests (spec sections 8, 10, 14.3, 14.4). Owner: QA.
'use strict';
const S = require('./spec.js');

module.exports = (t, PE) => {
  const need = () => t.needs('data');
  const RISE = S.CFG.RISE;
  const lookOk = (l) => S.PRESET_LOOKS.includes(l) || S.AMBIENT_LOOKS.includes(l);
  const textIssues = (s, where, maxLen) => {
    const out = [];
    if (typeof s !== 'string' || !s.trim()) { out.push(where + ': not a non-empty string (' + JSON.stringify(s) + ')'); return out; }
    if (maxLen && s.length > maxLen) out.push(where + ': ' + s.length + ' chars > ' + maxLen + ': "' + s + '"');
    if (S.HEBREW_RE.test(s)) out.push(where + ': Hebrew script: "' + s + '"');
    else if (S.RTL_RE.test(s)) out.push(where + ': RTL script: "' + s + '"');
    if (S.EMOJI_RE.test(s)) out.push(where + ': emoji/pictograph (no emoji in canvas text): "' + s + '"');
    return out;
  };

  // ---------------- CFG ----------------
  t.test('CFG: every 14.3 scalar key present with the exact spec value', () => {
    need();
    const c = PE.CFG;
    t.ok(c && typeof c === 'object', 'PE.CFG exists');
    const bad = [];
    for (const k of Object.keys(S.CFG)) {
      if (k === 'GRADES' || k === 'RANKS') continue;
      if (!(k in c)) bad.push(k + ': missing');
      else if (c[k] !== S.CFG[k]) bad.push(k + ': expected ' + S.CFG[k] + ', got ' + JSON.stringify(c[k]));
    }
    t.none(bad, 'CFG values');
  });

  t.test('CFG.GRADES: descending, spec mins and labels, catch-all last', () => {
    need();
    const g = PE.CFG.GRADES;
    t.ok(Array.isArray(g) && g.length === 5, 'GRADES is an array of 5 (got ' + (g && g.length) + ')');
    for (let i = 0; i < 4; i++) t.eq({ min: g[i].min, label: g[i].label }, S.CFG.GRADES[i], 'GRADES[' + i + ']');
    t.eq(g[4].label, 'BLURRY GOSSIP', 'GRADES[4].label');
    t.ok(g[4].min <= 0, 'last grade is a catch-all (min <= 0), got ' + g[4].min);
    for (let i = 1; i < g.length; i++) t.ok(g[i].min < g[i - 1].min, 'descending at ' + i);
  });

  t.test('CFG.RANKS: descending, spec mins and labels, last min -Infinity', () => {
    need();
    const r = PE.CFG.RANKS;
    t.ok(Array.isArray(r) && r.length === 5, 'RANKS is an array of 5');
    for (let i = 0; i < 5; i++) t.eq({ min: r[i].min, label: r[i].label }, S.CFG.RANKS[i], 'RANKS[' + i + ']');
  });

  // ---------------- SCANDALS ----------------
  t.test('SCANDALS: exactly the 7 spec defs (ids, titles, role counts, kinds, peak actions)', () => {
    need();
    const defs = PE.SCANDALS;
    t.ok(Array.isArray(defs), 'PE.SCANDALS is an array');
    t.eq(defs.length, 7, 'def count');
    t.eq(new Set(defs.map((d) => d.id)).size, defs.length, 'unique ids');
    const bad = [];
    for (const sp of S.SCANDALS) {
      const d = defs.find((x) => x.id === sp.id);
      if (!d) { bad.push(sp.id + ': missing'); continue; }
      if (d.title !== sp.title) bad.push(sp.id + ': title "' + d.title + '" != "' + sp.title + '"');
      if (!Array.isArray(d.roles) || d.roles.length !== sp.roles) bad.push(sp.id + ': roles ' + (d.roles && d.roles.length) + ' != ' + sp.roles);
      const kinds = Array.isArray(d.kinds) ? d.kinds.slice().sort() : [];
      if (JSON.stringify(kinds) !== JSON.stringify(sp.kinds.slice().sort())) bad.push(sp.id + ': kinds ' + JSON.stringify(d.kinds) + ' != ' + JSON.stringify(sp.kinds));
      if (!d.peak || d.peak.action !== sp.action) bad.push(sp.id + ': peak.action ' + JSON.stringify(d.peak && d.peak.action) + ' != ' + sp.action);
      for (const [prop, n] of sp.props) {
        const cnt = (d.roles || []).filter((r) => r.prop === prop || r.peakProp === prop).length;
        if (cnt < n) bad.push(sp.id + ': needs >= ' + n + ' role(s) with prop/peakProp "' + prop + '", has ' + cnt);
      }
    }
    t.none(bad, 'spec table (sec 8)');
  });

  t.test('SCANDALS: def shape - strings, kinds, actions, 2-4 roles with valid look/prop/dir/offsets', () => {
    need();
    const bad = [];
    for (const d of PE.SCANDALS) {
      const id = d.id;
      for (const f of ['id', 'title', 'tip', 'caption']) if (typeof d[f] !== 'string' || !d[f].trim()) bad.push(id + '.' + f + ' missing/empty');
      if (!Array.isArray(d.kinds) || !d.kinds.length) bad.push(id + '.kinds empty');
      else for (const k of d.kinds) if (!S.SPOT_KINDS.includes(k)) bad.push(id + ': bad kind "' + k + '"');
      if (!d.peak || !S.ACTIONS.includes(d.peak.action)) bad.push(id + ': bad peak.action ' + JSON.stringify(d.peak));
      if (!Array.isArray(d.roles) || d.roles.length < 2 || d.roles.length > 4) { bad.push(id + ': roles must be 2-4'); continue; }
      d.roles.forEach((r, i) => {
        const w = id + '.roles[' + i + ']';
        if (typeof r.name !== 'string' || !r.name.trim()) bad.push(w + '.name missing');
        if (!lookOk(r.look)) bad.push(w + ': look "' + r.look + '" not a preset or amb0..amb23');
        if (!S.PROPS.includes(r.prop)) bad.push(w + ': prop ' + JSON.stringify(r.prop) + ' not in 14.2 list');
        if (r.peakProp !== undefined && !S.PROPS.includes(r.peakProp)) bad.push(w + ': peakProp ' + JSON.stringify(r.peakProp) + ' not in 14.2 list');
        if (!Number.isInteger(r.dir) || r.dir < 0 || r.dir > 7) bad.push(w + ': dir ' + r.dir + ' not 0..7');
        for (const k of ['dx', 'dy']) if (typeof r[k] !== 'number' || !isFinite(r[k])) bad.push(w + '.' + k + ' not a number');
        for (const k of ['pdx', 'pdy']) if (r[k] !== undefined && (typeof r[k] !== 'number' || !isFinite(r[k]))) bad.push(w + '.' + k + ' not a number');
        // 14.4: offsets <= 40 px
        for (const k of ['dx', 'dy', 'pdx', 'pdy']) if (typeof r[k] === 'number' && Math.abs(r[k]) > 40) bad.push(w + '.' + k + '=' + r[k] + ' exceeds 40 px (14.4)');
      });
    }
    t.none(bad, 'def shape');
  });

  t.test('SCANDALS: sec 8 timing (>=5 setup < 8.8, one cue in [8.8,9.8], none in (9.8,11.6), >=2 in [11.6,17.5], 0.3..17.5, >=1.8 s apart)', () => {
    need();
    const T = S.TIMING, bad = [];
    for (const d of PE.SCANDALS) {
      const L = d.lines;
      if (!Array.isArray(L)) { bad.push(d.id + ': lines missing'); continue; }
      for (let i = 0; i < L.length; i++) {
        const a = L[i].at;
        if (typeof a !== 'number' || !(a >= T.AT_MIN && a <= T.AT_MAX)) bad.push(d.id + '.lines[' + i + '].at=' + a + ' outside 0.3..17.5');
        if (i > 0 && !(a > L[i - 1].at)) bad.push(d.id + '.lines[' + i + '].at=' + a + ' not ascending');
        if (i > 0 && a - L[i - 1].at < T.GAP - 1e-9) bad.push(d.id + '.lines[' + i + '] only ' + (a - L[i - 1].at).toFixed(2) + 's after previous (< 1.8)');
      }
      const setup = L.filter((l) => l.at < T.SETUP_BEFORE).length;
      const cue = L.filter((l) => l.at >= T.CUE_LO && l.at <= T.CUE_HI).length;
      const quiet = L.filter((l) => l.at > T.CUE_HI && l.at < T.QUIET_HI).map((l) => l.at);
      const after = L.filter((l) => l.at >= T.QUIET_HI && l.at <= T.AT_MAX).length;
      if (setup < T.SETUP_MIN) bad.push(d.id + ': ' + setup + ' setup lines (at < 8.8), need >= 5');
      if (cue !== 1) bad.push(d.id + ': ' + cue + ' cue lines in [8.8, 9.8], need exactly 1');
      if (quiet.length) bad.push(d.id + ': lines in the quiet zone (9.8, 11.6): ' + quiet.join(', '));
      if (after < T.AFTER_MIN) bad.push(d.id + ': ' + after + ' lines in [11.6, 17.5], need >= 2');
    }
    t.none(bad, 'line timing');
  });

  t.test('SCANDALS: tip is a template with {area}, <= 40 chars before substitution', () => {
    need();
    const bad = [];
    for (const d of PE.SCANDALS) {
      if (typeof d.tip !== 'string') { bad.push(d.id + ': no tip'); continue; }
      if (d.tip.indexOf('{area}') < 0) bad.push(d.id + ': tip has no {area}: "' + d.tip + '"');
      if (d.tip.length > 40) bad.push(d.id + ': tip ' + d.tip.length + ' chars > 40: "' + d.tip + '"');
      if (d.tip.split('{area}').length !== 2) bad.push(d.id + ': tip should contain {area} exactly once');
    }
    t.none(bad, 'tips');
  });

  t.test('SCANDALS: lines/bust/expire - role indices, counts, <=48 chars, no Hebrew/RTL/emoji', () => {
    need();
    const bad = [];
    for (const d of PE.SCANDALS) {
      const nr = (d.roles || []).length;
      const chk = (arr, name) => (arr || []).forEach((l, i) => {
        const w = d.id + '.' + name + '[' + i + ']';
        if (!Number.isInteger(l.r) || l.r < 0 || l.r >= nr) bad.push(w + ': r=' + l.r + ' not a valid role index (0..' + (nr - 1) + ')');
        bad.push(...textIssues(l.s, w, 48));
      });
      chk(d.lines, 'lines');
      if (!Array.isArray(d.bust) || d.bust.length !== 2) bad.push(d.id + ': bust must have exactly 2 lines (has ' + (d.bust && d.bust.length) + ')');
      chk(d.bust, 'bust');
      if (!Array.isArray(d.expire) || d.expire.length !== 1) bad.push(d.id + ': expire must have exactly 1 line (has ' + (d.expire && d.expire.length) + ')');
      chk(d.expire, 'expire');
      for (const f of ['title', 'tip', 'caption']) bad.push(...textIssues(d[f], d.id + '.' + f, 0));
      (d.roles || []).forEach((r, i) => bad.push(...textIssues(r.name, d.id + '.roles[' + i + '].name', 0)));
    }
    t.none(bad, 'scandal text');
  });

  // ---------------- LINES ----------------
  t.test('LINES: every sec-10 category present with >= 8 lines, >= 140 total', () => {
    need();
    const L = PE.LINES;
    t.ok(L && typeof L === 'object', 'PE.LINES exists');
    const bad = [];
    let total = 0;
    for (const c of S.LINE_CATEGORIES) {
      if (!Array.isArray(L[c])) { bad.push(c + ': missing'); continue; }
      if (L[c].length < 8) bad.push(c + ': only ' + L[c].length + ' lines');
    }
    for (const c of Object.keys(L)) if (Array.isArray(L[c])) total += L[c].length;
    t.none(bad, 'categories');
    t.ok(total >= 140, 'total lines >= 140 (got ' + total + ')');
  });

  t.test('LINES: every line non-empty, <= 48 chars, no Hebrew/RTL/emoji', () => {
    need();
    const bad = [];
    for (const c of Object.keys(PE.LINES)) {
      const arr = PE.LINES[c];
      if (!Array.isArray(arr)) { bad.push(c + ': not an array'); continue; }
      arr.forEach((s, i) => bad.push(...textIssues(s, 'LINES.' + c + '[' + i + ']', 48)));
    }
    t.none(bad, 'ambient lines');
  });

  // ---------------- TEXT ----------------
  t.test('TEXT: title, subtitle, controls, pause, resultsHint', () => {
    need();
    const T = PE.TEXT;
    t.ok(T && typeof T === 'object', 'PE.TEXT exists');
    t.eq(T.title, 'HUSH MONEY', 'title');
    t.ok(typeof T.subtitle === 'string' && T.subtitle.trim(), 'subtitle');
    t.ok(typeof T.start === 'string' && T.start.trim(), 'TEXT.start (v0.2)');
    t.ok(typeof T.hint1 === 'string' && T.hint1.trim(), 'TEXT.hint1 (v0.2)');
    t.ok(T.hint1.length <= 60, 'TEXT.hint1 <= 60 chars (got ' + T.hint1.length + ': "' + T.hint1 + '")');
    t.ok(!/flash/i.test(T.hint1), 'TEXT.hint1 teaches anticipation, must not say "flash": "' + T.hint1 + '"');
    t.ok(Array.isArray(T.controls) && T.controls.length >= 1 && T.controls.every((s) => typeof s === 'string' && s.trim()), 'controls: non-empty list of strings');
    t.ok(typeof T.pause === 'string' && T.pause.trim(), 'pause string');
    t.ok(typeof T.resultsHint === 'string' && /blackmail again/i.test(T.resultsHint), 'resultsHint mentions "blackmail again": ' + JSON.stringify(T.resultsHint));
    const bad = [];
    for (const k of ['title', 'subtitle', 'start', 'hint1', 'pause', 'resultsHint']) bad.push(...textIssues(T[k], 'TEXT.' + k, 0));
    (T.controls || []).forEach((s, i) => bad.push(...textIssues(s, 'TEXT.controls[' + i + ']', 0)));
    t.none(bad, 'TEXT strings');
  });

  t.test('data.js is pure data at load: PE.CFG/SCANDALS/LINES/TEXT present, no functions in CFG', () => {
    need();
    for (const k of ['CFG', 'SCANDALS', 'LINES', 'TEXT']) t.ok(PE[k], 'PE.' + k);
    const fns = Object.keys(PE.CFG).filter((k) => typeof PE.CFG[k] === 'function');
    t.eq(fns, [], 'functions in CFG');
  });
};
