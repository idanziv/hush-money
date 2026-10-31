# 04 - Review 2: build v0.2 -> release candidate v0.3
Attendees: Dana Regev (director), Yoni Mizrahi (eng-lead), Noa Ben-Ami (world-artist), Tamar Levi (design-writer), Omer Katz (qa).
Inputs: v0.2 reports (eng-lead, world-artist, design-writer), QA phase A2 + B2. No Dana playtest this round: QA's browser pass and pixel measurements covered the open questions.

## Status at review
- `node tests/run.js`: 104/104 (logic 41, data 12, city 18, sim 29, static 4), 5.2 s. The same suite against a v0.1 copy fails 32/104, so it catches regressions.
- Bot: 100 seeds, all 6x PERFECT; spawn paths 9-40 tiles; update avg 6.8 us, worst 1.9 ms.
- Browser: 7,791 frames avg 16.68 ms (p99 16.8, max 17.0); render 0.13-0.14 ms; 0 errors. Boot: art 82 ms (outline bake), city gfx 65 ms.
- file:// statically safe: no fetch/XHR/modules/workers/external images; localStorage in try/catch.
- All v0.2 action items DONE (three builders). Case-1 variety: 12 spots, all 7 defs over 200 seeds. 4 player starts, each with >= 4 strict spots of >= 3 kinds.

## Transcript
**DANA (director):** v0.2 landed clean: 104 tests green, 60 fps, no overlaps in ten screenshots. This review decides what v0.3 needs to be the release candidate. Omer.
**OMER (qa):** One: the flare is barely visible. I sampled pixels 160x120 around the group at t=10.95 vs 11.05: brightness goes up 1.8 to 4 out of 255. The 3 px ring disappears into the glow. The ping is distinct, the visual isn't.
**NOA (world-artist):** Fair. I drew it under people, at 3 px.
**DANA (director):** Make it unmistakable: a white flash disc for the first 80 ms, then a 6 px ring to 80 px, drawn above the people. Yoni adds game.drawOver and calls it after the roofs.
**YONI (eng-lead):** And the polaroid is captured before the flare, so perfect shots aren't washed out.
**OMER (qa):** Two: the skill gap. Lean-in start gives 826, plus 0.4 gives 889, but a typical reaction at plus 0.25 still lands inside the 0.35 window. Reacting is PERFECT.
**DANA (director):** Then the window goes to 0.25. A ~0.3 s reaction scores about 916, anticipating from the cue line and the lean-in scores 1500. Still generous, but now there's a reason to read the scene.
**OMER (qa):** Three: hint1 says "Shoot on the flash". That teaches reaction play.
**TAMAR (design-writer):** I'll rewrite it to teach the lean-in. Something like "When they lean in, get ready: snap!" Under 60 characters.
**OMER (qa):** Four: the scandal bubble is placed before the pager and hint boxes and isn't checked against them, so the HUD can cover it near the top. The edge arrow can sit against the CASE plate.
**YONI (eng-lead):** Both are layout rect checks. The arrow clamp gets the score and CASE plates as no-go zones.
**OMER (qa):** Five: the near ring at alpha 0.25 is barely visible, and polaroids crop bubble fragments.
**YONI (eng-lead):** Ring to 0.4. Capture moves before the overlay, so photos show the scene, not half a speech bubble.
**DANA (director):** Agreed. The headline under the photo tells the story anyway.
**YONI (eng-lead):** Contract request: if the scandal is busted during the lean-in, I skip the peak event and the flare.
**DANA (director):** Approved. In the spec.
**TAMAR (design-writer):** reactToPhoto: the spec said up to 4, the cap is 3, so I use min(4, cap). And I count the ambient cap globally, which is stricter than in-camera.
**DANA (director):** Both approved. Stricter is fine.
**TAMAR (design-writer):** Known: logic's moveAxis allocates about 9 bytes per step.
**YONI (eng-lead):** I'll use a scratch buffer. Five-minute fix.
**NOA (world-artist):** The player marker is subtle on sand at 0.45. I'd take it to 0.55.
**DANA (director):** Do it. Pacing: Omer measured about 6 s waiting in range per case. That's the tension window, with lines playing out and the pulse speeding up. I'm keeping RISE at 11 for ship.
**OMER (qa):** Untested so far: a real file:// double-click and browsers other than the pane.
**DANA (director):** The static check says it's safe, and the README tells the client how to run it on both machines, with a no-install Node fallback I've verified. The client double-click is the final acceptance step.
**DANA (director):** v0.3 is the release candidate. Small, scoped changes only. If Omer's final pass is green, we ship without a third meeting, and I append the sign-off below.

