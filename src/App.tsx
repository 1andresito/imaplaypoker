import { useEffect, useState } from "react";
import { HUMAN_ID, useGameStore } from "./store/gameStore";
import { ActionArea } from "./ui/ActionArea";
import { HandPanel } from "./ui/HandPanel";
import { HistoryPanel } from "./ui/HistoryPanel";
import { HowToPlay, Logo, MainMenu, StatsScreen, TableSetup } from "./ui/Menu";
import { ASSIST_LEVELS } from "./ui/constants";
import { Icon } from "./ui/icons";
import { PreflopChartModal, SettingsModal } from "./ui/Modals";
import { SoundToggles } from "./ui/SoundToggles";
import { StatsPanel } from "./ui/StatsPanel";
import { Table } from "./ui/Table";
import { UpdateDialog } from "./ui/Updates";
import { useAnalysis } from "./ui/useAnalysis";

type Tab = "helper" | "stats" | "history";

export function App() {
  const screen = useGameStore((s) => s.screen);
  const [showSettings, setShowSettings] = useState(false);
  const largeText = useGameStore((s) => s.settings.largeText);
  const reduceMotion = useGameStore((s) => s.settings.reduceMotion);
  useEffect(() => {
    document.documentElement.classList.toggle("large-text", largeText);
  }, [largeText]);
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);
  const openSettings = () => setShowSettings(true);
  return (
    <div className="app">
      {/* Keyed so every screen change plays the entrance transition. */}
      <div key={screen} className={`screen screen-${screen}`}>
        {screen === "menu" && <MainMenu onSettings={openSettings} />}
        {screen === "setup" && <TableSetup onSettings={openSettings} />}
        {screen === "howto" && <HowToPlay onSettings={openSettings} />}
        {screen === "stats" && <StatsScreen onSettings={openSettings} />}
        {screen === "table" && (
          <>
            <TopBar onSettings={openSettings} />
            <TableScreen />
          </>
        )}
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <UpdateDialog />
    </div>
  );
}

function TopBar({ onSettings }: { onSettings: () => void }) {
  const assist = useGameStore((s) => s.settings.assist);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const leaveTable = useGameStore((s) => s.leaveTable);
  const game = useGameStore((s) => s.game);
  return (
    <header className="topbar">
      <div className="brand">
        <Logo size="2rem" /> imaplay<span>poker</span>
      </div>
      {game && (
        <span className="hand-info num">
          Hand {game.handNumber} <span className="sep" /> Blinds {game.config.smallBlind}/{game.config.bigBlind}
        </span>
      )}
      <div className="spacer" />
      <div>
        <span className="label">Help</span>
        <div className="segmented">
          {ASSIST_LEVELS.map((l) => (
            <button key={l.id} aria-pressed={assist === l.id} title={l.description} onClick={() => updateSettings({ assist: l.id })}>
              {l.name}
            </button>
          ))}
        </div>
      </div>
      <SoundToggles />
      <button className="btn btn-sm icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
        <Icon name="gear" />
      </button>
      <button className="btn btn-sm" onClick={leaveTable} title="Leave the table and go back to the main menu">
        <Icon name="door" /> Leave table
      </button>
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
