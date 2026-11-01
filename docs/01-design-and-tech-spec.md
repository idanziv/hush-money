# HUSH MONEY - Design & Tech Spec (v0.3 RC)
Owner: Dana Regev (creative director). Only Dana edits this file. Contract change requests go in your milestone report; never edit a file you don't own.
Changelog: v0.1 kickoff. v0.2 (review 1, see `03`): RISE 14->11, FALL 8->7, GAP 4->3, FIRST_DELAY 3->2, ambient bubble cap 4->3; distinct peak cue at t=RISE (fx pop + flare + sfx), lean-in before it; one scandal bubble at a time; #39FF14 ruling; proximity visuals reworked; player marker + outlines; multiple player starts; spawn planner approved; contract rulings in 14.
v0.3 RC (review 2, see `04`): PERFECT_WINDOW 0.35->0.25; bold peak flare (6 px ring + 80 ms white flash disc); hint1 teaches anticipation; polaroid captured before overlay (no bubbles); near ring alpha 0.4; scandal bubble + arrow avoid HUD plates; no peak event if busted during lean-in; reactToPhoto max 3.
v1.1 (mobile, see `05`): touch controls + portrait block + iOS audio unlock; hosted on GitHub Pages. Rule: every game change goes through the team; the producer only writes briefs, relays, git and hosting.
v1.1.4 (see `05`): render interpolation (acc/DT) for 90/120 Hz and jittery displays; the sim stays fixed at DT.

## 0. Docs policy
- All docs live in `docs/`, numbered: `01-design-and-tech-spec.md`, `02-meeting-kickoff.md`, `03-review-v0.1.md`, `04-review-v0.2.md`, `05-review-v1.1-mobile.md`. Root `README.md` = player-facing run instructions (written at ship).
- One file per meeting/feedback loop, containing BOTH the transcript (`**NAME (role):** line`) and an `Action items` table (owner | item | due). Every .md < ~200 lines. Target <= 8 doc files total. Hires report to Dana; Dana writes the docs.

## 1. Pitch & core loop
Top-down 2D (GTA2-style) city, a small Tel Aviv. You are a sleazy private eye. A pager tip announces a scandal; a green arrow points to it; the involved people glow bright green, weak -> peak -> gone. Walk there (WASD), get in range, snap the photo (Space) as close to the peak as possible. Points = hush money. 6 scandals per run, ~2 min, then a results "blackmail portfolio".

## 2. Controls
| Key | Action |
|---|---|
| W A S D (also arrow keys) | Walk (8 directions, diagonals normalized) |
| Shift (hold) | Jog x1.5 |
| Space (also K) | Take photo (edge-triggered, 0.6 s cooldown) |
| P or Esc | Pause / resume (auto-pause when tab hidden) |
| R | Restart run (from pause or results) |
| Enter / Space | Start from title; continue from results |
| M | Mute / unmute |
| ` (backquote) or `?debug=1` | Debug overlay: FPS, update/render ms, spot markers |
URL `?seed=123` forces the run seed (QA). Arrow keys and Space must `preventDefault` (no page scroll).
Touch (v1.1, `js/touch.js`; on when `pointer: coarse` or after the first touch): floating stick on the left half (dead zone 0.22 R, rim = jog), right half below the 52 px HUD band = photo (SNAP), II button = pause with RESTART / SOUND, tap elsewhere resumes. Portrait shows a rotate overlay, pauses and blocks all input; the first title tap requests fullscreen + landscape lock where supported. `PE.TEXT_TOUCH` (data.js) replaces controls/start/pause/resultsHint on touch. Mouse is ignored; keyboard play is unchanged.

## 3. Session structure & screens
States (main.js): `title -> playing <-> paused -> results -> playing`.
- Run: `SCANDALS_PER_RUN = 6`. First spawn after `FIRST_DELAY = 2 s`; GAP starts at the resolve event (photo or expiry), `GAP = 3 s`; after the 6th resolves wait `END_DELAY = 2 s` -> results. Max run = 2 + 6*18 + 5*3 + 2 = 127 s.
- Title: "HUSH MONEY", subtitle, controls list, `PE.TEXT.start`.
- HUD: top-left score `₪ 2,340`; top-right `CASE 3/6`; top-center pager box (tip with `{area}` = spot.name, 5 s on spawn); case 1 only: `PE.TEXT.hint1` (teaches anticipation, e.g. "Get IN RANGE. When they lean in, get ready: snap!") under the pager until case 1 resolves; bottom-center photo feedback popup (1.8 s); bottom-right camera icon (grey = nothing, amber = near, cyan `#4FD8FF` + "IN RANGE", dimmed during cooldown); white flash 120 ms on shutter. HUD text sits on a dark translucent plate; world bubbles (scandal ones included) never enter the top 30 px strip, the pager/hint boxes or the camera-icon box; the edge arrow is clamped clear of the score and CASE plates.
- Results: one row per case: polaroid (captured at photo time) + headline (`def.caption`) or `MISSED: <title>`, points + grade; total, rank, best score (localStorage in try/catch). "R / Enter: blackmail again".

