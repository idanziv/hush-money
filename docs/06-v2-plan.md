# 06 - v2 plan: light, angle, hiding ("night" prototype)
Owner: Dana. Inputs: the client's answers (A1-E5), a written consultation with Yoni, Noa, Tamar and Omer (relayed by the producer), and the producer's notes. Decisions are Dana's.
v1 (`index.html`, spec `01`) stays live and frozen. The 139 v1 tests must stay green throughout.

## Client answers (short)
Comic tone; reference Monaco. Photo quality, in order: frame > clear LOS > subjects lit > distance > timing > faces. Shot = positional, one button. Timing stays the core and angle multiplies. Lookouts and bodyguards; a suspicion meter, and when it's full the case is aborted (no chases). Detection = line of sight, and at night also lit. Hiding = shadows + cover. Dusk -> night across the run. Fixed lights with soft shadows, plus moving lights; characters cast shadows. Keep the pixel top-down art. Phones may use simpler lighting. Prototype first, at a separate link; 2-min arcade run of 6 cases. Must keep: no install, the Tel Aviv map, the controls.

## Consultation summary
- Yoni: 120 Hz leaves ~3.5-4 ms for light on the Pixel (estimate). Spike first. Facing = last move direction, no new button. Will own stealth.js, but the renderer is past his ceiling. Wants a separate night.html, not a flag.
- Noa: owns light data + art (placements, cover, sprites, grading). Renderer + perf should go to a new hire. Bake per chunk at load, dusk -> night = ambient colour + lamp level (no re-bake). Expects the darkening pass to be the risky 1.5-4 ms.
- Tamar: staging for 5 watcher scandals, suspicion tables, angle weights, dusk -> night ramp, RISE 13. Takes "systems & encounter designer"; light/LOS math is not hers.
- Omer: 4 bot tests (shadow route vs beeline, exact rules, determinism), perf harness, block criteria, cheap fun telemetry. A hire is only needed if the Pixel misses the budget.

## Decisions
1. **Hire one graphics & lighting engineer now** (Ilan Shapira, `gfx-eng`). Both people who could own the renderer (Yoni and Noa) are at capacity, so it needs a specialist owner whichever renderer wins. The hire's FIRST task is the perf spike, so the person paid for that skill settles the tech question. No second hire: the client chose no chases, no crowd witnesses and no composition mode.
2. **Tech: Canvas 2D stays unless the spike says otherwise.** Gate on the client's Pixel 6 Pro / Firefox, light pass p99:
   - <= 3 ms in `full`: Canvas 2D, full quality.
   - 3-5 ms: Canvas 2D, with `lite` as the default on coarse pointers.
   - > 5 ms even in `lite`: the WebGL2 renderer (raw, no libraries, no build step), owned by gfx-eng. Game logic is unaffected.
   No build step and no CDN in any case.
