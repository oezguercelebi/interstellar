/**
 * Agent runner decision state machine.
 *
 * Maps the current job state to the next action the awaitVariant poller
 * (Convex-side) or the runner itself should take. Pure — no I/O, no imports
 * from convex runtime or npm packages.
 *
 * Action semantics (§5 failure semantics in the plan):
 *   complete         — runner finished successfully; flip status to ready
 *   fail             — exhausted retries or unrecoverable; flip status to failed
 *   continue         — job is live; keep polling
 *   retry-git-reset  — first retry for edits: git reset --hard in-box, re-run
 *   retry-recreate   — destroy sandbox, provision fresh nw2 box, re-run
 */

export type RunnerAction =
  | "continue"
  | "retry-git-reset"
  | "retry-recreate"
  | "fail"
  | "complete";

export type JobStatus =
  | "running"
  | "complete"
  | "failed"
  | "not-found"; // Daytona spurious NotFound (transient)

export type SandboxState = "running" | "stopped" | "unknown";

export interface DecisionInput {
  jobStatus: JobStatus;
  heartbeatAgeMs: number;
  attempt: number;        // 0-based; 0 = first try
  sandboxState: SandboxState;
  tscCycle: number;       // 0–4; how many tsc verify cycles have run
  isEdit: boolean;        // edits get a cheaper first retry (git reset)
  budgetExhausted: boolean;
  turnLimitReached: boolean;
  notFoundCount: number;  // consecutive spurious NotFound responses (tolerate ≤2)
}

/** Maximum total attempts (0-based attempts 0, 1, 2 → 3 tries). */
export const MAX_ATTEMPTS = 3;

/** Tolerate up to this many consecutive spurious Daytona NotFound responses. */
export const MAX_NOT_FOUND_TOLERANCE = 2;

/** Heartbeat age past which the sandbox is presumed dead. */
export const HEARTBEAT_STALE_MS = 60_000;

export function decide(input: DecisionInput): RunnerAction {
  const {
    jobStatus,
    heartbeatAgeMs,
    attempt,
    sandboxState,
    isEdit,
    budgetExhausted,
    turnLimitReached,
    notFoundCount,
  } = input;

  // Completed successfully.
  if (jobStatus === "complete") return "complete";

  // Budget or turn limit exhausted — terminal failure.
  if (budgetExhausted || turnLimitReached) return "fail";

  // Tolerate spurious Daytona NotFound up to MAX_NOT_FOUND_TOLERANCE times.
  if (jobStatus === "not-found") {
    if (notFoundCount <= MAX_NOT_FOUND_TOLERANCE) return "continue";
    // Too many consecutive NotFound → treat as sandbox death.
    return attempt < MAX_ATTEMPTS - 1
      ? isEdit && attempt === 0
        ? "retry-git-reset"
        : "retry-recreate"
      : "fail";
  }

  // Runner reported failure.
  if (jobStatus === "failed") {
    if (attempt < MAX_ATTEMPTS - 1) {
      return isEdit && attempt === 0 ? "retry-git-reset" : "retry-recreate";
    }
    return "fail";
  }

  // Sandbox stopped = dead.
  if (sandboxState === "stopped") {
    if (attempt < MAX_ATTEMPTS - 1) {
      return isEdit && attempt === 0 ? "retry-git-reset" : "retry-recreate";
    }
    return "fail";
  }

  // Heartbeat stale = presumed dead.
  if (heartbeatAgeMs > HEARTBEAT_STALE_MS) {
    if (attempt < MAX_ATTEMPTS - 1) {
      return isEdit && attempt === 0 ? "retry-git-reset" : "retry-recreate";
    }
    return "fail";
  }

  // Job is running, everything looks healthy.
  return "continue";
}
