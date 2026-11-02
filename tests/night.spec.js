// HUSH MONEY v2 "night" - spec constants transcribed from docs/06-v2-plan.md (decisions 4-9). Owner: QA.
// The test oracle for night tests: never read these values back from the game.
'use strict';

const NIGHT = Object.freeze({
  // dec. 5 detection
  CONE_DEG: 70, CONE_LEN: 175, AMBIENT_DAYLIKE: 0.5, LOCAL_LIT: 0.35,   // M1 ruling 1: cone 175 px (photo range stays 170)
  SUSP_MAX: 100, SUSP_UNEASY: 35, SUSP_CAGEY: 65,
  // dec. 4 angle multiplier
  W: Object.freeze({ frame: 0.35, los: 0.25, lit: 0.20, dist: 0.15, faces: 0.05 }),
  M_MIN: 0.5, M_MAX: 1.0,
  // dec. 6 photo cone
  PHOTO_CONE_DEG: 70,
  // dec. 7 run ramp
  AMBIENT_BY_CASE: Object.freeze([0.90, 0.75, 0.55, 0.35, 0.20, 0.12]),
  LAMPS_FROM_CASE: 3,
  WATCHERS_BY_CASE: Object.freeze([1, 1, 1, 2, 2, 2]),
  RISE: 13, FALL: 8, SPAWN_MIN_TILES: 14, SPAWN_MAX_TILES: 28,
  GLANCE_MIN: 1.0, GLANCE_MAX: 1.5,
  // dec. 8 district + scandals
  DISTRICT: Object.freeze({ x0: 19, y0: 28, x1: 46, y1: 56 }),
  SCANDALS: Object.freeze(['affair', 'drug_deal', 'bribe', 'protest', 'match_fix']),
  // ownership table / M1 action items
  LIGHT_KINDS: Object.freeze(['lamp', 'window', 'neon', 'kiosk']),
  MIN_LIGHTS: 20, MIN_COVER: 25, MIN_NIGHT_SPOTS: 8,
});

// test light levels (dusk / mid / night) = case 1, 3, 6 ambients
const LEVELS = Object.freeze([
  { name: 'dusk', ambient: 0.90, lampLevel: 0 },
  { name: 'mid', ambient: 0.55, lampLevel: 1 },
  { name: 'night', ambient: 0.12, lampLevel: 1 },
]);

// v2 points: timing points x M, M = 0.5 + 0.5*A (dec. 4)
function mOf(c) {
  const W = NIGHT.W;
  return 0.5 + 0.5 * (W.frame * c.frame + W.los * c.los + W.lit * c.lit + W.dist * c.dist + W.faces * c.faces);
}

module.exports = { NIGHT, LEVELS, mOf };
