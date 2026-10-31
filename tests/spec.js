// HUSH MONEY - spec constants transcribed from docs/01-design-and-tech-spec.md (v0.3 RC).
// Owned by QA. This is the test oracle: tests compare the game files against THESE values,
// never against values read from the game itself. Not a *.test.js file, so the runner does not run it.
'use strict';

const CFG = Object.freeze({
  TILE: 32, MAP_W: 96, MAP_H: 64, VIEW_W: 960, VIEW_H: 540, DT: 1 / 60,
  PLAYER_SPEED: 140, SPRINT_MULT: 1.5, NPC_SPEED: 55, PERSON_RADIUS: 7,
  RISE: 11, FALL: 7, MIN_GLOW: 0.10, ACTION_LEAD: 1.0, ACTION_TAIL: 1.5,
  PEAK_FLARE_TIME: 0.5, PEAK_FLASH_TIME: 0.08, BUST_FADE: 0.3,
  PHOTO_RANGE: 170, NEAR_MULT: 1.6, PHOTO_COOLDOWN: 0.6,
  BASE_POINTS: 1000, PERFECT_WINDOW: 0.25, PERFECT_BONUS: 500, MIN_POINTS: 50,
  PENALTY_NO_SCANDAL: 150, PENALTY_TOO_FAR: 100,
  SCANDALS_PER_RUN: 6, FIRST_DELAY: 2, GAP: 3, END_DELAY: 2,
  SPAWN_MIN_TILES: 18, SPAWN_MAX_TILES: 34, SPAWN_OFFSCREEN_MARGIN: 64,
  RELAX_MIN_TILES: 8, RELAX_MAX_TILES: 40,
  BUSTED_FLEE_TIME: 4, BUBBLE_TTL: 2.4, MAX_AMBIENT_BUBBLES: 3, BUMP_COOLDOWN: 10, AMBIENT_COUNT: 60,
  GLOW_COLOR: '#39FF14',
  GRADES: Object.freeze([
    { min: 1500, label: 'PERFECT SHOT' },
    { min: 750, label: 'FRONT PAGE' },
    { min: 400, label: 'JUICY' },
    { min: 150, label: 'TABLOID FILLER' },
    { min: -Infinity, label: 'BLURRY GOSSIP' },
  ]),
  RANKS: Object.freeze([
    { min: 7500, label: 'Kingpin of Kompromat' },
    { min: 5000, label: 'Professional Sleazeball' },
    { min: 2500, label: 'Paparazzo with Debts' },
    { min: 0, label: 'Tourist with a Camera' },
    { min: -Infinity, label: 'Owes the Tabloids Money' },
  ]),
});

const SPOT_KINDS = ['boulevard', 'park', 'alley', 'cafe', 'beach', 'market', 'plaza', 'kiosk'];
const ZONES = ['beach', 'promenade', 'boulevard', 'market', 'alley', 'park', 'plaza', 'cafe', 'street'];
const PRESET_LOOKS = ['detective', 'suit', 'trainer', 'dealer', 'hoodie', 'hipster', 'politician', 'contractor',
  'influencer', 'assistant', 'footballer', 'bookie', 'inspector', 'chef', 'protester', 'tourist', 'surfer',
  'jogger', 'grandma', 'vendor', 'lifeguard', 'sunbather', 'dog'];
const AMBIENT_LOOKS = Array.from({ length: 24 }, (_, i) => 'amb' + i);
const PROPS = ['none', 'envelope', 'package', 'phone', 'sign', 'cards', 'cash', 'trashbag', 'clipboard', 'paddle', 'coffee'];
const ACTIONS = ['kiss', 'deal', 'handoff', 'pose', 'shout', 'shake'];
const LINE_CATEGORIES = ['walker', 'phone', 'cafe', 'vendor_falafel', 'vendor_kiosk', 'vendor_market', 'beach',
  'jogger', 'matkot', 'dogwalker', 'scooter', 'bump', 'photographed', 'player_good', 'player_bad', 'player_miss',
  'player_idle'];