## Decisions (spec v0.3 RC)
- PERFECT_WINDOW 0.25. Peak flare: 80 ms white disc + 6 px ring, above people; no flare when busted during the lean-in.
- Polaroid captured before the overlay and the flare. Near ring alpha 0.4. Scandal bubble and edge arrow avoid all HUD plates.
- hint1 teaches anticipation. Player marker alpha 0.55. RISE stays 11.
- Final docs set: 01 spec, 02 kickoff, 03 review 1, 04 review 2 + ship sign-off, root README.md (5 files).

## Action items
| Owner | Item | Due |
|---|---|---|
| eng-lead | game.drawOver (flare above people), capture before flare/overlay, near ring 0.4, scandal bubble + arrow avoid HUD plates, skip flare if busted in lean-in, moveAxis scratch buffer | v0.3 RC |
| world-artist | drawPeakFlare: 80 ms flash disc + 6 px ring r 20->80; player marker alpha 0.55 | v0.3 RC |
| design-writer | CFG PERFECT_WINDOW 0.25 + PEAK_FLASH_TIME 0.08; hint1 rewrite (anticipation, <= 60 chars) | v0.3 RC |
| qa | Tests to v0.3; final sign-off pass (suite, browser, flare pixel delta, scoring at reaction times) | ship |
| dana | README.md (done, verified fallback server one-liner); append ship sign-off here | ship |

## Ship sign-off (v0.3 RC -> v1.0)
Inputs: three v0.3 builder reports, QA phase B3. Short stand-up; no full meeting.
**OMER (qa):** 106 pass, 1 fail, and the failure is my new regression test. Bot: 100 seeds, all 6x PERFECT. Browser: 0 errors, 10,585 frames at avg 16.7 ms, p99 16.8 ms, render 0.08-0.19 ms.
**OMER (qa):** Real-key shots: RISE-1.0 gives 826, +0.0 1500, +0.3 916, +0.4 889. But exactly +0.25 gives 930, not 1500. Scandal time accumulates in 1/60 steps, so dt comes out as 0.25000000000014. That's one frame, late side only.
**YONI (eng-lead):** One line in logic.js: compare `a <= PERFECT_WINDOW + 1e-9`. Omer's scratch copy goes to 107/107 with it.
**OMER (qa):** Flare on the peak frame is +19.8 to +94.2 out of 255. Pass. At +50 ms it's +9 to +49 because the disc is already fading. Not a blocker. Polaroids are clean, the scandal bubble never sits under the pager or hint, the arrow never touches the plates, hint1 teaches anticipation.
**OMER (qa):** I followed the README word for word. The Node one-liner works from PowerShell, port 8080 serves the game, and the tests run. One gap: it doesn't say how to open a terminal in the folder.
**DANA (director):** README fixed: Finder's "New Terminal at Folder" or cd plus drag on Mac, and the Explorer address bar on Windows. The skill gap holds: 1500 for anticipating, about 916 for a reaction. Pacing is 5.6 s in range per case, as intended.
**DANA (director):** Verdict: **SHIP v1.0**, conditional on the logic.js hotfix landing with `node tests/run.js` at 107/107. The producer verifies that.

| Owner | Item | Due |
|---|---|---|
| eng-lead | Hotfix: PERFECT check tolerance (`a <= PERFECT_WINDOW + 1e-9`) in logic.js | ship (blocker) |
| producer | Confirm 107/107 after the hotfix | ship |
| dana | README terminal instructions (done) | ship |

Post-ship backlog (non-blocking, from QA B3), all DONE in v1.0.1 except the last item, which is deferred:
- [done] art.js: derive the flash-disc cutoff from CFG.PEAK_FLASH_TIME instead of k < 0.16.
- [done] ui.js: keep the edge arrow off a scandal bubble clamped to the bottom edge (seen once).
- [done] npc.js: avoid two on-screen NPCs saying the same line at the same time.
- [deferred] Flare visibility at +50 ms (disc fades fast); consider a slightly longer disc if players miss it.

## v1.0.1 post-ship polish
| Owner | Change | Check |
|---|---|---|
| world-artist | art.js: flash-disc cutoff = CFG.PEAK_FLASH_TIME / PEAK_FLARE_TIME (fallback 0.16); looks identical | flash +39.8..+79.0/255 |
| eng-lead | ui.js: edge arrow and meters label slide past the scandal bubble | headless 42 positions: 23 overlaps -> 0 (browser: code-read only) |
| design-writer | npc.js: no two live bubbles share a line; no speaker repeats their last line | 0 duplicates in 10x3600-step sim and in browser |
| dana | README: terminal steps (Windows run for real, Mac read-checked); busy-port (EADDRINUSE) line | QA |
QA: 109/109 (2 new regression tests fail on v0.3), 0 console errors, avg frame 16.68 ms, 6x PERFECT, clean polaroids.
**Verdict: SHIP v1.0.1.**
