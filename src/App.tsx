import { useEffect, useState } from "react";
import { canReconnect, useClientStore } from "./net/clientSession";
import { useHostStore } from "./net/hostSession";
import { effectiveAssist, useGameStore } from "./store/gameStore";
import { ActionArea } from "./ui/ActionArea";
import { HandPanel } from "./ui/HandPanel";
import { HistoryPanel } from "./ui/HistoryPanel";
import { HowToPlay, Logo, MainMenu, StatsScreen, TableSetup } from "./ui/Menu";
import { ASSIST_LEVELS, PreflopChartModal, SettingsModal } from "./ui/Modals";
import { formatCode, MultiplayerScreen } from "./ui/Multiplayer";
import { StatsPanel } from "./ui/StatsPanel";
import { Table } from "./ui/Table";
import { UpdateDialog } from "./ui/Updates";
import { useAnalysis } from "./ui/useAnalysis";

type Tab = "helper" | "stats" | "history";

export function App() {
  const screen = useGameStore((s) => s.screen);
  const [showSettings, setShowSettings] = useState(false);
  const largeText = useGameStore((s) => s.settings.largeText);
  useEffect(() => {
    document.documentElement.classList.toggle("large-text", largeText);
  }, [largeText]);
  const openSettings = () => setShowSettings(true);
  return (
    <div className="app">
      {screen === "menu" && <MainMenu onSettings={openSettings} />}
      {screen === "setup" && <TableSetup onSettings={openSettings} />}
      {screen === "howto" && <HowToPlay onSettings={openSettings} />}
      {screen === "stats" && <StatsScreen onSettings={openSettings} />}
      {screen === "multiplayer" && <MultiplayerScreen onSettings={openSettings} />}
      {screen === "table" && (
        <>
          <TopBar onSettings={openSettings} />
          <TableScreen />
          <ConnectionLost />
        </>
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <UpdateDialog />
    </div>
  );
}

function TopBar({ onSettings }: { onSettings: () => void }) {
  const { settings, updateSettings, leaveTable, game, mode, room } = useGameStore();
  const code = useHostStore((s) => s.info?.code);
  const assist = effectiveAssist({ settings, mode, room });
  const helpersLocked = mode !== "solo" && !!room && !room.helpers;
  const leave = () => {
    const question = mode === "host" ? "Close the room? Everyone at the table will be disconnected." : "Leave this game?";
    if (mode === "solo" || window.confirm(question)) leaveTable();
  };
  return (
    <header className="topbar">
      <div className="brand">
        <Logo size="1.9rem" /> imaplaypoker
      </div>
      {game && <span className="hand-info num">Hand #{game.handNumber} · Blinds {game.config.smallBlind}/{game.config.bigBlind}</span>}
      {mode === "host" && code && (
        <span className="hand-info" title="Players need this code to join or rejoin">
          Room code <strong className="num">{formatCode(code)}</strong>
        </span>
      )}
      <div className="spacer" />
      <div>
        <span className="label">Help</span>
        <div className="segmented" title={helpersLocked ? "The host turned helpers off for this table" : undefined}>
          {ASSIST_LEVELS.map((l) => (
            <button
              key={l.id}
              aria-pressed={assist === l.id}
              title={l.description}
              disabled={helpersLocked}
              onClick={() => updateSettings({ assist: l.id })}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <button
        className={`btn btn-sm sound-btn ${settings.music ? "on" : ""}`}
        role="switch"
        aria-checked={settings.music}
        onClick={() => updateSettings({ music: !settings.music })}
        title={settings.music ? "Turn music off" : "Play background jazz"}
      >
        {settings.music ? "♫ Music on" : "♫ Music off"}
      </button>
      <button
        className={`btn btn-sm sound-btn ${settings.soundEffects ? "on" : ""}`}
        role="switch"
        aria-checked={settings.soundEffects}
        onClick={() => updateSettings({ soundEffects: !settings.soundEffects })}
        title={settings.soundEffects ? "Mute sound effects" : "Turn sound effects on"}
        aria-label="Sound effects"
      >
        {settings.soundEffects ? "🔊" : "🔇"}
      </button>
      <button className="btn btn-sm" onClick={onSettings}>⚙ Settings</button>
      <button className="btn btn-sm" onClick={leave} title="Leave the table and go back to the main menu">
        ☰ Menu
      </button>
    </header>
  );
}

function TableScreen() {
  const game = useGameStore((s) => s.game)!;
  const settings = useGameStore((s) => s.settings);
  const assist = useGameStore(effectiveAssist);
  const myId = useGameStore((s) => s.myId);
  const analysis = useAnalysis();
  const [tab, setTab] = useState<Tab>("helper");
  const [chartOpen, setChartOpen] = useState(false);
  const me = game.players.find((p) => p.id === myId)!;

  // Highlight your best five cards once the flop is out (Hand Helper on).
  const highlight = settings.showHandHelper && analysis && game.board.length >= 3 ? analysis.made.cards : [];
  const showPanel = settings.showHandHelper;

  return (
    <div className={`table-layout ${showPanel ? "" : "no-panel"}`}>
      <div className="table-col">
        <Table game={game} highlight={highlight} />
        <ActionArea game={game} advice={analysis?.advice ?? null} assist={assist} />
      </div>
      {showPanel && (
        <aside className="side">
          <div className="tabs" role="tablist">
            {([
              ["helper", "Hand Helper"],
              ["stats", "Stats"],
              ["history", "Hand log"],
            ] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === "helper" && (
            <HandPanel analysis={analysis} assist={assist} street={game.street} onShowChart={() => setChartOpen(true)} />
          )}
          {tab === "stats" && <StatsPanel />}
          {tab === "history" && <HistoryPanel game={game} />}
        </aside>
      )}
      {chartOpen && (
        <PreflopChartModal hole={me.hole} onClose={() => setChartOpen(false)} />
      )}
    </div>
  );
}

/** Player: the host left, removed you, or the connection dropped. */
function ConnectionLost() {
  const { status, endReason, reconnect } = useClientStore();
  const leaveTable = useGameStore((s) => s.leaveTable);
  const mode = useGameStore((s) => s.mode);
  if (mode !== "client" || (status !== "ended" && status !== "connecting")) return null;
  const text =
    status === "connecting"
      ? "Reconnecting…"
      : endReason === "kicked"
        ? "The host removed you from the table."
        : endReason === "hostClosed"
          ? "The host closed the room."
          : "Lost the connection to the host. Your seat is kept and checks or folds until you're back.";
  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-label="Disconnected" style={{ maxWidth: "26rem" }}>
        <h2>{status === "connecting" ? "Reconnecting" : "Disconnected"}</h2>
        <p className="text-2">{text}</p>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
          {endReason === "lost" && canReconnect() && (
            <button className="btn btn-primary" onClick={() => void reconnect()} disabled={status === "connecting"}>
              Reconnect
            </button>
          )}
          <button className="btn" onClick={leaveTable}>Main menu</button>
        </div>
      </div>
    </div>
  );
}
