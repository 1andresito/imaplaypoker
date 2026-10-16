import { useState } from "react";
import { HUMAN_ID, useGameStore } from "./store/gameStore";
import { ActionArea } from "./ui/ActionArea";
import { HandPanel } from "./ui/HandPanel";
import { HistoryPanel } from "./ui/HistoryPanel";
import { Lobby } from "./ui/Lobby";
import { ASSIST_LEVELS, PreflopChartModal, SettingsModal } from "./ui/Modals";
import { StatsPanel } from "./ui/StatsPanel";
import { Table } from "./ui/Table";
import { useAnalysis } from "./ui/useAnalysis";

type Tab = "helper" | "stats" | "history";

export function App() {
  const screen = useGameStore((s) => s.screen);
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div className="app">
      <TopBar onSettings={() => setShowSettings(true)} />
      {screen === "lobby" ? <Lobby /> : <TableScreen />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function TopBar({ onSettings }: { onSettings: () => void }) {
  const { screen, settings, updateSettings, leaveTable, game } = useGameStore();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="chip-logo" aria-hidden /> imaplaypoker
      </div>
      {game && <span className="muted num">Hand #{game.handNumber} · Blinds {game.config.smallBlind}/{game.config.bigBlind}</span>}
      <div className="spacer" />
      {screen === "table" && (
        <div>
          <label>Assist</label>
          <div className="segmented">
            {ASSIST_LEVELS.map((l) => (
              <button key={l.id} aria-pressed={settings.assist === l.id} title={l.description} onClick={() => updateSettings({ assist: l.id })}>
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="btn btn-sm" onClick={onSettings}>Settings</button>
      {screen === "table" && (
        <button className="btn btn-sm" onClick={leaveTable}>Leave table</button>
      )}
    </header>
  );
}

function TableScreen() {
  const game = useGameStore((s) => s.game)!;
  const settings = useGameStore((s) => s.settings);
  const analysis = useAnalysis();
  const [tab, setTab] = useState<Tab>("helper");
  const [chartOpen, setChartOpen] = useState(false);
  const me = game.players.find((p) => p.id === HUMAN_ID)!;

  // Highlight your best five cards once the flop is out (Hand Helper on).
  const highlight = settings.showHandHelper && analysis && game.board.length >= 3 ? analysis.made.cards : [];
  const showPanel = settings.showHandHelper;

  return (
    <div className={`table-layout ${showPanel ? "" : "no-panel"}`}>
      <div className="table-col">
        <Table game={game} highlight={highlight} />
        <ActionArea game={game} advice={analysis?.advice ?? null} assist={settings.assist} />
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
            <HandPanel analysis={analysis} assist={settings.assist} street={game.street} onShowChart={() => setChartOpen(true)} />
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
