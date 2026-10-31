# HUSH MONEY

A small top-down 2D browser game set in a pocket-sized Tel Aviv. You are a sleazy private eye. Scandals break out around the city: an affair on the boulevard, a bribe at a cafe, an influencer dumping trash on the beach. Get there, catch the moment on camera, and get paid to keep quiet.

No installation needed. The game is plain HTML and JavaScript, and every graphic and sound is generated inside the browser.

## Run it

### macOS (M1 / Apple Silicon or Intel)
1. Unzip or copy the `check-one-two` folder anywhere, for example to Desktop.
2. Double-click `index.html`. It opens in your default browser (Safari, Chrome, Firefox or Edge).
3. To use a specific browser, right-click `index.html` > Open With > Google Chrome (or another browser).

### Windows 10 / 11
1. Unzip or copy the `check-one-two` folder anywhere.
2. Double-click `index.html`. It opens in your default browser (Edge, Chrome or Firefox).
3. To use a specific browser, right-click `index.html` > Open with > Google Chrome.

Click the game once if the keyboard doesn't respond. The game scales to fit the window, and F11 (Windows) or Ctrl+Cmd+F (Mac) gives you fullscreen.

### Fallback: local web server (optional)
The game is built to run straight from the file. If a locked-down browser blocks local files anyway, serve the folder instead:
- **If Node.js is installed** (check with `node --version`), open a terminal in the game folder:
  - Mac: in Finder, right-click the game folder > **New Terminal at Folder**. If that item is missing, open Terminal, type `cd ` (with a space), drag the folder into the window, and press Return.
  - Windows: open the game folder in File Explorer, click the address bar, type `powershell`, and press Enter.

  Then run:
  ```
  node -e "const h=require('http'),f=require('fs');h.createServer((q,s)=>{let p=q.url.split('?')[0];if(p=='/')p='/index.html';f.readFile('.'+decodeURIComponent(p),(e,d)=>{if(e){s.writeHead(404);return s.end()}s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'});s.end(d)})}).listen(8080,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8080'))"
  ```
  Then open http://127.0.0.1:8080 in your browser. Press Ctrl+C in the terminal to stop the server.
  If it says `EADDRINUSE`, port 8080 is already taken: change `8080` to another number (e.g. `8081`) in both places in the command, and open that address instead.
- **Without Node:** try another browser. Chrome, Edge, Firefox and Safari all run the game from the file.

## How to play
1. A **pager tip** at the top of the screen tells you who is up to what, and where.
2. Follow the **green arrow** at the edge of the screen. It shows the distance in meters. It only points; take whatever route you like.
3. The people involved **glow bright green**. The glow starts weak, grows toward the perfect moment, then fades away.
4. Get close. Green brackets frame the scene and the camera icon (bottom right) turns cyan with **IN RANGE**.
5. Read the dialogue. The people lean in just before the big moment (the kiss, the envelope, the handoff). At the perfect moment there's a white flash and a ping. **Shoot right then.** Anticipating beats reacting.

### Scoring
| Shot | Points |
|---|---|
| Perfect moment | 1,500 (PERFECT SHOT) |
| Close to it | up to 1,000; fewer the further you are from the peak (being early is forgiven more than being late) |
| Photo with no scandal glowing | -150 (WASTED FILM) |
| Photo while out of range | -100 (TOO FAR); the scandal keeps going |
| Scandal fades before you shoot | 0 (MISSED) |

A run has 6 cases and lasts about 2 minutes. At the end, your **blackmail portfolio** shows every photo, its tabloid headline, your total and your rank.

### Controls
| Key | Action |
|---|---|
| W A S D or arrow keys | Walk |
| Shift (hold) | Jog |
| Space or K | Take a photo |
| P or Esc | Pause / resume |
| R | Restart the run |
| Enter | Start / play again |
| M | Mute / unmute |
| ` (backquote) | Debug overlay (FPS) |

## Troubleshooting
- **Black screen or an error message on screen:** make sure the whole folder was copied, including the `js` folder next to `index.html`. Then reload (Cmd+R / Ctrl+R).
- **Keys do nothing:** click inside the game window once.
- **No sound:** browsers start audio only after the first key press. Press M to check the game isn't muted, and check the system volume.
- **Choppy:** close other heavy tabs. The debug overlay (backquote key) shows FPS; the game targets 60.
- **Best score:** it's saved in your browser. Private or incognito windows forget it.

## For developers
- Tech: vanilla JavaScript + Canvas 2D, classic `<script>` tags, global namespace `PE`. No build step, no dependencies.
- Tests (needs Node.js 18+): run `node tests/run.js` in the project folder. It prints a summary and exits with code 0 when everything passes.
- Handy URL options: `index.html?seed=123` (repeatable run), `index.html?debug=1` (debug overlay).
- Design, specs and meeting notes are in `docs/` (start with `docs/01-design-and-tech-spec.md`).
