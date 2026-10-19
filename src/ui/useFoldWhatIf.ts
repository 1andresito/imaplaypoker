import { useMemo } from "react";
import { type FoldWhatIf, foldWhatIf } from "../analysis/whatIf";
import { useGameStore } from "../store/gameStore";

/**
 * Solo only: after you fold, how you'd have done by staying in. Live odds while
 * the hand plays out, then a won/lost verdict once it's over.
 */
export function useFoldWhatIf(): FoldWhatIf | null {
  const game = useGameStore((s) => s.game);
  const myId = useGameStore((s) => s.myId);
  const solo = useGameStore((s) => s.mode === "solo");

  const me = game?.players.find((p) => p.id === myId);
  const active = !!game && solo && !!me?.folded;
  const stillIn = game ? game.players.filter((p) => !p.folded && !p.busted).map((p) => p.id).join(",") : "";
  const key = game ? `${game.handNumber}|${game.board.join(",")}|${game.phase}|${stillIn}` : "";

  return useMemo(
    () => (active ? foldWhatIf(game!, myId) : null),
    // `key` captures the hand, board, phase and who is still in.
    [active, key, myId],
  );
}
