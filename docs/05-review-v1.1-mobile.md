# 05 - Review v1.1: mobile (touch) release
Attendees: Dana Regev (director), Yoni Mizrahi (eng-lead), Tamar Levi (design-writer), Omer Katz (qa), producer. (Noa Ben-Ami: no art changes.)
Inputs: builder reports (eng-lead, design-writer), QA phases A + B. Hosted (temporarily) at https://idanziv.github.io/hush-money/ from the repo's main branch.

## What happened
The client asked for mobile play. The producer wrote touch support alone and pushed it live without the studio. The client called it out. The team then reviewed the live build: Yoni took ownership of the code, Tamar of the wording, Omer of the tests and the browser check.

## Transcript
**DANA (director):** First the process. A game change went live that nobody on the team built, reviewed or tested. That's on us as a studio, not only on the producer.
**PRODUCER:** Agreed. It looked small, and I shipped it straight to the hosted build.
**DANA (director):** New rule, effective now: every game change goes through the team: owner builds, QA verifies, I sign off. The producer writes briefs, relays, and handles git and hosting. No code, no wording.
**OMER (qa):** And the review paid off. My 26 touch tests run 135/135 on the fixed copy, but against the committed live touch.js two of them fail.
**YONI (eng-lead):** Bug 1: stick drift. Touch down near the left or bottom edge and the stick centre was clamped away from the finger, so the player walked without the thumb moving. Now the centre is the finger and only the drawn base is clamped.
**YONI (eng-lead):** Bug 2: in portrait the rotate overlay covered the game, but taps still walked, shot or started a run behind it. Now portrait blocks all input. A title tap in portrait only asks for fullscreen and the landscape lock.
**YONI (eng-lead):** Also: iPad fullscreen through the webkit call; startRun releases the touch state; and the iOS audio unlock resumes a suspended or interrupted context and plays a one-sample silent buffer on each gesture until it runs.
**TAMAR (design-writer):** Touch controls text rewritten: left half to walk, rim to jog, right half or SNAP to shoot, II for pause, restart and sound, plus a silent-switch hint. I dropped "iPhone" from game text (no brands) and the landscape line, since the overlay says it.
**TAMAR (design-writer):** One flag: the longest line, 44 characters, renders about 9.5 CSS px tall on a phone. Readable, but small. Font size is a ui.js call.
**DANA (director):** Yoni's call, and my ruling is: fix it, but it doesn't block v1.1. Menu text on touch goes to at least 12 CSS px in v1.1.1.
**OMER (qa):** Browser pass at 740x360 with touch pointer events: a full run by stick and SNAP, 6x PERFECT, 9,000. Thumb on the stick plus a second finger on pause: it pauses, the stick drops, and lifting either finger doesn't resume.
**OMER (qa):** Pause menu: SOUND toggles and stays paused, RESTART starts a fresh run. Rotating to portrait mid-run pauses, shows the overlay and blocks taps; back in landscape it stays paused until a tap. The results guard ignores taps at 0 and 0.5 s and restarts at 1.1 s.
**OMER (qa):** 0 console errors, 8,718 frames at avg 16.68 ms, p99 16.8. Desktop is unchanged: touch off, the mouse does nothing, keyboard play works.
**OMER (qa):** Not tested on real hardware: iPhone audio and the silent switch, including after a call or an app switch; fullscreen and orientation lock on Android and iPad; real multi-touch and its latency.
**DANA (director):** The client has the phone, so the client is the real-device check. I've updated the README phone section to match the final behaviour.

## Decisions
- Process rule: all game changes go team -> QA -> Dana sign-off. Producer = briefs, relays, git, hosting only.
- Both live bugs (edge stick drift; input behind the portrait overlay) fixed by eng-lead; QA regression tests cover them.
- Touch text size (~9.5 CSS px): fix in v1.1.1 (eng-lead, ui.js), not a v1.1 blocker.
- Spec `01`: touch line in section 2 + changelog. README: phone section and touch controls line rewritten.

## Action items
| Owner | Item | Due |
|---|---|---|
| producer | Push the reviewed build (eng-lead fixes, data.js text, touch.test.js, README, docs) to main | v1.1 |
| client (user) | Real-device check on your own phone: sound (silent switch, after a call/app switch), rotate mid-run, thumb + second finger, Add to Home Screen; send findings to the producer | after v1.1 |
| eng-lead | Touch menu text >= 12 CSS px on phones (ui.js); QA re-checks fit at 740x360 | v1.1.1 |
| producer | Route any real-device findings as briefs to the owners; no solo fixes | v1.1.1 |

## Sign-off
Suite 135/135, 0 console errors, 60 fps, desktop unchanged, both review bugs fixed and covered by tests. **Verdict: SHIP v1.1**, once the reviewed build replaces the live one. The real-device check stays open with the client.

## v1.1.1: touch menu text (action item closed)
- eng-lead (ui.js, touch mode only, chosen at cache time):
  - Title and pause controls 13 -> 18 canvas px (12.0 CSS px at 740x360), title line spacing 22 -> 26.
  - Pause hint 14 -> 18, moved to y 444 above the buttons.
  - Results hint 12 -> 18, results footer moved up 8 px.
  - RESTART/SOUND labels 15 -> 18.
  - Lines shrink to fit but never below 11 px. Desktop unchanged; data.js wording fits as is.
- QA: fits at 740x360 and 667x375, RESTART/SOUND work, no overlap on a NEW BEST results screen, desktop matches v1.1, 135/135, 0 console errors.
- Decision: the HUD pager tip (11 px, ~7.3 CSS px on a phone) is the scandal's who-and-where, so it becomes an action item for v1.1.2, not a deferral.
  - eng-lead: enlarge it in touch mode; design-writer: check the longest tip (53 chars) still fits; QA: re-check at 667x375.