const POI_TYPES = ['kiosk', 'falafel', 'stall', 'cafe_table', 'bench', 'lifeguard', 'matkot', 'umbrella', 'sunbathe'];
// [type, min, exact?]
// sec 8 line timing (RISE 11)
const TIMING = { SETUP_BEFORE: 8.8, SETUP_MIN: 5, CUE_LO: 8.8, CUE_HI: 9.8, QUIET_HI: 11.6, AFTER_MIN: 2, AT_MIN: 0.3, AT_MAX: 17.5, GAP: 1.8 };
const MAX_RUN_S = 2 + 6 * 18 + 5 * 3 + 2; // 127 s (sec 3)
const CYAN = '#4FD8FF';
const POI_COUNTS = [['kiosk', 2], ['falafel', 2], ['stall', 6], ['cafe_table', 8], ['bench', 10],
  ['lifeguard', 2, true], ['matkot', 2, true], ['umbrella', 6], ['sunbathe', 4]];

// Section 8 table. props: props that must appear on some role (prop or peakProp), with min role count.
const SCANDALS = [
  { id: 'affair', title: 'The Boulevard Affair', roles: 2, kinds: ['boulevard', 'park'], action: 'kiss', props: [] },
  { id: 'drug_deal', title: 'Alley Pharmacy', roles: 3, kinds: ['alley', 'market'], action: 'deal', props: [['package', 1]] },
  { id: 'bribe', title: 'Permit Express', roles: 2, kinds: ['cafe', 'plaza'], action: 'handoff', props: [['envelope', 1]] },
  { id: 'influencer', title: '#SaveTheSea', roles: 2, kinds: ['beach'], action: 'pose', props: [['phone', 1], ['trashbag', 1]] },
  { id: 'match_fix', title: 'Penalty for Sale', roles: 2, kinds: ['kiosk', 'park'], action: 'shake', props: [] },
  { id: 'inspector', title: 'Five-Star Rat', roles: 2, kinds: ['market', 'kiosk'], action: 'handoff', props: [] },
  { id: 'protest', title: 'Rent-a-Crowd', roles: 4, kinds: ['plaza', 'boulevard'], action: 'shout', props: [['sign', 3]] },
];

// Independent oracle BFS (4-neighbour over !solid). Returns Int32Array, -1 = unreachable.
function bfs(grid, sx, sy, maxSteps) {
  const w = grid.w, h = grid.h, n = w * h;
  const d = new Int32Array(n).fill(-1);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return d;
  const s = sy * w + sx;
  if (grid.solid[s]) return d;
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  d[s] = 0; q[qt++] = s;
  const lim = maxSteps == null ? Infinity : maxSteps;
  while (qh < qt) {
    const c = q[qh++], cd = d[c];
    if (cd >= lim) continue;
    const cx = c % w, cy = (c - cx) / w;
    if (cy > 0) { const k = c - w; if (d[k] < 0 && !grid.solid[k]) { d[k] = cd + 1; q[qt++] = k; } }
    if (cx < w - 1) { const k = c + 1; if (d[k] < 0 && !grid.solid[k]) { d[k] = cd + 1; q[qt++] = k; } }
    if (cy < h - 1) { const k = c + w; if (d[k] < 0 && !grid.solid[k]) { d[k] = cd + 1; q[qt++] = k; } }
    if (cx > 0) { const k = c - 1; if (d[k] < 0 && !grid.solid[k]) { d[k] = cd + 1; q[qt++] = k; } }
  }
  return d;
}

// Build a Grid from rows of '.' (walkable) and '#' (solid).
function gridFrom(rows) {
  const h = rows.length, w = rows[0].length;
  const tile = new Uint8Array(w * h), solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = rows[y][x] === '#' ? 1 : 0;
    solid[y * w + x] = s; tile[y * w + x] = s;
  }
  return { w, h, tile, solid };
}

const HEBREW_RE = /[֐-׿יִ-ﭏ]/;
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
// Emoji / pictographs: astral planes + misc symbols & dingbats blocks + variation selector.
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u;

module.exports = {
  CFG, SPOT_KINDS, ZONES, PRESET_LOOKS, AMBIENT_LOOKS, PROPS, ACTIONS, LINE_CATEGORIES,
  POI_TYPES, POI_COUNTS, SCANDALS, TIMING, MAX_RUN_S, CYAN, bfs, gridFrom, HEBREW_RE, RTL_RE, EMOJI_RE,
};
