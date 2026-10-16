import type { AssistLevel } from "../store/gameStore";
import type { IconName } from "./icons";

export const ASSIST_LEVELS: { id: AssistLevel; icon: IconName; name: string; short: string; description: string }[] = [
  { id: "off", icon: "cards", name: "Off", short: "Just the cards", description: "Just the game. The Hand Helper shows only your hand and the rankings." },
  { id: "hints", icon: "hint", name: "Hints", short: "Odds & outs", description: "Win chance, pot odds, outs, and what beats you." },
  { id: "coach", icon: "coach", name: "Coach", short: "Tips with reasons", description: "Hints, plus a suggested action with a plain-English reason." },
  { id: "guided", icon: "compass", name: "Guided", short: "Shows the best move", description: "Coach, plus it highlights the suggested button and pre-fills the bet size." },
];

/** Avatar colors per bot style, so you can tell personalities apart at a glance. */
export const STYLE_COLORS: Record<string, string> = {
  rock: "#a9b4bf",
  tag: "#5b9bd5",
  lag: "#d9775f",
  station: "#b394d6",
};
