# 03 - Review 1: build v0.1
Attendees: Dana Regev (director), Yoni Mizrahi (eng-lead), Noa Ben-Ami (world-artist), Tamar Levi (design-writer), Omer Katz (qa).
Inputs: four v0.1 reports + QA phase A/B; Dana's playtest (local server, seed 7, debug overlay, scripted pilot for timing checks).

## Status at review
- `node tests/run.js`: 84/84 (logic 37, data 11, city 15, sim 21), 5.5 s. Bot 100 seeds: 6x PERFECT each (9000). Spawn paths 10-35 tiles.
- Browser (QA): full run, 0 console errors, 12,505 frames avg 16.68 ms; update 0.02-0.04 ms, render 0.13-0.17 ms. Boot: art 15 ms, city 2 ms, chunks 40 ms.
- Static review clean: contracts, script order, no DOM at load, 0 Math.random, shadowBlur only at init, no ownership violations.

## Transcript
**DANA (director):** First build, everything integrated on the first try, 60 fps, zero errors. Good work. Now the feel. Omer, you start.
**OMER (qa):** Top issue: the perfect moment has no cue of its own. The peak action, peak line and white core all start around t=13. If you shoot on the kiss you get 862, FRONT PAGE. Players will call that unfair.
**TAMAR (design-writer):** I flagged it too. I put the peak line at 13.0 because that's when the action starts.
**DANA (director):** Agreed, it's a design bug, not a data bug. New rule: the second before the peak is a lean-in, with actors moving together and no fx. At exactly t=RISE the fx pops, the prop swaps, a white flare ring expands and a sound plays. The cue line moves earlier, to set up the moment.
**YONI (eng-lead):** If they react to the flash, they'll land 0.25 to 0.4 s late.
**DANA (director):** Good. Anticipating the lean-in earns 1500; reacting gets you about 890. That's the skill gap I want. Also, the white core only shows above 0.93 intensity, so it hugs the window.
**OMER (qa):** Second: scandal bubbles overlap. Actors stand about 30 px apart, TTL is 2.4 s and lines are 1.8 s apart. The influencer one is unreadable.
**DANA (director):** I saw it on the protest: Gadi's bubble and a protester's stacked on top of each other. Rule: one scandal bubble at a time; a new line clears the others. Yoni, ambient bubbles get a simple layout pass: nudge up once or skip.
**YONI (eng-lead):** Fine. I'll also keep bubbles out of the HUD strip.
**DANA (director):** Yes. An ambient line covered the score in my run.
**OMER (qa):** Third: over 200 seeds, case 1 always spawns at the boulevard bandstand. It's the only strict spot from the start, so it's always the affair or the protest.
**NOA (world-artist):** From tile 25,32 only bv_mid falls inside 18-34 and off-screen. I can add spots, but I'd rather give several player starts.
**DANA (director):** Do both. At least 3 starts, each with 3 or more strict spots of 3 or more kinds. Game picks the start with the run rng. Omer tests variety.
**OMER (qa):** Fourth: matkot. Noa's POI axis is north-south, Tamar places the players east-west at plus or minus 36.
**TAMAR (design-writer):** My bug, I ignored dir. I'll offset along the POI axis.
**OMER (qa):** Fifth: the player is hard to see, a dark fedora blob. And the 170 px in-range ring, in the same neon green, dominates the screen.
**DANA (director):** Confirmed. In my alley screenshots I had to hunt for him. Noa: every sprite gets a 1 px dark outline, the detective gets a light tan coat and a red hat band, plus a soft ground marker under the player.
**NOA (world-artist):** Outline is baked at init, so it costs nothing per frame. I'll add drawPlayerMarker.
**DANA (director):** Color ruling, since Omer asked: #39FF14 only for things that belong to or point at the scandal. That means glow, ring, arrow, scandal bubble borders, and new viewfinder brackets that frame the group when you're in range. The player's ring becomes thin white; the camera icon goes cyan.
**YONI (eng-lead):** So "close enough" shows on the target, not on me. I like it; the eye is already there.
**OMER (qa):** Pacing: the bot is in range by t=5-7 and then waits 7-9 s every case. Easy once you've learned it.
**DANA (director):** RISE goes 14 to 11 and FALL 8 to 7. Worst-case spawn is still 4.4 s of slack, and a relaxed spawn has 3. GAP 3, first delay 2. A run is now 127 s max.
**TAMAR (design-writer):** Then I retime every def: five setup lines, one cue line between 8.8 and 9.8, silence until 11.6, two or more after.
**DANA (director):** Yes. And the tips: "Plaza/blvd." told me nothing. Approved: `{area}` gets replaced with spot.name.
**NOA (world-artist):** Names are already short: "Ficus Grove", "Spice Lane". I'll cap them at 20 characters.
**DANA (director):** Also, case 1 shows a one-line hint under the pager: follow the arrow, get in range, shoot on the flash. A first-time client needs it.
**YONI (eng-lead):** Contract requests from my side: the spawn planner, retry every 0.5 s when there's no candidate, the 0.3 s bust glow fade, two edgeArrow insets, actors() including leaving actors.
**DANA (director):** All approved and written into the spec. The planner never breaks distance or kind rules, and 1800/1800 PERFECT plus zero repeats over 300 idle seeds convinced me. kinds=null stays a logic utility only.
**OMER (qa):** moveAndCollide lets a body that starts inside solid walk freely. That's a wall-walk risk after a bad spawn.
**YONI (eng-lead):** I'll push it out to the nearest free tile, and add an optional `out` parameter so Tamar's NPCs stop allocating.
**TAMAR (design-writer):** I'll use it. The dog teleport too: catch-up run at 2.5x, and only teleport when both are off-screen.
**OMER (qa):** Small perf items: art.js runs a regex per vehicle per frame, and ui builds key strings per frame.
**NOA (world-artist):** I'll cache the regex result per vehicle.
**YONI (eng-lead):** I'll cache the bubble keys on the bubble object.
**TAMAR (design-writer):** Chattiness: I'd drop the ambient cap to 3 and use a 10 s bump cooldown.
**DANA (director):** Approved, both are in CFG now. One more from my playtest: at the peak, the glow reads as one green blob over two tiny people, and the polaroid shows the blob, not the scandal.
**NOA (world-artist):** Cap the halo at 1.6x the sprite and turn the core into a rim. The people stay readable on top.
**YONI (eng-lead):** I'll crop the polaroid tighter, 120x90 world px scaled to 160x120.
**DANA (director):** Results screen is great as is. The headlines are funny and the polaroids sell the fantasy.
**DANA (director):** Rulings on the rest: lanes loop:true, poi = standing point with matkot dir as the axis, Vehicle.bubble added, npc.update ticks only its own people, PE.TEXT.start added. gradeFor and rankFor return strings, penalties are negative points. QA's added rules are approved. Spec is now v0.2; read the changelog.
**OMER (qa):** I'll update tests to the new numbers in parallel and run phase B after the builds land.
**DANA (director):** Same rules as before: your files only, report under 30 lines. Go.

