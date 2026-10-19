import type { FinalWhatIf } from "../analysis/whatIf";
import { describeHand } from "../engine/handRanks";
import type { GameState } from "../engine/types";
import { CardRow } from "./PlayingCard";

const COLORS = { win: "var(--good)", tie: "var(--warn)", lose: "var(--bad)" } as const;

/** "If you'd stayed in, you would have won with a Flush" (plus the run-out board, if any). */
export function FoldVerdict({ game, whatIf, board = true }: { game: GameState; whatIf: FinalWhatIf; board?: boolean }) {
  const opp = game.players.find((p) => p.id === whatIf.bestOpponent.id)!;
  const color = COLORS[whatIf.result];
  return (
    <span className="fold-verdict">
      If you'd stayed in, you would have{" "}
      {whatIf.result === "win" ? (
        <><strong style={{ color }}>won</strong> with {describeHand(whatIf.myHand)} (vs {opp.name}'s {describeHand(whatIf.bestOpponent.hand)})</>
      ) : whatIf.result === "tie" ? (
        <><strong style={{ color }}>split the pot</strong> with {describeHand(whatIf.myHand)}</>
      ) : (
        <><strong style={{ color }}>lost</strong> to {opp.name}'s {describeHand(whatIf.bestOpponent.hand)} (you'd have {describeHand(whatIf.myHand)})</>
      )}
      {board && whatIf.ranOut && (
        <>
          {" "}· the board would have run <CardRow cards={whatIf.board.slice(game.board.length)} />
        </>
      )}
    </span>
  );
}
