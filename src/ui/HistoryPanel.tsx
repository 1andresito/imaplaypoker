import type { GameState, HandEvent } from "../engine/types";
import { HUMAN_ID } from "../store/gameStore";
import { chips } from "./format";
import { CardRow } from "./PlayingCard";

const STREET = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River" } as const;

export function HistoryPanel({ game }: { game: GameState }) {
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
  const line = (e: HandEvent, i: number) => {
    const me = "playerId" in e && e.playerId === HUMAN_ID;
    const who = <span className={me ? "me" : ""}>{"playerId" in e ? name(e.playerId) : ""}</span>;
    switch (e.kind) {
      case "blind":
        return <div key={i}>{who} posts {e.blind} blind {chips(e.amount)}</div>;
      case "deal":
        return (
          <div key={i} className="street">
            {STREET[e.street]} <CardRow cards={e.cards} />
          </div>
        );
      case "action": {
        const text =
          e.type === "fold" ? "folds" :
          e.type === "check" ? "checks" :
          e.type === "call" ? `calls ${chips(e.amount)}` :
          e.type === "bet" ? `bets ${chips(e.to)}` : `raises to ${chips(e.to)}`;
        return <div key={i}>{who} {text}{e.allIn && e.type !== "fold" ? " (all-in)" : ""}</div>;
      }
      case "refund":
        return <div key={i} className="muted">Uncalled {chips(e.amount)} returned to {who}</div>;
      case "win":
        return (
          <div key={i} style={{ color: "var(--good)" }}>
            {who} wins {chips(e.amount)}{e.handName ? ` with ${e.handName}` : ""}
          </div>
        );
    }
  };

  const shown = game.outcome?.showdown
    ? game.players.filter((p) => game.outcome!.hands[p.id])
    : [];

  return (
    <div className="panel">
      <section className="section">
        <h3>Hand #{game.handNumber}</h3>
        <div className="history">
          <div className="street">Pre-flop</div>
          {game.history.map(line)}
        </div>
      </section>
      {shown.length > 0 && (
        <section className="section">
          <h3>Showdown</h3>
          <div className="history">
            {shown.map((p) => (
              <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={p.id === HUMAN_ID ? "me" : ""} style={{ minWidth: 60 }}>{p.name}</span>
                <CardRow cards={p.hole} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
