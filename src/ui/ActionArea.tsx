import { useEffect, useState } from "react";
import type { Advice } from "../analysis/advisor";
import { legalActions, potTotal } from "../engine/gameState";
import { describeHand } from "../engine/handRanks";
import type { GameState, PlayerAction } from "../engine/types";
import { type AssistLevel, canDeal, HUMAN_ID, useGameStore } from "../store/gameStore";
import { chips, signed } from "./format";

interface Props {
  game: GameState;
  advice: Advice | null;
  assist: AssistLevel;
}

export function ActionArea({ game, advice, assist }: Props) {
  const humanAct = useGameStore((s) => s.humanAct);
  const myTurn = game.phase === "betting" && game.players[game.toAct].id === HUMAN_ID;
  const showCoach = advice && (assist === "coach" || assist === "guided");

  return (
    <div className="action-area">
      {myTurn && showCoach && <CoachBox advice={advice} />}
      {game.phase === "complete" ? (
        <ResultBanner game={game} />
      ) : myTurn ? (
        <ActionBar game={game} onAct={humanAct} recommended={assist === "guided" ? advice : null} />
      ) : (
        <div className="action-bar">
          <div className="waiting">
            <span className="think">
              <i />
              <i />
              <i />
            </span>
            {game.players.find((p) => p.id === HUMAN_ID)?.folded
              ? "You folded. Watch how the hand plays out."
              : `Waiting for ${game.players[game.toAct]?.name}…`}
          </div>
        </div>
      )}
    </div>
  );
}

function CoachBox({ advice }: { advice: Advice }) {
  return (
    <div className="coach-box" role="status">
      <div>
        <div className="who">Coach suggests</div>
        <div className="headline">{advice.headline}</div>
        <div className="text-2">{advice.reason}</div>
      </div>
    </div>
  );
}

function ActionBar({
  game,
  onAct,
  recommended,
}: {
  game: GameState;
  onAct: (a: PlayerAction) => void;
  recommended: Advice | null;
}) {
  const legal = legalActions(game)!;
  const pot = potTotal(game);
  const [amount, setAmount] = useState(legal.minRaiseTo);
  useEffect(() => setAmount(recommended?.amount ?? legal.minRaiseTo), [game, legal.minRaiseTo, recommended?.amount]);

  const clamp = (n: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(n)));
  // "Pot-sized" raise: call first, then raise the size of the resulting pot.
  const potRaise = (fraction: number) => clamp(game.currentBet + (pot + legal.toCall) * fraction);
  const rec = (kind: "fold" | "call" | "raise") => {
    if (!recommended) return false;
    const a = recommended.action;
    if (kind === "call") return a === "call" || a === "check";
    if (kind === "raise") return a === "raise" || a === "bet";
    return a === "fold";
  };

  const fold = () => onAct({ type: "fold" });
  const checkCall = () => onAct({ type: legal.canCheck ? "check" : "call" });
  const raise = () => legal.canRaise && onAct({ type: legal.raiseType, amount: clamp(amount) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === "f" && legal.canFold) fold();
      else if (k === "c") checkCall();
      else if (k === "r") raise();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const allIn = clamp(amount) === legal.maxRaiseTo;
  const raiseLabel = allIn ? "All-in" : legal.raiseType === "bet" ? "Bet" : "Raise to";

  return (
    <div className="action-bar">
      <button className={`btn act fold ${rec("fold") ? "recommended" : ""}`} onClick={fold} disabled={!legal.canFold}>
        Fold<span className="kbd">F</span>
      </button>
      <button className={`btn act call ${rec("call") ? "recommended" : ""}`} onClick={checkCall}>
        {legal.canCheck ? "Check" : legal.toCall >= game.players[game.toAct].stack ? `Call all-in ${chips(legal.toCall)}` : `Call ${chips(legal.toCall)}`}
        <span className="kbd">C</span>
      </button>
      {legal.canRaise && (
        <>
          <button className={`btn act raise btn-primary ${rec("raise") ? "recommended" : ""}`} onClick={raise}>
            {raiseLabel} {chips(clamp(amount))}
            <span className="kbd" style={{ color: "inherit" }}>R</span>
          </button>
          <div className="raise-controls">
            <input
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={Math.max(1, game.config.smallBlind)}
              value={clamp(amount)}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Bet amount"
            />
            <input
              type="number"
              className="num"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              onBlur={() => setAmount(clamp(amount))}
              aria-label="Bet amount"
            />
            <div className="presets">
              <button className="btn btn-sm" onClick={() => setAmount(legal.minRaiseTo)}>Min</button>
              <button className="btn btn-sm" onClick={() => setAmount(potRaise(0.5))}>½ Pot</button>
              <button className="btn btn-sm" onClick={() => setAmount(potRaise(1))}>Pot</button>
              <button className="btn btn-sm" onClick={() => setAmount(legal.maxRaiseTo)}>All-in</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ResultBanner({ game }: { game: GameState }) {
  const { dealNextHand, rebuy, leaveTable, settings } = useGameStore();
  const outcome = game.outcome!;
  const me = game.players.find((p) => p.id === HUMAN_ID)!;
  const myWin = outcome.payouts[HUMAN_ID] ?? 0;
  const net = myWin - me.handBet;
  const name = (id: string) => game.players.find((p) => p.id === id)!.name;

  const lines = outcome.pots.map((pot, i) => {
    const who = pot.winners.map(name).join(" & ");
    const label = outcome.pots.length > 1 ? (i === 0 ? "Main pot" : `Side pot ${i}`) : "Pot";
    const verb = pot.winners.length > 1 ? "split" : pot.winners[0] === HUMAN_ID ? "win" : "wins";
    return `${who} ${verb} ${label.toLowerCase()} (${chips(pot.amount)})${pot.handName ? ` with ${pot.handName}` : ""}`;
  });

  const busted = me.stack === 0;
  const tableWon = !busted && game.players.every((p) => p.isHuman || p.stack === 0);
  const myHand = outcome.hands[HUMAN_ID];

  return (
    <div className={`result-banner ${myWin > 0 ? "" : "lost"}`}>
      <div>
        <div className="title">
          {tableWon
            ? "You won the table! 🏆"
            : busted
              ? "You're out of chips"
              : myWin > 0
                ? `You win ${chips(myWin)}`
                : me.handBet > 0
                  ? `You lose ${chips(me.handBet)}`
                  : "Hand over"}
          {myWin > 0 && net !== myWin && <span className="muted num"> (net {signed(net)})</span>}
        </div>
        {lines.map((l) => (
          <div key={l} className="text-2">{l}</div>
        ))}
        {myHand && myWin === 0 && <div className="muted">You had {describeHand(myHand)}</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {busted || tableWon ? (
          <>
            <button className="btn btn-primary" onClick={rebuy}>{busted ? "Rebuy & keep playing" : "Play on with refilled stacks"}</button>
            <button className="btn" onClick={leaveTable}>Back to lobby</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={dealNextHand} disabled={!canDeal(game)} autoFocus>
            {settings.autoDeal ? "Deal now" : "Next hand"}
          </button>
        )}
      </div>
    </div>
  );
}
