/**
 * Unit tests for the convex/lib/agentRunner/ pure modules:
 *   decision.ts, overlay.ts, report.ts, token.ts, forbidden.ts
 *
 * All pure — no network, no Convex runtime. Token tests use async (crypto.subtle).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decide,
  MAX_ATTEMPTS,
  MAX_NOT_FOUND_TOLERANCE,
  HEARTBEAT_STALE_MS,
  type DecisionInput,
} from "../convex/lib/agentRunner/decision.ts";

import { looksLikeMetroOverlay } from "../convex/lib/agentRunner/overlay.ts";

import { parseRunnerReport } from "../convex/lib/agentRunner/report.ts";

import { signToken, verifyToken } from "../convex/lib/agentRunner/token.ts";

import { FORBIDDEN_PATHS, isForbiddenPath } from "../convex/lib/agentRunner/forbidden.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function base(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    jobStatus: "running",
    heartbeatAgeMs: 0,
    attempt: 0,
    sandboxState: "running",
    tscCycle: 0,
    isEdit: false,
    budgetExhausted: false,
    turnLimitReached: false,
    notFoundCount: 0,
    ...overrides,
  };
}

// ── decision.ts ───────────────────────────────────────────────────────────────

test("decide: complete when jobStatus=complete", () => {
  assert.equal(decide(base({ jobStatus: "complete" })), "complete");
});

test("decide: fail when budgetExhausted", () => {
  assert.equal(decide(base({ budgetExhausted: true })), "fail");
});

test("decide: fail when turnLimitReached", () => {
  assert.equal(decide(base({ turnLimitReached: true })), "fail");
});

test("decide: continue for healthy running job", () => {
  assert.equal(decide(base()), "continue");
});

test("decide: retry-git-reset on first edit failure (attempt=0, isEdit=true)", () => {
  assert.equal(
    decide(base({ jobStatus: "failed", attempt: 0, isEdit: true })),
    "retry-git-reset",
  );
});

test("decide: retry-recreate on second edit failure (attempt=1, isEdit=true)", () => {
  assert.equal(
    decide(base({ jobStatus: "failed", attempt: 1, isEdit: true })),
    "retry-recreate",
  );
});

test("decide: retry-recreate on first non-edit failure (attempt=0, isEdit=false)", () => {
  assert.equal(
    decide(base({ jobStatus: "failed", attempt: 0, isEdit: false })),
    "retry-recreate",
  );
});

test("decide: fail when jobStatus=failed and attempt=MAX_ATTEMPTS-1", () => {
  assert.equal(
    decide(base({ jobStatus: "failed", attempt: MAX_ATTEMPTS - 1 })),
    "fail",
  );
});

test("decide: continue on spurious NotFound within tolerance", () => {
  assert.equal(
    decide(base({ jobStatus: "not-found", notFoundCount: MAX_NOT_FOUND_TOLERANCE })),
    "continue",
  );
});

test("decide: retry on NotFound exceeding tolerance, attempt=0, isEdit=true", () => {
  assert.equal(
    decide(
      base({
        jobStatus: "not-found",
        notFoundCount: MAX_NOT_FOUND_TOLERANCE + 1,
        attempt: 0,
        isEdit: true,
      }),
    ),
    "retry-git-reset",
  );
});

test("decide: retry-recreate on NotFound exceeding tolerance, attempt=0, isEdit=false", () => {
  assert.equal(
    decide(
      base({
        jobStatus: "not-found",
        notFoundCount: MAX_NOT_FOUND_TOLERANCE + 1,
        attempt: 0,
        isEdit: false,
      }),
    ),
    "retry-recreate",
  );
});

test("decide: fail on NotFound exceeding tolerance at last attempt", () => {
  assert.equal(
    decide(
      base({
        jobStatus: "not-found",
        notFoundCount: MAX_NOT_FOUND_TOLERANCE + 1,
        attempt: MAX_ATTEMPTS - 1,
      }),
    ),
    "fail",
  );
});

test("decide: retry-recreate on stopped sandbox, attempt=0, isEdit=false", () => {
  assert.equal(
    decide(base({ sandboxState: "stopped", attempt: 0, isEdit: false })),
    "retry-recreate",
  );
});

test("decide: retry-git-reset on stopped sandbox, attempt=0, isEdit=true", () => {
  assert.equal(
    decide(base({ sandboxState: "stopped", attempt: 0, isEdit: true })),
    "retry-git-reset",
  );
});

test("decide: fail on stopped sandbox at last attempt", () => {
  assert.equal(
    decide(base({ sandboxState: "stopped", attempt: MAX_ATTEMPTS - 1 })),
    "fail",
  );
});

test("decide: retry-recreate on stale heartbeat, attempt=0", () => {
  assert.equal(
    decide(base({ heartbeatAgeMs: HEARTBEAT_STALE_MS + 1, attempt: 0 })),
    "retry-recreate",
  );
});

test("decide: retry-git-reset on stale heartbeat, attempt=0, isEdit=true", () => {
  assert.equal(
    decide(base({ heartbeatAgeMs: HEARTBEAT_STALE_MS + 1, attempt: 0, isEdit: true })),
    "retry-git-reset",
  );
});

test("decide: fail on stale heartbeat at last attempt", () => {
  assert.equal(
    decide(base({ heartbeatAgeMs: HEARTBEAT_STALE_MS + 1, attempt: MAX_ATTEMPTS - 1 })),
    "fail",
  );
});

test("decide: continue when heartbeat is exactly at HEARTBEAT_STALE_MS (not yet stale)", () => {
  // > not >=, so exactly at limit is still ok
  assert.equal(decide(base({ heartbeatAgeMs: HEARTBEAT_STALE_MS })), "continue");
});

// ── overlay.ts ────────────────────────────────────────────────────────────────

test("looksLikeMetroOverlay: returns true for 'Unable to resolve module'", () => {
  assert.ok(looksLikeMetroOverlay("<html>Unable to resolve module foo</html>"));
});

test("looksLikeMetroOverlay: returns true for 'Bundling failed'", () => {
  assert.ok(looksLikeMetroOverlay("<html>Bundling failed: something went wrong</html>"));
});

test("looksLikeMetroOverlay: returns true for 'Application has not been registered'", () => {
  assert.ok(looksLikeMetroOverlay("Application has not been registered"));
});

test("looksLikeMetroOverlay: returns true for 'hasn't been registered'", () => {
  assert.ok(looksLikeMetroOverlay("App hasn't been registered yet"));
});

test("looksLikeMetroOverlay: returns true for logbox-overlay testid", () => {
  assert.ok(looksLikeMetroOverlay('<div data-testid="logbox-overlay">error</div>'));
});

test("looksLikeMetroOverlay: returns true for Metro Bundler title", () => {
  assert.ok(looksLikeMetroOverlay("<title>Metro Bundler</title>"));
});

test("looksLikeMetroOverlay: returns false for healthy bundle HTML", () => {
  const healthy = `<!DOCTYPE html><html><head><title>My App</title></head><body>
  <div id="root"></div><script src="/bundle.js"></script></body></html>`;
  assert.ok(!looksLikeMetroOverlay(healthy));
});

test("looksLikeMetroOverlay: returns false for empty string", () => {
  assert.ok(!looksLikeMetroOverlay(""));
});

test("looksLikeMetroOverlay: case-insensitive match", () => {
  assert.ok(looksLikeMetroOverlay("BUNDLING FAILED"));
});

// ── report.ts ─────────────────────────────────────────────────────────────────

test("parseRunnerReport: parses a complete valid payload", () => {
  const raw = {
    ok: true,
    summary: "All good",
    entryScreens: ["app/index.tsx", "app/home.tsx"],
    costUsd: 0.042,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
    },
  };
  const result = parseRunnerReport(raw);
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.equal(result.report.ok, true);
  assert.equal(result.report.summary, "All good");
  assert.deepEqual(result.report.entryScreens, ["app/index.tsx", "app/home.tsx"]);
  assert.equal(result.report.costUsd, 0.042);
  assert.equal(result.report.usage.inputTokens, 1000);
  assert.equal(result.report.usage.outputTokens, 500);
  assert.equal(result.report.usage.cacheReadTokens, 200);
  assert.equal(result.report.usage.cacheWriteTokens, 50);
});

test("parseRunnerReport: returns invalid for null", () => {
  const result = parseRunnerReport(null);
  assert.ok(!result.valid);
});

test("parseRunnerReport: returns invalid for non-object", () => {
  const result = parseRunnerReport("string");
  assert.ok(!result.valid);
});

test("parseRunnerReport: missing fields default to safe values", () => {
  const result = parseRunnerReport({});
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.equal(result.report.ok, false);
  assert.equal(result.report.summary, "");
  assert.deepEqual(result.report.entryScreens, []);
  assert.equal(result.report.costUsd, 0);
  assert.equal(result.report.usage.inputTokens, 0);
  assert.equal(result.report.usage.outputTokens, 0);
  assert.equal(result.report.usage.cacheReadTokens, 0);
  assert.equal(result.report.usage.cacheWriteTokens, 0);
});

test("parseRunnerReport: entryScreens filters non-strings from array", () => {
  const result = parseRunnerReport({ entryScreens: ["a", 123, null, "b"] });
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.deepEqual(result.report.entryScreens, ["a", "b"]);
});

test("parseRunnerReport: entryScreens as non-array defaults to []", () => {
  const result = parseRunnerReport({ entryScreens: "not-an-array" });
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.deepEqual(result.report.entryScreens, []);
});

test("parseRunnerReport: usage as non-object defaults to zeros", () => {
  const result = parseRunnerReport({ usage: "bad" });
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.equal(result.report.usage.inputTokens, 0);
});

test("parseRunnerReport: costUsd as non-finite defaults to 0", () => {
  const result = parseRunnerReport({ costUsd: NaN });
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.equal(result.report.costUsd, 0);
});

// ── token.ts ──────────────────────────────────────────────────────────────────

test("token: sign and verify round-trip", async () => {
  const payload = { versionId: "v123", exp: Date.now() + 60_000 };
  const token = await signToken(payload, "mysecret");
  const result = await verifyToken(token, "mysecret");
  assert.ok(result.valid);
  if (!result.valid) return;
  assert.equal(result.payload.versionId, "v123");
  assert.equal(result.payload.exp, payload.exp);
});

test("token: tampered signature → invalid", async () => {
  const payload = { versionId: "v123", exp: Date.now() + 60_000 };
  const token = await signToken(payload, "mysecret");
  // Corrupt the sig part
  const [payloadPart] = token.split(".");
  const tampered = `${payloadPart}.invalidsignatureXXX`;
  const result = await verifyToken(tampered, "mysecret");
  assert.ok(!result.valid);
});

test("token: wrong secret → invalid", async () => {
  const payload = { versionId: "v456", exp: Date.now() + 60_000 };
  const token = await signToken(payload, "correct-secret");
  const result = await verifyToken(token, "wrong-secret");
  assert.ok(!result.valid);
});

test("token: expired → invalid", async () => {
  const payload = { versionId: "v789", exp: Date.now() - 1 }; // already expired
  const token = await signToken(payload, "mysecret");
  const result = await verifyToken(token, "mysecret");
  assert.ok(!result.valid);
  if (result.valid) return;
  assert.equal(result.reason, "token expired");
});

test("token: malformed (no dot) → invalid", async () => {
  const result = await verifyToken("nodothere", "mysecret");
  assert.ok(!result.valid);
});

test("token: expired check uses provided `now` param", async () => {
  const exp = 1_000_000;
  const payload = { versionId: "v1", exp };
  const token = await signToken(payload, "s");
  // Use now = exp - 1 (not expired yet)
  const ok = await verifyToken(token, "s", exp - 1);
  assert.ok(ok.valid);
  // Use now = exp + 1 (expired)
  const expired = await verifyToken(token, "s", exp + 1);
  assert.ok(!expired.valid);
});

// ── forbidden.ts ──────────────────────────────────────────────────────────────

test("isForbiddenPath: returns true for exact forbidden paths", () => {
  assert.ok(isForbiddenPath("package.json"));
  assert.ok(isForbiddenPath("tsconfig.json"));
  assert.ok(isForbiddenPath("tailwind.config.js"));
  assert.ok(isForbiddenPath("global.css"));
});

test("isForbiddenPath: strips leading ./ before checking", () => {
  assert.ok(isForbiddenPath("./package.json"));
  assert.ok(isForbiddenPath("./metro.config.ts"));
});

test("isForbiddenPath: returns false for non-forbidden paths", () => {
  assert.ok(!isForbiddenPath("app/index.tsx"));
  assert.ok(!isForbiddenPath("components/Button.tsx"));
});

test("FORBIDDEN_PATHS contains all expected infra entries", () => {
  const required = [
    "package.json",
    "package-lock.json",
    "app.json",
    "tsconfig.json",
    "babel.config.js",
    "metro.config.js",
    "tailwind.config.js",
    "global.css",
    "nativewind-env.d.ts",
    "postcss.config.js",
  ];
  for (const p of required) {
    assert.ok(FORBIDDEN_PATHS.has(p), `expected FORBIDDEN_PATHS to include ${p}`);
  }
});

// ── template-source logic (fake-bridge, G1 runner unit tests) ─────────────────
// These tests exercise the pure helper logic that is inlined into run.mjs by the
// template generator. They prove correct behaviour without any network or SDK.

// buildTscFollowUpTurn — imported from the template generator module.
import { buildTscFollowUpTurn } from "../scripts/lib/agentRunnerTemplate.mjs";

test("buildTscFollowUpTurn: includes the error block verbatim", () => {
  const turn = buildTscFollowUpTurn("app/index.tsx(1,1): error TS2345: foo");
  assert.match(turn, /error TS2345: foo/);
});

test("buildTscFollowUpTurn: includes the preamble and tsc command", () => {
  const turn = buildTscFollowUpTurn("some error");
  assert.match(turn, /TypeScript errors were found/);
  assert.match(turn, /npx tsc --noEmit --pretty false/);
});

test("buildTscFollowUpTurn: wraps errors in a code fence", () => {
  const turn = buildTscFollowUpTurn("TS2304");
  // Must have opening and closing triple-backtick lines
  const lines = turn.split("\n");
  const fenceLines = lines.filter((l) => l.trim() === "```");
  assert.ok(fenceLines.length >= 2, "expected at least an opening and closing ``` fence");
});

// ── mirror batching logic ────────────────────────────────────────────────────
// The batching behaviour is: multiple scheduleMirror() calls within
// MIRROR_DEBOUNCE_MS collapse into a single flush. We test this using a fake
// in-memory version of the batching logic that mirrors the run.mjs pattern.

test("mirror batching: multiple writes within debounce window collapse into one flush", async () => {
  // Replicate the batching logic from run.mjs inline (no import needed — pure pattern).
  const MIRROR_DEBOUNCE_MS = 300;
  const flushed: Array<Record<string, string>> = [];
  let pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    if (pending.size === 0) return;
    flushed.push(Object.fromEntries(pending));
    pending = new Map();
  }

  function schedule(p: string, c: string) {
    pending.set(p, c);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, MIRROR_DEBOUNCE_MS);
  }

  schedule("app/a.tsx", "v1");
  schedule("app/b.tsx", "v2");
  schedule("app/a.tsx", "v3"); // overwrites first write to a.tsx

  // Flush immediately (simulates debounce expiry)
  if (timer) clearTimeout(timer);
  await flush();

  assert.equal(flushed.length, 1, "expected exactly one batched flush");
  assert.equal(flushed[0]!["app/a.tsx"], "v3", "last write to a.tsx must win");
  assert.equal(flushed[0]!["app/b.tsx"], "v2");
});

test("mirror batching: last write to same path wins within the window", async () => {
  const writes: string[] = [];
  const pending = new Map<string, string>();

  pending.set("app/x.tsx", "first");
  pending.set("app/x.tsx", "second");
  pending.set("app/x.tsx", "third");

  const batch = Object.fromEntries(pending);
  assert.equal(batch["app/x.tsx"], "third");
});

// ── heartbeat interval constant ──────────────────────────────────────────────
// The plan specifies a 15s heartbeat. Verify the constant in the committed
// run.mjs matches the expected value.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_FOR_TEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("run.mjs heartbeat interval is 15000ms", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /HEARTBEAT_INTERVAL_MS\s*=\s*15_000/);
});

test("run.mjs mirror debounce is 300ms", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /MIRROR_DEBOUNCE_MS\s*=\s*300/);
});

test("run.mjs has --self-test flag handler", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /--self-test/);
  assert.match(src, /runSelfTests/);
});

// ── run.mjs API shape assertions (SDK + bridge) ──────────────────────────────
// These verify the documented shapes are present in the committed artifact so
// a template rewrite can't silently regress to wrong API spellings.

test("run.mjs uses Convex /api/mutation endpoint (plan §1/G6 outbound-only bridge)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  // Must POST to /api/mutation, not /api/bridge/
  assert.match(src, /\/api\/mutation/);
  assert.ok(!src.includes("/api/bridge/"), "must not use the inbound /api/bridge/ route");
});

test("run.mjs passes JOB_TOKEN as an arg (not an Authorization header)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /jobToken.*JOB_TOKEN/);
  assert.ok(!src.includes("Authorization"), "JOB_TOKEN must be an arg, not a header");
});

test("run.mjs uses SDK permissionMode: \"dontAsk\" (camelCase per docs)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /permissionMode:\s*["']dontAsk["']/);
  // Must not use the old Messages-API casing
  assert.ok(!src.includes('"dont_ask"'), 'must not use "dont_ask" (underscore form)');
});

test("run.mjs allowedTools uses SDK tool names (not Messages-API type strings)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /allowedTools.*\[/s);
  // SDK names
  assert.match(src, /"Write"/);
  assert.match(src, /"Edit"/);
  assert.match(src, /"Bash"/);
  // Must not use Messages-API type strings
  assert.ok(!src.includes("text_editor_20250124"), "must not use Messages-API tool type string");
  assert.ok(!src.includes("bash_20250124"), "must not use Messages-API tool type string");
});

test("run.mjs hooks use preToolUse/postToolUse with match+handler shape (SDK docs)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /preToolUse/);
  assert.match(src, /postToolUse/);
  assert.match(src, /match:/);
  assert.match(src, /handler:/);
  assert.match(src, /toolName/);
});

test("run.mjs Write hook uses hook.input.path and hook.input.content (SDK field names)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /hook\.input\.path/);
  assert.match(src, /hook\.input\.content/);
  // Must not reference Messages-API field names
  assert.ok(!src.includes("new_str"), "must not use Messages-API field new_str");
});

test("run.mjs tsc verify runs locally (execSync), not via bridge", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /execSync/);
  assert.match(src, /tsc --noEmit/);
  // Must not call a bridge runTsc endpoint
  assert.ok(!src.includes('"runTsc"'), "tsc must run locally, not via bridge");
});

test("run.mjs iterates query result with for-await (AsyncGenerator pattern)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /for await.*of.*q\b/);
  // Must not use .result property (old non-generator pattern)
  assert.ok(!src.includes("result.result"), "must not use result.result — query returns AsyncGenerator");
});

test("run.mjs uses agentBridge: prefixed function paths", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /agentBridge:heartbeat/);
  assert.match(src, /agentBridge:mirrorFile/);
  assert.match(src, /agentBridge:complete/);
});
