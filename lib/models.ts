/** Client-side mirror of the model tiers + effort options (UI labels + cost hints). */

export const MODEL_HAIKU = "claude-haiku-4-5-20251001";
export const MODEL_SONNET = "claude-sonnet-4-6";
export const MODEL_OPUS = "claude-opus-4-8";

export type ModelId = typeof MODEL_HAIKU | typeof MODEL_SONNET | typeof MODEL_OPUS;
export const DEFAULT_MODEL: ModelId = MODEL_SONNET;

export interface ModelOption {
  id: ModelId;
  name: string;
  cost: string; // short cost cue
  blurb: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: MODEL_HAIKU, name: "Haiku", cost: "$", blurb: "Fastest & cheapest — great for quick iterations" },
  { id: MODEL_SONNET, name: "Sonnet", cost: "$$", blurb: "Balanced taste & cost — the everyday default" },
  { id: MODEL_OPUS, name: "Opus", cost: "$$$", blurb: "Best design taste — for the final polish" },
];

export type Effort = "low" | "medium" | "high";
export const DEFAULT_EFFORT: Effort = "medium";
export const EFFORT_OPTIONS: { id: Effort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Med" },
  { id: "high", label: "High" },
];

/** Effort (adaptive thinking) only applies to Opus 4.8. */
export function supportsEffort(model: string): boolean {
  return model === MODEL_OPUS;
}

export function modelName(model?: string): string {
  return MODEL_OPTIONS.find((m) => m.id === model)?.name ?? "Sonnet";
}