## Decisions (spec v0.2)
- Timing: RISE 11, FALL 7, GAP 3, FIRST_DELAY 2. Peak cue at exactly t=RISE (fx pop, flare, sfx); lean-in from t=10; cue line in [8.8, 9.8].
- One scandal bubble at a time; ambient bubble layout pass; cap 3; bump cooldown 10 s.
- #39FF14 is scandal-only; in-range now shown by green brackets on the group, a thin white player ring and a cyan camera icon.
- Multiple player starts; spawn planner approved; retry 0.5 s when there's no candidate.

## Action items
| Owner | Item | Due |
|---|---|---|
| eng-lead | Peak cue: lean-in [10,11), fx/peakProp/flare/`peak` event + sfx at t=RISE | v0.2 |
| eng-lead | One scandal bubble at a time; ambient bubble layout; bubbles out of HUD zones; HUD plates | v0.2 |
| eng-lead | Proximity visuals per sec. 5 (white ring, green brackets, cyan icon); chevron clear of bubble | v0.2 |
| eng-lead | `{area}` tips, case-1 hint1, playerStarts pick, player marker draw, tighter polaroid | v0.2 |
| eng-lead | logic: moveAndCollide push-out + `out`; edgeArrow clampInset; cache bubble keys | v0.2 |
| world-artist | Sprite outlines, detective contrast, drawPlayerMarker, drawPeakFlare, glow rim/core 0.93 + halo <= 1.6x | v0.2 |
| world-artist | playerStarts >= 3 (each >= 3 strict spots, >= 3 kinds), names <= 20 chars, export buildings, lanes loop:true | v0.2 |
| world-artist | Remove per-frame regex in drawVehicle | v0.2 |
| design-writer | CFG v0.2 values; retime all 7 defs per sec. 8; `{area}` tips; TEXT.start + hint1 | v0.2 |
| design-writer | npc: matkot axis, dog catch-up, BUMP_COOLDOWN, MAX_AMBIENT_BUBBLES from CFG, use `out` | v0.2 |
| qa | Update tests to spec v0.2 (new numbers, timing rules, variety, color rule); phase B re-verify | v0.2 / review 2 |
| dana | Playtest v0.2, write `04-review-v0.2.md` | review 2 |
