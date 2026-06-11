/**
 * Tiered reopen decision — pure function, no I/O.
 *
 * When a user clicks "Reopen" on an existing version, the cheapest path that
 * restores a live preview should be taken:
 *
 *   TIER 1 — probe:   the preview URL is still alive  → just re-stamp; no sandbox churn
 *   TIER 2 — restart: sandbox exists but isn't serving → start (if stopped) + relaunch Metro
 *   TIER 3 — fresh:   sandbox is gone                 → full destroy + re-provision
 *
 * G5 rule: if the version has a live agentJobId, the agent owns the sandbox.
 * We must never delete or restart it. In that case we short-circuit to TIER 1
 * (probe only) and, if alive, re-stamp. If not alive the agent will sort it out.
 *
 * Pure: no imports from _generated, no convex npm package, no I/O.
 */

export type ProbeOutcome = "alive" | "dead";

export type SandboxState = "running" | "stopped" | "unknown";

export type ReopenTier = 1 | 2 | 3;

export interface ReopenDecisionInput {
  /** Sandbox responded to the preview probe with HTTP 200. */
  probeOutcome: ProbeOutcome;
  /** Whether the Daytona sandbox still exists (not yet cleaned up). */
  sandboxState: SandboxState;
  /**
   * G5: version is owned by a live agent job — we must never delete/restart
   * its sandbox out from under it. Tier 3 is forbidden; tier 2 is forbidden.
   */
  hasAgentJob: boolean;
}

/**
 * Decision table:
 *
 * | probe | sandboxState | agentJob | tier | reason                                          |
 * |-------|-------------|----------|------|-------------------------------------------------|
 * | alive | any          | any      |  1   | preview URL responds — re-stamp only            |
 * | dead  | running      | false    |  2   | sandbox up but Metro dead — restart Metro       |
 * | dead  | stopped      | false    |  2   | sandbox stopped — start sandbox + relaunch Metro|
 * | dead  | unknown      | false    |  3   | can't determine sandbox state — fresh provision |
 * | dead  | running      | true     |  1   | agent owns it — don't touch, re-stamp if alive  |
 * | dead  | stopped      | true     |  1   | agent owns it — don't touch (tier 1 "no-op")   |
 * | dead  | unknown      | true     |  1   | agent owns it — don't touch (tier 1 "no-op")   |
 *
 * When agentJob=true and probe=dead, tier 1 is returned but the caller should
 * not re-stamp (nothing to stamp). The caller should leave the version alone
 * and let the agent manage lifecycle — it's the same early-exit the existing
 * G5 guard in provisionPreview implements.
 */
export function decideReopenTier(input: ReopenDecisionInput): ReopenTier {
  const { probeOutcome, sandboxState, hasAgentJob } = input;

  // Tier 1: probe says alive → re-stamp only, no sandbox churn regardless of agent.
  if (probeOutcome === "alive") return 1;

  // G5: agent owns the sandbox — never restart or delete.
  if (hasAgentJob) return 1;

  // Tier 2: sandbox exists (running or stopped) — we can restart/start it.
  if (sandboxState === "running" || sandboxState === "stopped") return 2;

  // Tier 3: sandbox state unknown (gone or inaccessible) — full fresh provision.
  return 3;
}
