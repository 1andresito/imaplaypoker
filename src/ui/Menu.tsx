import type { ReactNode } from "react";
import { BOT_PROFILES } from "../ai/profiles";
import { parseCards } from "../engine/cards";
import { HAND_RANKS } from "../engine/handRanks";
import { VARIANTS } from "../engine/variants";
import { rate } from "../stats/tracker";
import { useGameStore } from "../store/gameStore";
import { chips, pct, signed } from "./format";
import { chipStackSvg } from "./logo";
import { ASSIST_LEVELS } from "./Modals";
import { PlayingCard } from "./PlayingCard";
import { CategoryBars, StatBlock } from "./StatsPanel";
import { STYLE_COLORS } from "./Table";

const LOGO_SVG = chipStackSvg();

export function Logo({ size }: { size: string }) {
  return <span className="logo" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />;
}

/** Round sound / music / settings buttons pinned to the corner of menu screens. */
function CornerControls({ onSettings }: { onSettings: () => void }) {
  const { settings, updateSettings } = useGameStore();
  return (
    <div className="corner-controls">
      <button
        className={`round-btn ${settings.music ? "on" : ""}`}
        role="switch"
        aria-checked={settings.music}
        aria-label="Background music"
        title={settings.music ? "Turn music off" : "Play background jazz"}
        onClick={() => updateSettings({ music: !settings.music })}
      >
        ♫
      </button>
      <button
        className={`round-btn ${settings.soundEffects ? "on" : ""}`}
        role="switch"
        aria-checked={settings.soundEffects}
        aria-label="Sound effects"
        title={settings.soundEffects ? "Mute sound effects" : "Turn sound effects on"}
        onClick={() => updateSettings({ soundEffects: !settings.soundEffects })}
      >
        {settings.soundEffects ? "🔊" : "🔇"}
      </button>
      <button className="round-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
        ⚙
      </button>
    </div>
  );
}

/** Shared backdrop for every menu screen: felt, vignette, and a few scattered cards. */
function MenuScene({ children, onSettings }: { children: ReactNode; onSettings: () => void }) {
  return (
    <div className="menu-scene">
      <div className="scene-cards" aria-hidden>
        {["As", "Kh", "Qd", "Jc"].map((c, i) => (
          <div key={c} className={`scene-card c${i}`}>
            <PlayingCard card={parseCards(c)[0]} size="lg" />
          </div>
        ))}
      </div>
      <CornerControls onSettings={onSettings} />
      {children}
    </div>
  );
}

