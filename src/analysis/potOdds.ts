export interface PotOdds {
  toCall: number;
  /** Pot including all bets already made, before you call. */
  pot: number;
  /** Equity you need for a call to break even: toCall / (pot + toCall). */
  requiredEquity: number;
  /** Ratio form, e.g. "3 : 1" means the pot offers 3 chips for every 1 you put in. */
  ratio: string;
}

export function potOdds(pot: number, toCall: number): PotOdds | null {
  if (toCall <= 0) return null;
  const ratio = pot / toCall;
  return {
    toCall,
    pot,
    requiredEquity: toCall / (pot + toCall),
    ratio: `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)} : 1`,
  };
}

/**
 * Expected chip gain of calling right now (ignoring future betting):
 * you win the current pot with probability `equity`, and lose your call otherwise.
 */
export const callEV = (equity: number, pot: number, toCall: number): number => equity * pot - (1 - equity) * toCall;
