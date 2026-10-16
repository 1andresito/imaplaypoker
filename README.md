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
- **Multiplayer (desktop app):** host a table on your own computer for up to 8 seats (you, friends, and bots), or join someone else's. See [Multiplayer](#multiplayer).
- **Sound:** synthesized effects for cards, chips, checks and folds, plus interface sounds for hovering, clicking, tabs, toggles, sliders and dialogs. Optional jazz (off by default; turn it on with the ♫ button), looped seamlessly: the player trims the track's ending fade and silence and crossfades each pass into the next (`src/audio/musicLoop.ts`).

Omaha, Five-Card Draw, and Seven-Card Stud are planned. The engine's `Variant` interface (`src/engine/variants/`) is where they plug in.

## Multiplayer

One player hosts and their computer runs the game. No server or account is needed.

**Hosting:** Main menu → **Multiplayer** → **Host a game** → **Open room**. You get a room code like `K7QM-2XPA`. In the lobby you choose:
- bots, and their style
- blinds and starting chips
- a turn timer (off, 20, 30 or 60 s; when time runs out, the player checks if they can, otherwise folds)
- whether learning helpers are allowed

The table holds at most 8 seats in total. You can kick players and lock the room. Press **Start game** when everyone is in.

**Joining:**
- **Same Wi-Fi:** rooms on the network show up under **Join a game**. Pick one, type the code, and join.
- **Over the internet:** the host forwards TCP port `47820` (changeable under *Advanced*) on their router to their computer. Then you type the host's public IP and the code.

The first time you host, your OS may ask whether to let the app through the firewall. Allow it on private networks.

If a player's connection drops mid-game, their seat stays: the turn timer checks or folds for them, and **Reconnect** puts them back in the same seat.

### How it's kept safe

- **The room code is never sent over the network.** Players prove they know it with a password-authenticated key exchange (SPAKE2). Someone recording the traffic can't recover the code or try guesses offline.
- **Everything is encrypted and tamper-proof.** Each connection uses its own keys (ChaCha20-Poly1305). Altered or replayed messages drop the connection.
- **Guessing is cut off.** An address is ignored for the rest of the session after 5 wrong codes. After 50 wrong codes in total, the room stops accepting new players until the host makes a new code.
- **Limits:**
  - handshakes must finish within 10 s, with at most 16 in progress at once
  - messages from players are capped at 16 KiB and about 20 per second
  - players are refused once all 8 seats are taken
- **Cheating is blocked.**
  - The host's computer is the only one that runs the game.
  - Players only send moves, and each move is checked: it must be that player's turn, the current hand, and a legal move. Repeated messages are ignored.
  - Each player receives the table with the deck removed and other players' cards hidden. Cards are revealed only at showdown.
- **Seats can't be stolen.** Reconnecting needs a random per-seat token, and kicked players' tokens stop working.
- **Discovery reveals nothing secret.** LAN discovery only answers local addresses and shares just the room name, seat count and port. Replies are smaller than requests, so the host can't be used to flood someone else with traffic.
- **The game port is open only while you host.**

"Helpers off" is a table rule: a modified copy of the game could still work out odds from the player's own cards. No setting lets anyone see another player's cards.

The networking code is in `src-tauri/src/net/` (handshake, encryption, limits) and `src/net/` (protocol, validation, host and player sessions).

## Run it

```bash
npm install
npm run dev        # play in the browser at http://localhost:1420
npm test           # engine, analysis, bot, store, multiplayer and UI tests
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

Installers for all three platforms are built by GitHub Actions (`.github/workflows/build.yml`) on every push to `main`.

## Releases and auto-update

The desktop app checks for a newer version each time it starts. If one exists, a banner on the main menu offers to download it, install it, and restart. Settings and stats are kept. **Settings → About** shows the current version and has a **Check for updates** button.

To publish a release:

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit, then tag and push: `git tag v0.3.0 && git push origin v0.3.0`.
3. GitHub Actions builds every platform and publishes a release with the installers and `latest.json`, which is the feed installed copies check.

Updates are signed, and the app only installs updates signed with the matching key. The public key is in `src-tauri/tauri.conf.json`. The private key must be stored as repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file (`~/.tauri/imaplaypoker.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password (`~/.tauri/imaplaypoker.password.txt`) |

Without them, releases still build, but they have no update files. Keep the private key safe: if it's lost, already-installed copies can't verify new updates, and users would need to reinstall by hand once.

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