- Deferred: on a touchscreen laptop with a fine pointer, touch mode starts at the first touch, so menus already drawn keep desktop sizes until a reload. It's rare, cosmetic and fixed by a reload.
- **Sign-off: SHIP v1.1.1.** Dana.

## v1.1.2: pager readability on touch (action item closed)
- eng-lead (ui.js, touch mode only, cache-time):
  - Pager tip 11 -> 18 canvas px (12 CSS px), 560 px wrap budget, up to 3 lines, box x 182-778; header 9 -> 12.
  - Case-1 hint 11 -> 18. IN RANGE/NEAR labels 11 -> 16, kept on screen.
  - Bubble no-go uses the real pager/hint width; camera no-go box 74 -> 100; a top-edge arrow slides past the pager.
- design-writer: measured all 42 tips with measureText; affair tip is now 'Banker Avner + "trainer" at {area}.'; widest is 527/560 px, so every tip fits on one line.
- QA: SHIP at 740x360 and 667x375; clear of plates and II; a forced 2-line tip clears; bubbles stay below the hint; 6x PERFECT, polaroids without HUD; desktop unchanged; 135/135, 0 console errors.
- Decision: the desktop arrow hiding under the pager for 5 s becomes an action item. Those 5 s are right after a spawn, exactly when the player needs the direction.
  - eng-lead: apply the slide-past-pager rule on desktop too. Same change: add the SNAP button to the touch bubble no-go zones (cosmetic on its own, but it's the same mechanism, so it costs nothing extra).
  - Due v1.1.3; QA re-checks both modes.
- **Sign-off: SHIP v1.1.2.** Dana.

## v1.1.3: arrow vs pager, bubbles vs SNAP (action item closed)
- eng-lead (ui.js):
  - Desktop: a top-edge arrow under the pager or case-1 hint slides to the box edge +-18 px for the pager's 5 s (box x 256-704). Scripted check: 0 of 62 positions hidden.
  - Touch: SNAP is a no-go zone for ambient and vehicle bubbles (nudge up once, else skip). Check: 0 of 63 covering it.
- QA: SHIP. Seeds 10/17 (desktop) and 14 (touch): the arrow stays clear of the boxes. 9,565 touch-run bubble draws, none on SNAP; every SNAP tap fired. Polaroids have no HUD. 135/135, 0 console errors.
- Decision: deferred. The meters label can tuck 2-4 px under the pager or hint's translucent border, but it stays readable, so it isn't worth another build. If ui.js is touched again, slide by the label width too (eng-lead).
- The mobile polish loop is closed. Next work starts from the client's real-device findings, briefed through the team.
- **Sign-off: SHIP v1.1.3.** Dana.

## v1.1.4: smooth rendering at any refresh rate (client's real-device finding)
- Client phone check: sound OK, rotate overlay OK, stutter on a Pixel 6 Pro in Firefox. Not yet tried: thumb + second finger, Add to Home Screen.
- eng-lead (main.js): the cause was a fixed 1/60 sim drawn without interpolation, which repeats frames at 120/90 Hz and on jittery 60 Hz. Render now interpolates player, NPCs, actors, vehicles and camera by acc/DT (camera rounded to whole pixels; jumps > 64 px drawn as-is; only while playing or paused); rAF jitter within +-30% snaps to the smoothed period. The sim still steps at exactly DT, so scoring is unchanged.
- QA: repeated or still frames, before -> after: 120 Hz 136/273 -> 0; 90 Hz 67/203 -> 0; jittery 60 Hz 9/133 -> 0; a 60->120->90 Hz switch 90/263 -> 0; steady 60 Hz 0 -> 0. No streaking at spawn/flee/RESTART/pause/tab hide; 6x PERFECT at all rates; 138/138 (new render.test.js fails on v1.1.3); p99 16.9 ms, 0 console errors.
- Open with the client: confirm on the Pixel; try thumb + second finger and Add to Home Screen. The meters-label tuck stays deferred.
- **Sign-off: SHIP v1.1.4.** Dana.

## v1.1.5: smooth lean-in (client: actors stutter as they close in near the peak)
- eng-lead (game.js only): the lean-in was an exponential ease-out that crept 1 px at a time with growing gaps (up to 10 frames at 60 Hz, 20 at 120 Hz) while legs churned in place. It's now a fixed-duration ease (half linear, half smoothstep) over 0.6x ACTION_LEAD, and the walk cycle runs only while travelling. RISE, pop, flare, scoring and DT are unchanged.
- QA: 139/139 (new per-step test fails on v1.1.4). All 7 types at 60/90/120 Hz and jittery 60 Hz move evenly; longest gap 11 -> 4-6 frames (60 Hz), 21 -> 8-11 (120 Hz). Actors stop at t 10.55-10.62 with 0 px snap at the pop; busted-in-lean-in unchanged; 6x PERFECT; p99 16.8 ms, 0 console errors.
- Design call: approved. Arrive about 0.4 s early, hold still, then pop. A beat of stillness reads as "get ready" and helps anticipation; it stays inside the spec 4 window. Spec 4 updated.
- Abrupt arrival (the ease ends at half speed): fix next. The client is watching exactly this motion. Action item v1.1.6 (eng-lead): end the ease at zero velocity, keep the same ~10.6 arrival; QA re-runs the per-step test. Not a blocker for v1.1.5.
- Open with the client: Pixel re-check, thumb + second finger, Add to Home Screen.
- **Sign-off: SHIP v1.1.5.** Dana.
