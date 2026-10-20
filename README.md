# imaplaypoker

**Learn poker by playing it.** Play No-Limit Texas Hold'em against computer opponents, or with friends, while a built-in coach explains what's going on.

## Get the game

| Your device | What to do |
|---|---|
| **Chromebook**, or any computer without installing | Play in your browser at **https://1andresito.github.io/imaplaypoker/** |
| **Windows** | Download `_Windows-setup.exe` from the [latest release](https://github.com/1andresito/imaplaypoker/releases/latest) |
| **Mac** | Download `_macOS-Apple-Silicon.dmg` (M1 and newer) or `_macOS-Intel.dmg` (older Macs) |
| **Debian, Ubuntu, Mint** | Download `_Debian-Ubuntu.deb` |
| **Fedora, RHEL, openSUSE** | Download `_Fedora.rpm` |
| **Any other Linux** | Download `_Linux-AppImage.AppImage` |

On the releases page, ignore the `.sig`, `.tar.gz` and `latest.json` files: they're for automatic updates.

**First launch on a Mac:** the app isn't notarized by Apple, so macOS says it "could not verify" imaplaypoker. Click **Done**, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. You only need to do this once.

The desktop app updates itself: when a new version is out, the main menu offers to install it. Your settings and stats are kept.

## What's in it

- **A real poker game:** play against 1–8 bots with distinct styles (Rock, Shark, Maniac, Calling Station). Blinds, all-ins, side pots and split pots all work properly.
- **Hand Helper:** shows what you're holding right now ("Two Pair, Kings and Sevens"), highlights your best five cards, and shows your chance of ending up with each kind of hand and what beats you.
- **Live stats:** your chance to win, pot odds, outs, and your playing habits over time (VPIP, PFR, showdown wins, a chip chart).
- **Choose how much help you get:**

  | Level | What you get |
  |---|---|
  | Off | Just the game |
  | Hints | Win chance, pot odds, outs, threats |
  | Coach | Hints plus a suggested move and a plain-English reason |
  | Guided | Coach plus the suggested button highlighted, the bet size filled in, and a starting-hand chart |

- **Multiplayer** (desktop app): play with friends on the same Wi-Fi or over the internet.
- **Sound and music:** card and chip sounds, plus optional jazz (turn it on with the ♫ button).
- **Keyboard shortcuts:** **F** to fold, **C** to check or call, **R** to raise.

Omaha, Five-Card Draw and Seven-Card Stud are planned.

## Playing on a Chromebook

Open **https://1andresito.github.io/imaplaypoker/** in Chrome. To keep it in your launcher like an app, click the install icon at the right of the address bar.

- Everything except multiplayer works the same as the desktop app. Browsers can't make the direct connections multiplayer needs.
- Your settings and stats are saved in Chrome on that Chromebook. Clearing your browsing data resets them.
- You need an internet connection to open it.

**Want multiplayer on a Chromebook?** If your Chromebook has an Intel or AMD processor and lets you turn on Linux (**Settings → About ChromeOS → Developers → Linux development environment**), install the `_Debian-Ubuntu.deb` instead. Rooms on your Wi-Fi won't appear automatically, so join by typing the host's IP address. To host, add port `47820` (TCP) under **Linux development environment → Port forwarding**. School Chromebooks usually don't allow Linux.

## Multiplayer

One person hosts and their computer runs the game. You don't need an account or a server.

**To host:** Main menu → **Multiplayer** → **Host a game** → **Open room**. You get a room code like `K7QM-2XPA` to give your friends. In the lobby you can:
- add bots and pick their style
- set the blinds and starting chips
- turn on a turn timer (20, 30 or 60 seconds; when it runs out, the player checks if they can, otherwise folds)
- choose whether learning helpers are allowed
- kick players or lock the room

Up to 8 seats in total. Press **Start game** when everyone's in.

**To join:**
- **Same Wi-Fi:** the room shows up under **Join a game**. Pick it and type the code.
- **Over the internet:** the host forwards TCP port `47820` on their router to their computer. You type the host's public IP address and the code.

The first time you host, your computer may ask whether to let the app through the firewall. Allow it on private networks.

If your connection drops, your seat is kept: the turn timer checks or folds for you until you press **Reconnect**.

### Is it safe?

- **Your room code is never sent over the network,** so nobody listening in can steal it. Wrong guesses get cut off quickly.
- **Everything is encrypted,** and messages that have been tampered with are rejected.
- **No cheating:** only the host's computer runs the game. Every move is checked, and nobody receives other players' cards until the showdown.
- **Seats can't be stolen,** and kicked players can't come back in.
- **The game port is open only while you're hosting.**

"Helpers off" is a table rule, not a lock. Someone running a modified copy could still work out odds from their own cards, but no one can ever see another player's cards.

## Contributing

Want to build it yourself or help out? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Music: "Jazz Improvisation Looped" by Alex McCulloch (Pro Sensory), [CC0](https://creativecommons.org/publicdomain/zero/1.0/), from [OpenGameArt](https://opengameart.org/content/jazz-improvisation-looped). All sound effects are made in code.

Released under the [MIT License](LICENSE).
