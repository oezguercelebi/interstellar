/**
 * Unit tests for convex/lib/sandbox/reopenTier.ts — pure decision table.
 * No I/O, no network, runs under `node --test --experimental-strip-types`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideReopenTier,
  type ReopenDecisionInput,
} from "../convex/lib/sandbox/reopenTier.ts";

function input(overrides: Partial<ReopenDecisionInput>): ReopenDecisionInput {
  return {
    probeOutcome: "dead",
    sandboxState: "unknown",
    hasAgentJob: false,
    ...overrides,
  };
}

// ── Tier 1: probe=alive → always tier 1 regardless of sandbox state or agentJob ──

test("tier 1: probe=alive, sandboxState=running, agentJob=false → 1", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "alive", sandboxState: "running" })), 1);
});

test("tier 1: probe=alive, sandboxState=stopped, agentJob=false → 1", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "alive", sandboxState: "stopped" })), 1);
});

test("tier 1: probe=alive, sandboxState=unknown, agentJob=false → 1", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "alive", sandboxState: "unknown" })), 1);
});

test("tier 1: probe=alive, agentJob=true → 1 (probe wins, re-stamp safe)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "alive", hasAgentJob: true })), 1);
});

// ── G5: agentJob=true, probe=dead → tier 1 (don't touch the sandbox) ──────────

test("G5: probe=dead, sandboxState=running, agentJob=true → 1 (agent owns it)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "dead", sandboxState: "running", hasAgentJob: true })), 1);
});

test("G5: probe=dead, sandboxState=stopped, agentJob=true → 1 (agent owns it)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "dead", sandboxState: "stopped", hasAgentJob: true })), 1);
});

test("G5: probe=dead, sandboxState=unknown, agentJob=true → 1 (agent owns it)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "dead", sandboxState: "unknown", hasAgentJob: true })), 1);
});

// ── Tier 2: probe=dead, agentJob=false, sandbox exists ────────────────────────

test("tier 2: probe=dead, sandboxState=running, agentJob=false → 2 (restart Metro)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "dead", sandboxState: "running" })), 2);
});

test("tier 2: probe=dead, sandboxState=stopped, agentJob=false → 2 (start + relaunch Metro)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "dead", sandboxState: "stopped" })), 2);
});

// ── Tier 3: probe=dead, agentJob=false, sandbox state unknown → full provision ──

test("tier 3: probe=dead, sandboxState=unknown, agentJob=false → 3 (fresh provision)", () => {
  assert.equal(decideReopenTier(input({ probeOutcome: "dead", sandboxState: "unknown" })), 3);
});

// ── Exhaustive cross-product ──────────────────────────────────────────────────

const cases: Array<[ReopenDecisionInput, 1 | 2 | 3]> = [
  // probe=alive: always tier 1
  [{ probeOutcome: "alive", sandboxState: "running",  hasAgentJob: false }, 1],
  [{ probeOutcome: "alive", sandboxState: "stopped",  hasAgentJob: false }, 1],
  [{ probeOutcome: "alive", sandboxState: "unknown",  hasAgentJob: false }, 1],
  [{ probeOutcome: "alive", sandboxState: "running",  hasAgentJob: true  }, 1],
  [{ probeOutcome: "alive", sandboxState: "stopped",  hasAgentJob: true  }, 1],
  [{ probeOutcome: "alive", sandboxState: "unknown",  hasAgentJob: true  }, 1],
  // probe=dead, agentJob=true: always tier 1 (G5)
  [{ probeOutcome: "dead",  sandboxState: "running",  hasAgentJob: true  }, 1],
  [{ probeOutcome: "dead",  sandboxState: "stopped",  hasAgentJob: true  }, 1],
  [{ probeOutcome: "dead",  sandboxState: "unknown",  hasAgentJob: true  }, 1],
  // probe=dead, agentJob=false: tier depends on sandbox state
  [{ probeOutcome: "dead",  sandboxState: "running",  hasAgentJob: false }, 2],
  [{ probeOutcome: "dead",  sandboxState: "stopped",  hasAgentJob: false }, 2],
  [{ probeOutcome: "dead",  sandboxState: "unknown",  hasAgentJob: false }, 3],
];

test("exhaustive cross-product: all 12 probe×state×agentJob combinations", () => {
  for (const [inp, expected] of cases) {
    const got = decideReopenTier(inp);
    assert.equal(
      got,
      expected,
      `probe=${inp.probeOutcome} state=${inp.sandboxState} agentJob=${inp.hasAgentJob} → expected tier ${expected}, got ${got}`,
    );
  }
});
