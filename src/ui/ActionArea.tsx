import { useEffect, useState } from "react";
import type { Advice } from "../analysis/advisor";
import { legalActions, potTotal } from "../engine/gameState";
import { describeHand } from "../engine/handRanks";
import type { GameState, PlayerAction } from "../engine/types";
import { useClientStore } from "../net/clientSession";
import { type AssistLevel, canDeal, useGameStore } from "../store/gameStore";
import { chips, signed } from "./format";
import { gameHotkey } from "./hotkeys";
import { Icon } from "./icons";

interface Props {
  game: GameState;
  advice: Advice | null;
  assist: AssistLevel;
}

export function ActionArea({ game, advice, assist }: Props) {
  const humanAct = useGameStore((s) => s.humanAct);
  const myId = useGameStore((s) => s.myId);
  const notice = useClientStore((s) => s.notice);
  const myTurn = game.phase === "betting" && game.players[game.toAct].id === myId;
  const showCoach = advice && (assist === "coach" || assist === "guided");

  return (
    <div className="action-area">
      {notice && <div className="net-notice" role="alert">{notice}</div>}
      {myTurn && showCoach && <CoachBox advice={advice} />}
      {game.phase === "complete" ? (
        <ResultBanner game={game} />
      ) : myTurn ? (
        <ActionBar game={game} onAct={humanAct} recommended={assist === "guided" ? advice : null} />
      ) : (
        <div className="action-bar">
          <div className="waiting">
            <span className="think"><i /><i /><i /></span>
            {game.players.find((p) => p.id === myId)?.folded
              ? "You folded. Watch how the hand plays out."
              : `${game.players[game.toAct]?.name} is thinking…`}
          </div>
        </div>
      )}
    </div>
  );
}

function CoachBox({ advice }: { advice: Advice }) {
  return (
    <div className="coach-box" role="status">
      <div className="icon"><Icon name="coach" size="1.9rem" /></div>
      <div>
        <div className="who">Coach</div>
        <div className="reason">
          <strong>{advice.headline}.</strong>
          {advice.reason}
        </div>
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
  const me = game.players[game.toAct];
  const pot = potTotal(game);
  const [amount, setAmount] = useState(legal.minRaiseTo);
  useEffect(() => setAmount(recommended?.amount ?? legal.minRaiseTo), [game, legal.minRaiseTo, recommended?.amount]);

  const clamp = (n: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(n) || 0));
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
      const key = gameHotkey(e);
      if (key === "fold" && legal.canFold) fold();
      else if (key === "call") checkCall();
      else if (key === "raise") raise();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const to = clamp(amount);
  const allIn = to === legal.maxRaiseTo;
  const callAllIn = legal.toCall >= me.stack;

  return (
    <div className="action-bar my-turn">
      <div className="turn-banner">
        <span className="title">Your move</span>
        <span className="facts num">
          {legal.canCheck ? "No bet to call" : `To call: ${chips(legal.toCall)}`} · Pot: {chips(pot)} · Your chips: {chips(me.stack)}
        </span>
      </div>
      <div className="act-row">
        <button className={`act fold ${rec("fold") ? "recommended" : ""}`} onClick={fold} disabled={!legal.canFold}>
          Fold
          <span className="sub">{legal.canFold ? "Give up this hand" : "Free to check instead"}<span className="kbd">F</span></span>
        </button>
        <button className={`act call ${rec("call") ? "recommended" : ""}`} onClick={checkCall}>
          {legal.canCheck ? "Check" : callAllIn ? `Call all-in` : `Call ${chips(legal.toCall)}`}
          <span className="sub">{legal.canCheck ? "Pass without betting" : callAllIn ? `${chips(legal.toCall)} chips` : "Match the bet"}<span className="kbd">C</span></span>
        </button>
        <button className={`act raise ${rec("raise") ? "recommended" : ""}`} onClick={raise} disabled={!legal.canRaise}>
          {!legal.canRaise ? "Raise" : allIn ? `All-in ${chips(to)}` : `${legal.raiseType === "bet" ? "Bet" : "Raise to"} ${chips(to)}`}
          <span className="sub">{legal.canRaise ? "Set the amount below" : "Can't raise now"}<span className="kbd">R</span></span>
        </button>
      </div>
      {legal.canRaise && (
        <div className="raise-controls">
          <span className="lbl">Amount</span>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={Math.max(1, game.config.smallBlind)}
            value={to}
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
            onBlur={() => setAmount(to)}
            aria-label="Bet amount"
          />
          <div className="presets">
            <button className="btn btn-sm" onClick={() => setAmount(legal.minRaiseTo)}>Min</button>
            <button className="btn btn-sm" onClick={() => setAmount(potRaise(0.5))}>½ Pot</button>
            <button className="btn btn-sm" onClick={() => setAmount(potRaise(1))}>Pot</button>
            <button className="btn btn-sm" onClick={() => setAmount(legal.maxRaiseTo)}>All-in</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultBanner({ game }: { game: GameState }) {
  const { dealNextHand, rebuy, leaveTable, settings, mode, myId } = useGameStore();
  const outcome = game.outcome!;
  const me = game.players.find((p) => p.id === myId)!;
  const myWin = outcome.payouts[myId] ?? 0;
  const net = myWin - me.handBet;
  const myHand = outcome.hands[myId];
  const busted = me.stack === 0;
  const tableWon = !busted && game.players.every((p) => p.id === myId || p.stack === 0);
  const someoneBusted = game.players.some((p) => p.stack === 0);

  const title = tableWon
    ? "You cleaned out the table"
    : busted
      ? "You're out of chips"
      : myWin > 0
        ? `You won ${chips(myWin)} chips`
        : me.folded
          ? me.handBet > 0 ? `You folded and lost ${chips(me.handBet)}` : "You folded"
          : me.handBet > 0
            ? `You lost ${chips(me.handBet)} chips`
            : "Hand over";

  return (
    <div className="action-bar result-banner">
      <div className="result-row">
        <div>
          <div className="title">
            {tableWon && <Icon name="trophy" size="1.2em" />} {title}
            {myWin > 0 && net !== myWin && <span className="muted num" style={{ fontSize: "1rem" }}> (profit {signed(net)})</span>}
          </div>
          {myHand && <div className="text-2">Your hand: {describeHand(myHand)}</div>}
        </div>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          {mode === "client" ? (
            <span className="text-2">
              {busted ? "You're out of chips. The host can refill everyone's stack." : "Next hand starts in a moment…"}
            </span>
          ) : mode === "host" ? (
            <>
              {(someoneBusted || !canDeal(game, mode, myId)) && (
                <button className="btn" onClick={rebuy} title="Give every player with no chips a fresh starting stack">
                  Refill empty stacks
                </button>
              )}
              <button className="btn btn-primary" onClick={dealNextHand} disabled={!canDeal(game, mode, myId)}>
                Deal now ▶
              </button>
            </>
          ) : busted || tableWon ? (
            <>
              <button className="btn btn-primary" onClick={rebuy}>{busted ? "Rebuy & keep playing" : "Play on with refilled stacks"}</button>
              <button className="btn" onClick={leaveTable}>Main menu</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={dealNextHand} disabled={!canDeal(game)} autoFocus>
              {settings.autoDeal ? "Deal now" : "Next hand"} <Icon name="play" size="0.9em" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
