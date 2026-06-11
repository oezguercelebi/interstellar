/**
 * Parser for the agent runner's final report payload.
 *
 * The runner calls bridge.complete with this shape:
 *   { ok: boolean, summary: string, entryScreens: string[], costUsd: number, usage: UsageStats }
 *
 * Tolerant: missing/extra fields are handled gracefully. Returns a typed result
 * or an error object if validation fails.
 */

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface RunnerReport {
  ok: boolean;
  summary: string;
  entryScreens: string[];
  costUsd: number;
  usage: UsageStats;
}

export type ReportParseResult =
  | { valid: true; report: RunnerReport }
  | { valid: false; error: string };

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export function parseRunnerReport(raw: unknown): ReportParseResult {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, error: "report must be a non-null object" };
  }
  const obj = raw as Record<string, unknown>;

  const ok = typeof obj["ok"] === "boolean" ? obj["ok"] : false;
  const summary = typeof obj["summary"] === "string" ? obj["summary"] : "";
  const entryScreens = toStringArray(obj["entryScreens"]);
  const costUsd = toNumber(obj["costUsd"]);

  const rawUsage =
    typeof obj["usage"] === "object" && obj["usage"] !== null
      ? (obj["usage"] as Record<string, unknown>)
      : {};

  const usage: UsageStats = {
    inputTokens: toNumber(rawUsage["inputTokens"]),
    outputTokens: toNumber(rawUsage["outputTokens"]),
    cacheReadTokens: toNumber(rawUsage["cacheReadTokens"]),
    cacheWriteTokens: toNumber(rawUsage["cacheWriteTokens"]),
  };

  return {
    valid: true,
    report: { ok, summary, entryScreens, costUsd, usage },
  };
}