## 4. Scandal lifecycle & glow curve
Scandal time `t` starts at 0 on spawn. Live window `0 <= t <= RISE + FALL` with `RISE = 11 s`, `FALL = 7 s` (18 s). Peak ("perfect moment") at `t = RISE`.
```
intensityAt(t): t<0 or t>RISE+FALL -> 0
  t<=RISE: u=t/RISE; I = MIN_GLOW + (1-MIN_GLOW)*u*u        (MIN_GLOW = 0.10)
  else:    v=(t-RISE)/FALL; I = (1-v)^2                       (0 at t=18)
samples: t=0 .10 | 5.5 .325 | 8.25 .60625 | 10 .8438 | 11 1.0 | 12.75 .5625 | 14.5 .25 | 16.25 .0625 | 18 0
```
- Glow (per involved person, pre-rendered halo, drawn under the sprite, halo <= 1.6x sprite size so the person stays readable): alpha = I, halo scale 0.8 + 0.4*I, heartbeat pulse +-15% at `0.8 + 3.2*I` Hz, white rim/core alpha `max(0,(I-0.93)/0.07)` (visible only ~0.4 s around the peak). Ground ring around the group (line 2+3*I px, alpha 0.25+0.6*I).
- Peak cue (fixes "shot the kiss, got 862"): lean-in `t in [RISE-ACTION_LEAD, RISE)` = [10, 11): actors lerp to `pdx,pdy`, no fx. At `t = RISE` exactly: action fx pops (`def.peak.action`), `peakProp` swaps in, peak flare over the group for `PEAK_FLARE_TIME = 0.5 s` (white flash disc r~40 for the first 80 ms, alpha 0.7->0, plus a 6 px white ring r 20->80, alpha 1->0; drawn ABOVE people so it cannot be missed), game emits a `peak` event (sfx `peak` if prox >= 1 or focus on screen). Fx held until `RISE + ACTION_TAIL` (12.5). Skill = anticipating the pop from the lean-in + cue line + accelerating pulse; pure reaction (~0.3 s) scores ~900. If the scandal is busted during the lean-in there is no peak event and no flare.
- Lines: `def.lines` fire as `t` crosses each `at`. Only ONE scandal bubble visible at a time: a new scandal line clears all other actors' scandal bubbles. TTL 2.4 s.
- Resolution: scored photo -> `busted`: glow fades over `BUST_FADE = 0.3 s` (polaroid shows it), bust line 1 immediately, line 2 at +0.9 s, actors flee at 1.3x NPC speed for `BUSTED_FLEE_TIME = 4 s`, then removed. Expiry (t > 18) -> `expired`: expire line, actors walk away, removed after 5 s or off-screen. Player says `player_good` on a photo >= 400, `player_miss` on expiry.
- Only one scandal is live at any time (leaving actors of the previous one may still be walking off).

