# imaplaypoker

A desktop poker game for **Windows, macOS, and Linux** that teaches you while you play.

- **Real game:** No-Limit Texas Hold'em against 1–8 computer opponents with distinct styles (Rock, Shark, Maniac, Calling Station). It handles blinds, min-raises, all-ins, side pots, and split pots.
- **Hand Helper panel:** shows what you have right now (“Two Pair, Kings and Sevens”) with your best five cards highlighted on the table. It also shows the full hand-rankings ladder with your chance of finishing on each hand, your outs, and what beats you on the current board.
- **Live stats:** win chance, pot odds and the equity you need to call, outs and the rule of 4 & 2, plus session and all-time VPIP, PFR, showdown win rate, stack chart, and coach agreement.
- **Assistance levels:**
  | Level | What you get |
  |---|---|
  | Off | Just the game (the Hand Helper shows only your hand and the rankings) |
  | Hints | Win chance, pot odds, outs, threats |
  | Coach | Hints plus a suggested action with a plain-English reason |
  | Guided | Coach plus the suggested button highlighted, bet size pre-filled, and a starting-hand chart |

- **Game-style menus:** a main menu (Play, How to Play, My Stats, Settings) and a one-screen table setup with tiles for opponents, their style, stakes, chips, and help level.
- **Sound:** synthesized effects for cards, chips, checks and folds, plus interface sounds for hovering, clicking, tabs, toggles, sliders and dialogs. Optional jazz (off by default; turn it on with the ♫ button), looped seamlessly: the player trims the track's ending fade and silence and crossfades each pass into the next (`src/audio/musicLoop.ts`).

Omaha, Five-Card Draw, and Seven-Card Stud are planned. The engine's `Variant` interface (`src/engine/variants/`) is where they plug in.

## Run it

```bash
npm install
npm run dev        # play in the browser at http://localhost:1420
npm test           # engine, analysis, bot, store and UI tests
```

### As a desktop app (Tauri)

You need the Rust toolchain once per machine. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (“Desktop development with C++”) and [rustup](https://rustup.rs/). WebView2 ships with Windows 11.
- **macOS:** `xcode-select --install`, then rustup.
- **Linux:** `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, and the other packages in the prerequisites guide, then rustup.

```bash
npm run tauri dev     # desktop window with hot reload
npm run tauri build   # installer for the current OS (src-tauri/target/release/bundle)
```

Installers for all three platforms are built by GitHub Actions (`.github/workflows/build.yml`) on every push to `main`. Pushing a tag like `v0.1.0` creates a draft release with the installers attached.

## Logo and icons

The chip-stack logo is drawn in code (`src/ui/logo.ts`). After changing it, regenerate the favicon and desktop icons:

```bash
node --experimental-transform-types scripts/make-icons.mjs
npx tauri icon app-icon.svg
```

## Project layout

```
src/engine/    rules: cards, hand evaluator, betting state machine, side pots, variants
src/analysis/  learning layer: equity (Monte Carlo), outs, pot odds, threats, preflop chart, coach
src/ai/        bot personalities (built on the coach's advice, bent by profile)
src/stats/     VPIP / PFR / results tracking, persisted in local storage
src/store/     zustand store tying the engine, bots and stats together
src/ui/        React components (table, action bar, Hand Helper, stats, hand log)
src-tauri/     the native desktop shell (window only — no game logic in Rust)
```

## Credits

Music: “Jazz Improvisation Looped” by Alex McCulloch (Pro Sensory), [CC0](https://creativecommons.org/publicdomain/zero/1.0/), from [OpenGameArt](https://opengameart.org/content/jazz-improvisation-looped). All sound effects are synthesized in code (`src/audio/sound.ts`).
