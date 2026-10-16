import { holdem } from "./holdem";
import type { Variant } from "./Variant";

export type { Street, Variant } from "./Variant";

export const VARIANTS: Record<string, Variant> = { holdem };
