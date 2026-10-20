# Contributing

## Run it

```bash
npm install
npm run dev        # play in the browser at http://localhost:1420
npm test           # engine, analysis, bot, store, multiplayer and UI tests
```

### As a desktop app (Tauri)

You need the Rust toolchain once per machine. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++") and [rustup](https://rustup.rs/). WebView2 ships with Windows 11.
- **macOS:** `xcode-select --install`, then rustup.
- **Linux:** `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, and the other packages in the prerequisites guide, then rustup.

```bash
npm run tauri dev     # desktop window with hot reload
npm run tauri build   # installer for the current OS (src-tauri/target/release/bundle)
```

## Continuous integration

- `.github/workflows/build.yml` tests and builds installers for every platform on each push to `main`.
- `.github/workflows/pages.yml` publishes the web version to GitHub Pages on each push to `main`. It's the browser build, with multiplayer and auto-update hidden (`isDesktopApp()` in `src/store/updateStore.ts`).

## Releases and auto-update

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
2. Commit, then tag and push, e.g. `git tag v0.7.0 && git push origin v0.7.0`.
3. GitHub Actions builds every platform and publishes a release with the installers and `latest.json`, the feed installed copies check for updates.

Updates are signed, and the app only installs updates signed with the matching key. The public key is in `src-tauri/tauri.conf.json`. The private key and its password are stored as repository secrets named `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without them, releases still build but have no update files. Never commit the private key. If it's lost, installed copies can't verify new updates, and users have to reinstall by hand once.

## Multiplayer networking

The networking code is in `src-tauri/src/net/` (handshake, encryption, limits, LAN discovery) and `src/net/` (protocol, validation, host and player sessions):

- Players prove they know the room code with SPAKE2, and each connection is encrypted with ChaCha20-Poly1305.
- An address is ignored after 5 wrong codes. After 50 wrong codes in total, the room stops accepting players until the host makes a new code.
- Handshakes must finish within 10 s, with at most 16 in progress. Player messages are capped at 16 KiB and about 20 per second.
- LAN discovery uses UDP port `47821` and only answers local addresses. Replies are smaller than requests, so the host can't be used to flood someone else with traffic.

## Logo and icons

The chip-stack logo is drawn in code (`src/ui/logo.ts`). After changing it, regenerate the favicon and app icons:

```bash
node --experimental-transform-types scripts/make-icons.mjs
npx tauri icon app-icon.svg
cp src-tauri/icons/icon.png public/icons/icon-512.png
cp src-tauri/icons/128x128@2x.png public/icons/icon-256.png
```

## Project layout

```
src/engine/    rules: cards, hand evaluator, betting state machine, side pots, variants
src/analysis/  learning layer: equity (Monte Carlo), outs, pot odds, threats, preflop chart, coach
src/ai/        bot personalities (built on the coach's advice, bent by profile)
src/stats/     VPIP / PFR / results tracking, persisted in local storage
src/store/     zustand store tying the engine, bots and stats together
src/ui/        React components (table, action bar, Hand Helper, stats, hand log)
src/net/       multiplayer protocol and sessions
src-tauri/     the native desktop shell: window, auto-updater, multiplayer networking
```

New poker variants plug into the engine's `Variant` interface in `src/engine/variants/`.