## 5. Proximity & direction indicators
- Focus = spot center (fixed). `d` = Euclidean px player -> focus. `inRange = d <= PHOTO_RANGE (170)`; `near = d <= 272` (NEAR_MULT 1.6). No line-of-sight check.
- Visual (only while live): near & not in range -> dashed white ring r=170 around the player, alpha 0.4, camera icon amber. In range -> thin solid white ring (1.5 px, alpha 0.45) + 4 GREEN viewfinder brackets framing the scandal group (actors' bounding box + 14 px) + cyan "IN RANGE" camera icon.
- Direction arrow (advisory, never locks): focus outside view inset 24 px -> green triangle on the screen edge clamped at 28 px inset, alpha 0.4+0.6*I, label `round(d/16)m`. Focus on screen -> green chevron bobbing above the topmost bubble-free point (>= 28 px above focus, never overlapping the scandal bubble).
- Color rule: `#39FF14` is used ONLY for things that belong to or point at the scandal: glow, ground ring, arrow/chevron, viewfinder brackets, scandal bubble border/name tag. Nothing else in the world or HUD is that green.

## 6. Scoring
`dt = t_photo - RISE` (negative = early). Evaluated in order:
1. No live scandal (none, waiting, busted, expired): `-150` "WASTED FILM".
2. Live but `!inRange`: `-100` "TOO FAR". Scandal continues.
3. Live & in range: `a=|dt|`. If `a <= PERFECT_WINDOW (0.25)`: `1500` "PERFECT SHOT". Else `W = dt<0 ? RISE : FALL`, `q = min(1,a/W)`, `points = max(50, round(1000*(1-q)^2))`. Scandal -> busted.
Checks: 0.25 PERFECT, 0.26 early 953 | 0.3 late 916 | 0.4 late 889 | 1 s early 826 | 3 s early 529 | 1 s late 735 | 2 s late 510 | t=0 or t=18 -> 50. scorePhoto returns negative points for penalties (CFG stores magnitudes).
Grades: >=1500 PERFECT SHOT, >=750 FRONT PAGE, >=400 JUICY, >=150 TABLOID FILLER, else BLURRY GOSSIP. Ranks (max 9000): >=7500 Kingpin of Kompromat, >=5000 Professional Sleazeball, >=2500 Paparazzo with Debts, >=0 Tourist with a Camera, else Owes the Tabloids Money. Expired = 0 "MISSED".
On penalty photos ambient NPCs within 120 px (max min(4, MAX_AMBIENT_BUBBLES) = 3) react; player says a `player_bad` line.

## 7. Spawn rules
Player 140 px/s = 4.375 tiles/s. Valid spot: kind in `def.kinds` (never any other kind), BFS path (4-neighbour) from the player tile in `[18, 34]` tiles, center outside the camera rect + 64 px. Worst case 34 tiles = 7.8 s walk (6.6 s to range) vs 11 s to peak -> >= 4.4 s slack.
`pickSpawnSpot` relaxation: (a) strict; (b) drop off-screen rule; (c) distance `[8, 40]`; else null. Path <= 40 tiles = 9.1 s (7.9 s to range) < RISE.
Deck + planner (approved v0.2): shuffle all defs per run (seeded). Take picks in section-7 order (first def with a strict candidate, else relaxed), but skip a (def, spot) pick if the remaining deck could no longer fill the remaining cases (memoised lookahead, player assumed at the chosen spot, 3-tile margin under 40). If the chosen spot is a dead end, search all legal def/spot pairs at the same relax level; else plain pick. Nothing at all -> stay `waiting`, retry every 0.5 s. No def repeats within a run; never the previous spot.
Player start: `city.playerStarts` (>= 3), chosen by the run rng; each start has >= 3 strict spots of >= 3 different kinds so case 1 varies.

## 8. Scandal types (data.js; 7 defs, 2-4 roles each; all names fictional)
| id | title | roles | spot kinds | peak action |
|---|---|---|---|---|
| affair | The Boulevard Affair | married banker, his "personal trainer" | boulevard, park | kiss |
| drug_deal | Alley Pharmacy | dealer, buyer, lookout | alley, market | deal |
| bribe | Permit Express | city councilman, contractor (envelope) | cafe, plaza | handoff |
| influencer | #SaveTheSea | influencer (phone), assistant (trash bag) | beach | pose |
| match_fix | Penalty for Sale | star striker, bookie | kiosk, park | shake |
| inspector | Five-Star Rat | health inspector, falafel stand owner | market, kiosk | handoff |
| protest | Rent-a-Crowd | party candidate + 3 paid protesters (signs) | plaza, boulevard | shout |
Writing rules: English + transliterated slang; NO Hebrew script; line <= 48 chars; no real people/brands/clubs/parties; no ethnic or religious stereotypes. Timing per def (RISE 11): >= 5 setup lines with `at < 8.8`; exactly one CUE line with `at in [8.8, 9.8]` (sets up the action: "Okay... take the envelope."); no line in (9.8, 11.6); >= 2 lines in [11.6, 17.5]; all `at` in 0.3..17.5, >= 1.8 s apart; 2 bust lines, 1 expire line. `tip` is a template containing `{area}` (replaced by spot.name), <= 40 chars before substitution.

## 9. City layout (96 x 64 tiles of 32 px = 3072 x 2048 px; x east, y south)
- x 0-7 sea (solid), x 8-12 beach (umbrellas, 2 lifeguard towers), x 13-14 promenade, x 15-18 coastal road + red bike lane, x 19 sidewalk.
- Boulevard along y 28-37 from x 20 to x 86 (central tree-lined strip y 31-34, kiosks at both ends). Plaza x 43-58, y 7-19 (fountain). Park x 70-86, y 7-22; little park x 20-35, y 20-27. Cafe street x 36-42. Market y 38-56. Old-town alleys x 20-45, y 42-62. South plaza + corner cafe x 51-59, y 44-51. Bauhaus blocks elsewhere. Final coordinates live in the city.js header.
- Spots: >= 26, kinds `boulevard park alley cafe beach market plaza kiosk`, >= 3 per kind; 3x3 walkable; no building/solid structure tile within Chebyshev distance 3 of the spot center tile; trees >= 4 tiles; `spot.kind` equals `zoneAt` (kiosk spots exempt); spot.name <= 20 chars, reads well after "at the"/"at" in a tip.

## 10. Ambient life & speech (npc.js + data.js)
60 people (incl. 3 dogs): walkers + phone talkers on the path graph, 10 sitters, 6 vendors (call out wares), 3 joggers (promenade loop ~1.8x), 2 matkot pairs, 4 sunbathers, 3 dog walkers + dogs. Exactly 6 scooters + 6 cars on `city.lanes` (closed loops), visual only.
- People collide with solid tiles; player passes through people.
- Ambient bubble: each visible NPC every 8-20 s; max `MAX_AMBIENT_BUBBLES = 3` ambient-style bubbles in cam (vehicle bubbles count); scandal bubbles always win. Bump line when player within 24 px, `BUMP_COOLDOWN = 10 s` per NPC. Scooter "Ding ding!" within 56 px.
- Matkot: players stand +-36 px along the POI's axis (dir 0/4 = N-S, 2/6 = E-W) and face each other.
- Dogs: never teleport on screen; if > 96 px from owner, run to catch up at 2.5x; teleport only if > 300 px AND both are off-screen.
- Bubble layout (ui.js): place the scandal bubble first, then ambient bubbles nearest-first; an ambient bubble that overlaps a placed one is nudged up once, else skipped. Bubbles are clamped inside the view and out of the HUD zones.
- Line categories (PE.LINES): walker, phone, cafe, vendor_falafel, vendor_kiosk, vendor_market, beach, jogger, matkot, dogwalker, scooter, bump, photographed, player_good, player_bad, player_miss, player_idle. >= 8 each, >= 140 total.

## 11. Art direction & rendering
GTA2-like: saturated, chunky, sunset-warm. Sand #E8D3A0, sea #1E5F8F/#2A7FB8, asphalt #3A3A40, red-brown bike lanes, grey pavers, muted grass #5E8C3A, ficus canopies, pinkish plaza stone, Bauhaus roofs #F1EDE4.
- All graphics procedural, pre-rendered once. People 24x24, 8 dirs x 3 frames, every sprite with a 1 px dark outline (baked at init). Player `detective`: light tan trench coat, dark fedora with red band. The player is the most readable sprite on screen.
- Ground: 16x16-tile chunks (512 px), visible chunks only. Buildings drawn after people with pseudo-3D roofs (offset capped 24 px).
- Draw order: ground -> scandal glow/ring (`game.drawUnder`) -> vehicles -> player marker -> people y-sorted (+ action fx) -> npc extras -> buildings/canopies/umbrellas -> polaroid capture -> peak flare -> overlay (bubbles, rings, brackets, chevron) -> HUD.
- Canvas 960x540, CSS-scaled 16:9 letterbox, pixelated, integer coords. Font `bold 11px Verdana, sans-serif`. No emoji.

## 12. Tech architecture & performance
Vanilla JS + Canvas 2D; no frameworks, npm, build step, CDN or image files. Classic `<script>` tags; works from file:// and any static server. Fixed timestep `DT = 1/60`, max 5 steps/frame; render interpolates positions and camera by acc/DT (v1.1.4). Budget (M1 Air): update <= 2 ms, render <= 6 ms. No per-frame `shadowBlur`/filters/regex; caches capped at 200; cull with 64 px margin; no per-frame allocations in hot loops. Seeded RNG only (npc rng = seed ^ 0x9E3779B9).
Headless rule: nothing touches `document`/`window`/canvas at load. `data logic city npc game` load and run init/update in Node.

## 13. File layout & ownership (exactly one owner per file)
| File | Owner |
|---|---|
| index.html, js/logic.js, js/game.js, js/ui.js, js/sfx.js, js/touch.js (mobile controls, v1.1), js/main.js | eng-lead |
| js/art.js, js/city.js | world-artist |
| js/data.js, js/npc.js | design-writer |
| tests/run.js, tests/spec.js, tests/*.test.js | qa |
| docs/*.md, README.md | dana |

## 14. Interface contracts
**14.1** Every js file: `(function (PE) { 'use strict'; ... })(globalThis.PE = globalThis.PE || {});`. Unknown look/prop/action/style/icon keys never throw.
**14.2 Shapes.** dir 0=N,1=NE,...,7=NW. World px, feet center.
`Person = {id, x, y, dir, moving, animT, look, prop, kind:'ambient'|'scandal'|'player', bubble:null|{text, ttl, style:'ambient'|'scandal'|'player', name?}, glow, action, brain}`. `Vehicle = {x, y, dir, type:'scooter'|'car', color, bubble:null|{...}}` (+ owner-private `_` fields).
`PE.cam = {x, y, w:960, h:540}` (main.js writes; game reads it every step; tests may write it). `Grid = {w, h, tile, solid}`. `Spot = {id, name, kind, x, y}`.
Props: none envelope package phone sign cards cash trashbag clipboard paddle coffee. Actions: kiss deal handoff pose shout shake.
**14.3 PE.CFG:** `TILE:32, MAP_W:96, MAP_H:64, VIEW_W:960, VIEW_H:540, DT:1/60, PLAYER_SPEED:140, SPRINT_MULT:1.5, NPC_SPEED:55, PERSON_RADIUS:7, RISE:11, FALL:7, MIN_GLOW:0.10, ACTION_LEAD:1.0, ACTION_TAIL:1.5, PEAK_FLARE_TIME:0.5, PEAK_FLASH_TIME:0.08, BUST_FADE:0.3, PHOTO_RANGE:170, NEAR_MULT:1.6, PHOTO_COOLDOWN:0.6, BASE_POINTS:1000, PERFECT_WINDOW:0.25, PERFECT_BONUS:500, MIN_POINTS:50, PENALTY_NO_SCANDAL:150, PENALTY_TOO_FAR:100, SCANDALS_PER_RUN:6, FIRST_DELAY:2, GAP:3, END_DELAY:2, SPAWN_MIN_TILES:18, SPAWN_MAX_TILES:34, SPAWN_OFFSCREEN_MARGIN:64, RELAX_MIN_TILES:8, RELAX_MAX_TILES:40, BUSTED_FLEE_TIME:4, BUBBLE_TTL:2.4, MAX_AMBIENT_BUBBLES:3, BUMP_COOLDOWN:10, AMBIENT_COUNT:60, GLOW_COLOR:'#39FF14', GRADES, RANKS` ({min,label} desc, last min -Infinity).
**14.4 data.js:** `ScandalDef = {id, title, tip ('{area}' template), caption, kinds, roles:[{name, look, dx, dy, dir, prop, peakProp?, pdx?, pdy?}] (2-4, offsets <= 40 px), peak:{action}, lines:[{at, r, s}], bust:[{r,s}]x2, expire:[{r,s}]}` (timing rules sec. 8). `PE.LINES`. `PE.TEXT = {title, subtitle, controls:[string], start, hint1, pause, resultsHint}`.
**14.5 logic.js (pure):** `intensityAt(t,cfg)` . `isLive(t,cfg)` . `scorePhoto({t,live,inRange},cfg)->{kind, points, label, dt}` . `gradeFor(points,cfg)->label string` . `rankFor(total,cfg)->label string` . `dist` . `proximity(d,cfg)->0|1|2` . `bfsTiles(grid,tx,ty,maxSteps)->Int16Array` (-1 unreachable or beyond maxSteps) . `pickSpawnSpot(grid, spots, px, py, cam, kinds, cfg, rng, excludeId)->{spot,pathTiles,relax}|null` (kinds null = any; utility only, game never passes null) .
`moveAndCollide(grid, x, y, dx, dy, r, tile, out?)->{x,y}` (writes into `out` if given; if the body starts inside solid it is first pushed to the nearest free tile center) . `dirFromVector` . `edgeArrow(cam, tx, ty, inset, clampInset=inset)->{onScreen, x, y, angle}` (angle = atan2(dy,dx), screen radians) . `mulberry32` . `shuffle` . `tickBubble` . `formatShekels`.
**14.6 art.js (DOM):** `init()` . `LOOKS_AMBIENT` = `amb0`..`amb23` . presets as v0.1 . `drawCharacter(ctx,sx,sy,look,dir,animT,moving,prop)` . `drawGlow(ctx,sx,sy,dir,intensity,timeSec)` . `drawGroundRing(ctx,sx,sy,rx,ry,intensity)` . `drawPeakFlare(ctx,sx,sy,k)` (k 0..1 over PEAK_FLARE_TIME; flash disc while k < 0.16, 6 px ring r 20->80; see sec. 4) . `drawPlayerMarker(ctx,sx,sy,timeSec)` (soft pale-yellow ground ellipse ~20x10, alpha ~0.45, gentle pulse) . `drawActionFx` . `drawIcon` . `drawVehicle`. Optional extras: `initMs`.
**14.7 city.js:** `init()` . `grid` . `T` . `buildings:[{x,y,w,h,ht}]` (tiles; contract, QA uses it) . `spots` . `paths:{nodes, adj}` . `lanes:[{pts, type, loop:true}]` (closed loop, first point not repeated) . `poi:[{type,x,y,dir}]` (x,y = walkable standing point beside the object; matkot = pair center, dir = axis) . `playerStarts:[{x,y}]` (>= 3) . `playerStart` (= playerStarts[0]) . `zoneAt` . `isSolidPx` . DOM: `initGraphics`, `drawGround`, `drawTop`. Optional extras: `tileAt`, `trees`, `drawDebug`, `gfxMs`.
**14.8 npc.js:** `init(rng)` . `people` . `vehicles` . `makePerson(x,y,look,kind)` . `update(dt, player, cam)`: moves and ticks ONLY people it created (`brain.npc === true`) and vehicles; game.js ticks actors' and the player's bubbles . `say(person,text,style,ttl,name?)` . `reactToPhoto(x,y)` . DOM: `drawExtras(ctx,cam)`.
**14.9 game.js:** `newRun(seed)` (picks a player start via rng) . `update(dt,input)` (calls npc.update; reads PE.cam each step, default cam centered on the player if absent) . `drawUnder(ctx,cam)` (glow, ring) . `drawOver(ctx,cam)` (peak flare, called by main after city.drawTop) . `actors()` (live + leaving actors) . `state` as v0.1, plus events `{type:'peak'}`.
**14.10 ui/sfx/main:** as v0.1, plus: `sfx.play('peak')`; main draws `art.drawPlayerMarker` before people; ui.capture runs BEFORE the overlay (photo has no bubbles/rings), crops 120x90 world px around the focus, scales to 160x120; ui shows vehicle bubbles.
**14.11 tests:** `node tests/run.js` (no deps, exit 0/1, missing files -> SKIPPED). Test-enforced rules include everything in this spec plus: no def repeats in a run; case-1 variety over 200 seeds (>= 4 distinct spots, >= 3 distinct defs); `#39FF14` appears only in art.js glow/ring code and the ui scandal elements of sec. 5.

## 15. Milestones & definition of done
kickoff -> v0.1 -> review 1 (`03`) -> v0.2 -> review 2 (`04`) -> **v0.3 RC** -> QA sign-off (appended to `04`) -> v1.0 ship + README. Final docs: 01-04 + README.md.
DoD per build: double-click index.html in Chrome/Edge/Safari/Firefox -> title -> full 6-case run -> results -> restart, zero console errors, 60 fps, `node tests/run.js` green, every number in this spec honored.