function ScreenHeader({ title }: { title: string }) {
  const goTo = useGameStore((s) => s.goTo);
  return (
    <div className="screen-header">
      <button className="back-btn" onClick={() => goTo("menu")}>◀ Back</button>
      <h1>{title}</h1>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MainMenu({ onSettings }: { onSettings: () => void }) {
  const { goTo, lifetime } = useGameStore();
  return (
    <MenuScene onSettings={onSettings}>
      <div className="main-menu">
        <div className="title-block">
          <Logo size="11rem" />
          <h1 className="game-title">
            imaplay<span>poker</span>
          </h1>
          <p className="tagline">Learn poker by playing it</p>
        </div>
        <nav className="menu-buttons">
          <button className="menu-btn primary" onClick={() => goTo("setup")} autoFocus>
            ▶ Play
          </button>
          <button className="menu-btn" onClick={() => goTo("howto")}>How to Play</button>
          <button className="menu-btn" onClick={() => goTo("stats")}>My Stats</button>
          <button className="menu-btn" onClick={onSettings}>Settings</button>
        </nav>
        {lifetime.handsPlayed > 0 && (
          <div className="menu-footer num">
            {chips(lifetime.handsPlayed)} hands played · {signed(lifetime.netChips)} chips all time
          </div>
        )}
      </div>
    </MenuScene>
  );
}

// ---------------------------------------------------------------------------

const UPCOMING = [
  { id: "omaha", name: "Omaha" },
  { id: "draw", name: "Five-Card Draw" },
  { id: "stud", name: "Seven-Card Stud" },
];

const STAKES = [
  { bb: 10, label: "Penny", icon: "🪙" },
  { bb: 20, label: "Casual", icon: "💵" },
  { bb: 50, label: "High", icon: "💰" },
  { bb: 100, label: "VIP", icon: "💎" },
];

const STACKS = [
  { bbs: 50, label: "Short", desc: "Fast & swingy" },
  { bbs: 100, label: "Standard", desc: "The classic" },
  { bbs: 200, label: "Deep", desc: "Room to play" },
];


function Tile({ selected, onClick, children, disabled, label }: { selected?: boolean; onClick?: () => void; children: ReactNode; disabled?: boolean; label?: string }) {
  return (
    <button className="tile" aria-pressed={selected} onClick={onClick} disabled={disabled} aria-label={label}>
      {selected && <span className="tile-check" aria-hidden>✓</span>}
      {children}
    </button>
  );
}

export function TableSetup({ onSettings }: { onSettings: () => void }) {
  const { setup, updateSetup, settings, updateSettings, sitDown } = useGameStore();
  const profiles = Object.values(BOT_PROFILES);

  return (
    <MenuScene onSettings={onSettings}>
      <div className="menu-panel">
        <ScreenHeader title="Set up your table" />

        <section className="setup-row">
          <h2>Game</h2>
          <div className="tile-row slim">
            {Object.values(VARIANTS).map((v) => (
              <Tile key={v.id} selected={setup.variantId === v.id} onClick={() => updateSetup({ variantId: v.id })}>
                <span className="tile-icon">♠</span>
                <span className="tile-name">{v.name}</span>
              </Tile>
            ))}
            {UPCOMING.map((v) => (
              <Tile key={v.id} disabled label={`${v.name} (coming soon)`}>
                <span className="tile-icon">🔒</span>
                <span className="tile-name">{v.name}</span>
                <span className="tile-desc">Coming soon</span>
              </Tile>
            ))}
          </div>
        </section>

        <div className="setup-columns players">
          <section className="setup-row">
            <h2>Opponents</h2>
            <div className="stepper">
              <button className="step-btn" onClick={() => updateSetup({ bots: Math.max(1, setup.bots - 1) })} disabled={setup.bots <= 1} aria-label="Fewer opponents">
                −
              </button>
              <div className="step-value">
                <span className="num">{setup.bots}</span>
                <small>{setup.bots === 1 ? "Heads-up" : "players"}</small>
              </div>
              <button className="step-btn" onClick={() => updateSetup({ bots: Math.min(8, setup.bots + 1) })} disabled={setup.bots >= 8} aria-label="More opponents">
                +
              </button>
            </div>
            <div className="seat-preview" aria-hidden>
              {Array.from({ length: setup.bots }, (_, i) => {
                const id = setup.botStyle === "mixed" ? profiles[i % profiles.length].id : setup.botStyle;
                return <span key={i} className="mini-avatar" style={{ background: STYLE_COLORS[id] }} />;
              })}
            </div>
          </section>

          <section className="setup-row">
            <h2>Opponent style</h2>
            <div className="tile-row compact">
              <Tile selected={setup.botStyle === "mixed"} onClick={() => updateSetup({ botStyle: "mixed" })}>
                <span className="tile-avatars">
                  {profiles.map((p) => (
                    <span key={p.id} className="mini-avatar" style={{ background: STYLE_COLORS[p.id] }} />
                  ))}
                </span>
                <span className="tile-name">Mixed</span>
              </Tile>
              {profiles.map((p) => (
                <Tile key={p.id} selected={setup.botStyle === p.id} onClick={() => updateSetup({ botStyle: p.id })} label={`${p.name}: ${p.description}`}>
                  <span className="avatar" style={{ background: STYLE_COLORS[p.id] }}>{p.name[0]}</span>
                  <span className="tile-name">{p.name}</span>
                </Tile>
              ))}
            </div>
            <p className="setup-hint">
              {setup.botStyle === "mixed" ? "A bit of everyone. Learn to spot each style." : BOT_PROFILES[setup.botStyle].description}
            </p>
          </section>
        </div>

        <div className="setup-columns">
          <section className="setup-row">
            <h2>Stakes</h2>
            <div className="tile-row compact">
              {STAKES.map((s) => (
                <Tile
                  key={s.bb}
                  selected={setup.bigBlind === s.bb}
                  onClick={() => updateSetup({ bigBlind: s.bb, startingStack: (setup.startingStack / setup.bigBlind) * s.bb })}
                >
                  <span className="tile-icon">{s.icon}</span>
                  <span className="tile-name">{s.label}</span>
                  <span className="tile-desc num">{chips(s.bb / 2)}/{chips(s.bb)}</span>
                </Tile>
              ))}
            </div>
          </section>

          <section className="setup-row">
            <h2>Starting chips</h2>
            <div className="tile-row compact">
              {STACKS.map((s) => (
                <Tile
                  key={s.bbs}
                  selected={setup.startingStack === s.bbs * setup.bigBlind}
                  onClick={() => updateSetup({ startingStack: s.bbs * setup.bigBlind })}
                >
                  <span className="tile-name">{s.label}</span>
                  <span className="tile-big num">{chips(s.bbs * setup.bigBlind)}</span>
                  <span className="tile-desc">{s.desc}</span>
                </Tile>
              ))}
            </div>
          </section>
        </div>

        <div className="setup-final">
          <section className="setup-row">
            <h2>Help while you play</h2>
            <div className="tile-row compact">
              {ASSIST_LEVELS.map((l) => (
                <Tile key={l.id} selected={settings.assist === l.id} onClick={() => updateSettings({ assist: l.id })} label={`${l.name}: ${l.description}`}>
                  <span className="tile-icon">{l.icon}</span>
                  <span className="tile-name">{l.name}</span>
                  <span className="tile-desc">{l.short}</span>
                </Tile>
              ))}
            </div>
          </section>
          <button className="menu-btn primary deal-btn" onClick={sitDown}>
            Deal me in ▶
          </button>
        </div>
      </div>
    </MenuScene>
  );
}

// ---------------------------------------------------------------------------

const BASICS = [
  { icon: "🂠", title: "Your cards", text: "You get 2 private cards. Only you can see them." },
  { icon: "🃏", title: "Shared cards", text: "5 cards are dealt face up in the middle: 3 (the flop), then 1 (the turn), then 1 (the river)." },
  { icon: "🏆", title: "Best five", text: "Make the best 5-card hand from your 2 cards plus the 5 shared ones." },
  { icon: "🪙", title: "Betting", text: "Before each new card, everyone can fold, check, call, or raise. Win the pot by having the best hand or by making everyone else fold." },
];

export function HowToPlay({ onSettings }: { onSettings: () => void }) {
  return (
    <MenuScene onSettings={onSettings}>
      <div className="menu-panel">
        <ScreenHeader title="How to play" />
        <div className="howto-basics">
          {BASICS.map((b) => (
            <div key={b.title} className="howto-card">
              <span className="tile-icon">{b.icon}</span>
              <h3>{b.title}</h3>
              <p>{b.text}</p>
            </div>
          ))}
        </div>
        <section className="setup-row">
          <h2>Hand rankings: best at the top</h2>
          <div className="howto-ranks">
            {[...HAND_RANKS].reverse().map((r, i) => (
              <div key={r.category} className="howto-rank">
                <span className="rank-badge num">{i + 1}</span>
                <div className="howto-rank-text">
                  <strong>{r.name}</strong>
                  <span>{r.description}</span>
                </div>
                <span className="howto-cards">
                  {parseCards(r.example).map((c) => (
                    <PlayingCard key={c} card={c} size="xs" />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
        <p className="setup-hint">
          Tip: turn on <strong>Coach</strong> or <strong>Guided</strong> help when you set up a table, and the game will explain each decision as you play.
        </p>
      </div>
    </MenuScene>
  );
}

// ---------------------------------------------------------------------------

export function StatsScreen({ onSettings }: { onSettings: () => void }) {
  const lifetime = useGameStore((s) => s.lifetime);
  return (
    <MenuScene onSettings={onSettings}>
      <div className="menu-panel narrow">
        <ScreenHeader title="My stats" />
        {lifetime.handsPlayed === 0 ? (
          <div className="empty-state">
            <Logo size="5rem" />
            <p>No hands played yet. Your stats will show up here after your first game.</p>
          </div>
        ) : (
          <>
            <div className="hero-stat">
              <span className="num">{pct(rate(lifetime.handsWon, lifetime.handsPlayed))}</span>
              <small>of hands won</small>
            </div>
            <StatBlock stats={lifetime} />
            <section className="setup-row">
              <h2>Showdowns won with</h2>
              <CategoryBars counts={lifetime.wonByCategory} />
            </section>
          </>
        )}
      </div>
    </MenuScene>
  );
}
