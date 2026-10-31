# 02 - Kickoff meeting (project HUSH MONEY)
Attendees: Dana Regev (creative director), Yoni Mizrahi (eng-lead), Noa Ben-Ami (world-artist), Tamar Levi (design-writer), Omer Katz (qa).
Input: client brief; `01-design-and-tech-spec.md` draft. Duration ~45 min.

## Transcript
**DANA (director):** Brief in one line: sleazy private eye in a mini Tel Aviv, glowing scandals, snap at the peak, points for timing. Browser game, first-time client, has to just work.
**DANA (director):** Three of you build, Omer tests, I direct and review. Every file has one owner. Spec section 13 is the ownership table, section 14 the contracts. If you need a contract change, you put it in your report, I decide.
**YONI (eng-lead):** Tech stack: vanilla JS, canvas 2D, classic script tags. ES modules die on file://, and the client will double-click index.html. Agreed?
**DANA (director):** Agreed. No npm, no CDN, no image files. One global, `PE`.
**NOA (world-artist):** Then all art is procedural. I pre-render people into a cache at boot: 8 directions, 3 walk frames, about 45 looks. A few hundred tiny canvases, built in well under a second.
**YONI (eng-lead):** And the ground?
**NOA (world-artist):** Chunks of 16x16 tiles, 512 px square, drawn once. Per frame you blit 4 to 6 of them. Buildings get a fake-height roof offset, GTA2 style, drawn after people.
**OMER (qa):** Can a roof cover a scandal? Then the player can't see the glow.
**NOA (world-artist):** Spots stay 2 tiles clear of every building, and the offset is capped at 24 px. I'll mark spots in the debug overlay so you can check.
**DANA (director):** The glow is the star of the show. No shadowBlur per frame.
**NOA (world-artist):** One pre-blurred green silhouette per direction, tinted by alpha. A pulse and a white core near the peak. Basically free.
**TAMAR (design-writer):** Curve: weak start at 0.10, quadratic rise over 14 s to 1.0, then 8 s down to zero. Rising slowly then accelerating builds tension; the faster drop punishes being late.
**OMER (qa):** Will the player see the perfect moment, or have to guess it?
**TAMAR (design-writer):** Both cues. The pulse gets faster as intensity climbs, and the peak action starts 1 s before the peak: the kiss, the envelope. You shoot on the kiss.
**DANA (director):** Perfect window plus or minus 0.35 s, worth 1500. Everything else uses a quadratic falloff, 50 minimum. No glow costs 150, out of range costs 100.
**YONI (eng-lead):** Does "too far" end the scandal?
**DANA (director):** No. Only a scored photo or expiry ends it.
**OMER (qa):** Spawn distance. "Reachable in time" has to be provable.
**YONI (eng-lead):** BFS path on the tile grid, 18 to 34 tiles. At 140 px/s the worst case is 7.8 s, against 14 s to the peak. Relaxed fallback is capped at 40 tiles, which is 9.1 s.
**OMER (qa):** Then I write a bot. Headless, it walks the BFS path and shoots at exactly t=14, 100 seeds. Anything below PERFECT means a broken spawn or a broken collision.
**YONI (eng-lead):** For that, game, npc and city have to load in Node. No DOM at load time, drawing only inside draw functions.
**NOA (world-artist):** Fine. city.init() is pure data; initGraphics() is the canvas part.
**DANA (director):** Spawn off-screen too. Nobody pops into existence in front of the player.
**TAMAR (design-writer):** Content. Seven scandals: affair, drug deal, councilman bribe, influencer dumping trash at the beach, match fixing, health inspector bribe, rent-a-crowd protest with four people.
**DANA (director):** Rules: fictional names only, no real clubs, parties or brands. Mock hypocrisy and institutions, not ethnic groups or religion.
**TAMAR (design-writer):** English with transliterated slang (yalla, sababa, achi). No Hebrew script; RTL in canvas text is a mess. Bubbles max 48 characters.
**YONI (eng-lead):** I cache bubble canvases by text, so short repeated lines cost nothing.
**TAMAR (design-writer):** Ambient: falafel and kiosk vendors calling out, cafe people talking startups and rent, joggers, matkot on the beach, dog walkers, scooter riders ringing bells.
**NOA (world-artist):** Matkot pairs need a ball. I'll give you `drawIcon('ball')`; you animate it in npc.js.
**TAMAR (design-writer):** Also scandal lines have to tell the story. Six lines before the peak, one peak line, a couple after. The pager tip names the scandal and the area.
**DANA (director):** The pager is our GTA2 nod. Keep it.
**YONI (eng-lead):** HUD: shekels score, case counter, pager, camera icon for range, feedback popup. Arrow on the screen edge with meters. On a scored photo I grab a polaroid from the canvas for the results screen.
**OMER (qa):** One thing: ten logic steps per frame on a slow laptop could hide events from the UI.
**YONI (eng-lead):** main.js collects events across steps into `frameEvents`. It's in the contract.
**DANA (director):** Performance budget: 2 ms update, 6 ms render on an M1 Air. Debug overlay shows both.
**NOA (world-artist):** Canvas renders at 960x540 internally and CSS scales it up, pixelated. Cheap on Retina and fits the look.
**OMER (qa):** Browsers: Chrome, Edge, Firefox, Safari. I'll run the headless suite and review the code statically; the in-browser pass comes after build.
**DANA (director):** Docs: I write them. Your reports come to me; I log each review as one file with transcript plus action items. Under 200 lines each.
**DANA (director):** Everyone builds v0.1 in parallel against the spec. Don't touch files you don't own. Go.

## Decisions
- Vanilla JS, classic scripts, global `PE`, procedural art, file:// must work.
- Glow curve, scoring, spawn numbers locked as in spec sections 4-7 for v0.1; tuning happens at review 1.
- Headless rule for data/logic/city/npc/game; QA proves reachability with a bot.
- Docs: numbered, one per loop, Dana sole author, <= 8 files.

## Action items
| Owner | Item | Due |
|---|---|---|
| eng-lead (Yoni) | index.html, main.js loop/input/camera/states, logic.js pure functions, game.js scandal manager + scoring + player, ui.js HUD/arrow/ring/bubbles/screens/polaroid, sfx.js | v0.1 build |
| world-artist (Noa) | art.js sprite caches, glow, fx, vehicles; city.js 96x64 map, collision grid, >= 20 spots, paths, lanes, POIs, chunk rendering, pseudo-3D buildings | v0.1 build |
| design-writer (Tamar) | data.js: PE.CFG exact values, 7 scandal defs, >= 140 ambient lines, PE.TEXT; npc.js ambient crowd + vehicles + speech | v0.1 build |
| qa (Omer) | tests/run.js runner + logic/data/city/sim tests (spec-driven, black box); bot proves reach-in-time over 100 seeds | v0.1 build (written); run at review 1 |
| qa (Omer) | Static code review + contract conformance report per file | review 1 |
| dana | Review build, playtest, write `03-review-v0.1.md` | review 1 |
| dana | README.md run instructions (M1 Mac + Windows) | v1.0 ship |