3. **What you see is what detects you.** One light list (city.js) feeds both the gameplay light grid (stealth.js) and the visual lightmaps (light.js). QA checks they agree.
4. **Scoring (resolves Tamar's proposal vs Omer's block criterion).** `points = timing points (v1, 50-1500) x M`, `M = 0.5 + 0.5*A`, `A = 0.35*frame + 0.25*los + 0.20*lit + 0.15*dist + 0.05*faces` (each 0-1). So PERFECT at a perfect angle = 1500, a perfect time from a bad angle = 750, ranks unchanged. Timing stays the core (client B3); angle can at most halve the score.
5. **Detection.** A watcher's cone is 70 deg / 150 px with LOS against buildings and sight-blocking cover. With ambient >= 0.5, anyone in the cone and in LOS is seen. Below 0.5, they're seen only where local light >= 0.35. Suspicion is 0-100 (Tamar's T2 numbers as starting values). States: 35 uneasy, 65 cagey (turn away, step toward shadow, whisper lines), 100 abort (MISSED, 0 points).
6. **Facing / photo cone.** 8-way facing on keyboard and touch alike (parity), with a 70 deg photo cone of length PHOTO_RANGE drawn as a faint wedge. Touch: facing changes only after > 0.5 R deflection held for 2 steps; 0.22-0.35 R turns without walking.
7. **Run.** 6 cases. Ambient by case: 0.90 / 0.75 / 0.55 / 0.35 / 0.20 / 0.12; lamps on from case 3; watchers 1/1/1/2/2/2. Prototype tuning: RISE 13, FALL 8, spawn 14-28 tiles. During the lean-in every watcher glances at the deal for 1.0-1.5 s; that's the sneak window.
8. **Prototype scope.** `night.html` covers the boulevard + alleys district (x 19-46, y 28-56) with 5 scandals: affair, drug_deal, bribe, protest, match_fix. Night code lives in new files or forks. Shared files may only gain additive code (e.g. `city.init({night:true})`), and v1 behaviour must not change.
9. **Render order (night).** Ground -> character shadows -> vehicles -> people -> extras -> drawTop -> `light.draw` (darkening) -> emissive layer drawn after the dark: scandal glow and ring, vision cones, photo wedge, bubbles, overlay, polaroid capture, HUD. Glow and cones must never be dimmed.

## Ownership (new or changed only; v1 table in `01` sec. 13 unchanged)
| File | Owner |
|---|---|
| night.html, js/night-main.js, js/night-game.js (forks), js/stealth.js (new, pure), ui.js (additive night HUD) | eng-lead Yoni |
| js/light.js (new: bake, per-frame light pass, character shadows, headlights, vision-cone drawing, quality tiers), spike/ (spike only) | gfx-eng Ilan |
| js/city.js (`lights`, `cover`, night spots, `init({night:true})`), js/art.js (cover props, shadow/light sprites, night palette) | world-artist Noa |
| js/night-data.js (new: PE.NIGHT tuning, watcher roles, staging, suspicion and M tables, night lines) | design-writer Tamar |
| tests/night*.test.js, tests/ telemetry analysis | qa Omer |

## Key data shapes (details are pinned in M1 reports)
`city.lights = [{x, y, r, color, intensity, kind:'lamp'|'window'|'neon'|'kiosk', fromCase}]` (px). `city.cover = [{x, y, w, h, kind, blocksSight}]` (tiles; solid in night mode only).
`env = {ambient 0..1, ambientColor, lampLevel 0..1}` (from night-game per case). `stealth`: light grid from lights + occlusion, `lightAt`, `los`, cone test, suspicion step, `angleScore -> {M, frame, los, lit, dist, faces}`.
`light.init(city, quality)`, `light.drawShadows(ctx, cam, people, env)`, `light.draw(ctx, cam, timeSec, env, dynLights, quality)`, `light.drawCones(ctx, cam, cones)`; quality `'full'|'lite'` (`?lite=1` overrides).

## Milestones
- M0 (now): gfx-eng runs the perf spike (hosted page), then the client runs the 5-step Pixel script, then Dana makes the renderer call. In parallel and renderer-independent: stealth.js, the night map, night-data.js and night tests all start now.
- M1: night.html prototype playable on desktop + touch; QA's block criteria pass.
- M2: client playtests night.html, telemetry is reviewed, then go / no-go, followed by the merge plan.

## Action items
| Owner | Item | Due |
|---|---|---|
| producer | Hire gfx-eng; relay remits; host the spike page; send the client the Pixel script when the spike is live | M0 |
| gfx-eng | Light-pass perf spike + hosted page with ?debug/?lite; then light.js | M0 / M1 |
| eng-lead | stealth.js (pure) + night forks + night HUD + telemetry log | M1 |
| world-artist | District lights (~30), cover (~40), 8 night spots, props, palette; check script extended | M1 |
| design-writer | night-data.js: staging for 5 scandals, suspicion/M tables, ramp, ~40 lines | M1 |
| qa | O1 bot tests, perf harness, block criteria (O3, scoring per decision 4), telemetry (O4) | M1 |
| client | Run the Pixel spike script (5 steps) | M0 |
| dana | Renderer call after the spike; M1 review | M0 / M1 |
