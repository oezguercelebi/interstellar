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

// buildTscFollowUpTurn + buildHooks + normalizeMirrorPath — from template generator.
import { buildTscFollowUpTurn, buildHooks, normalizeMirrorPath } from "../scripts/lib/agentRunnerTemplate.mjs";

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

// ── normalizeMirrorPath ───────────────────────────────────────────────────────

const APP_CWD = "/home/daytona/expo-app";

test("normalizeMirrorPath: strips absolute cwd prefix → relative", () => {
  assert.equal(normalizeMirrorPath(`${APP_CWD}/app/index.tsx`, APP_CWD), "app/index.tsx");
});

test("normalizeMirrorPath: already-relative path passes through unchanged", () => {
  assert.equal(normalizeMirrorPath("app/index.tsx", APP_CWD), "app/index.tsx");
});

test("normalizeMirrorPath: strips leading ./", () => {
  assert.equal(normalizeMirrorPath("./app/index.tsx", APP_CWD), "app/index.tsx");
});

test("normalizeMirrorPath: /tmp path is outside cwd → null", () => {
  assert.equal(normalizeMirrorPath("/tmp/foo.txt", APP_CWD), null);
});

test("normalizeMirrorPath: exact cwd itself → null (not a file)", () => {
  assert.equal(normalizeMirrorPath(APP_CWD, APP_CWD), null);
});

test("normalizeMirrorPath: empty string → null", () => {
  assert.equal(normalizeMirrorPath("", APP_CWD), null);
});

test("normalizeMirrorPath: traversal path → null", () => {
  assert.equal(normalizeMirrorPath("../sibling/file.ts", APP_CWD), null);
  assert.equal(normalizeMirrorPath("..", APP_CWD), null);
});

test("normalizeMirrorPath: absolute path with different cwd → null", () => {
  assert.equal(normalizeMirrorPath("/home/daytona/agent-runner/run.mjs", APP_CWD), null);
});

// ── buildHooks — SDK 0.3.173 shape (sdk.d.ts:1486, 814-819, 821) ─────────────

function makeHooks() {
  const mirrored = new Map<string, string>();
  const hooks = buildHooks({
    appCwd: APP_CWD,
    scheduleMirrorFn: (p: string, c: string) => mirrored.set(p, c),
    isForbiddenPathFn: (p: string) => p === "package.json" || p === "tsconfig.json",
  });
  return { hooks, mirrored };
}

test("buildHooks: returns PascalCase HookEvent keys (sdk.d.ts:821)", () => {
  const { hooks } = makeHooks();
  assert.ok(Array.isArray(hooks.PreToolUse), "PreToolUse must be an array");
  assert.ok(Array.isArray(hooks.PostToolUse), "PostToolUse must be an array");
  // Old wrong camelCase keys must be absent
  assert.ok(!(hooks as Record<string, unknown>)["preToolUse"], "preToolUse (camelCase) must not exist");
  assert.ok(!(hooks as Record<string, unknown>)["postToolUse"], "postToolUse (camelCase) must not exist");
});

test("buildHooks: each matcher has .hooks array, no .handler or .match (sdk.d.ts:814-819)", () => {
  const { hooks } = makeHooks();
  for (const m of [...hooks.PreToolUse, ...hooks.PostToolUse]) {
    assert.ok(Array.isArray(m.hooks), "HookCallbackMatcher.hooks must be an array");
    assert.ok(!(m as Record<string, unknown>)["handler"], ".handler must not exist on matcher");
    assert.ok(!(m as Record<string, unknown>)["match"], ".match must not exist on matcher");
  }
});

test("buildHooks: PreToolUse Write matcher has matcher='Write'", () => {
  const { hooks } = makeHooks();
  const writeMatchers = hooks.PreToolUse.filter((m) => m.matcher === "Write");
  assert.equal(writeMatchers.length, 1, "one Write matcher in PreToolUse");
});

test("buildHooks: PreToolUse Write hook denies forbidden path with hookSpecificOutput (sdk.d.ts:6218,2212)", async () => {
  const { hooks } = makeHooks();
  const writeMatcher = hooks.PreToolUse.find((m) => m.matcher === "Write")!;
  const result = await writeMatcher.hooks[0](
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { path: "package.json" }, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.equal(result?.hookSpecificOutput?.permissionDecision, "deny");
  assert.equal(result?.hookSpecificOutput?.hookEventName, "PreToolUse");
});

test("buildHooks: PreToolUse Write hook returns undefined for allowed path", async () => {
  const { hooks } = makeHooks();
  const writeMatcher = hooks.PreToolUse.find((m) => m.matcher === "Write")!;
  const result = await writeMatcher.hooks[0](
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { path: "app/index.tsx" }, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.equal(result, undefined, "allowed path must return undefined");
});

test("buildHooks: PreToolUse Write hook denies forbidden absolute path (normalizes first)", async () => {
  const { hooks } = makeHooks();
  const writeMatcher = hooks.PreToolUse.find((m) => m.matcher === "Write")!;
  const result = await writeMatcher.hooks[0](
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { path: `${APP_CWD}/package.json` }, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.equal(result?.hookSpecificOutput?.permissionDecision, "deny", "absolute forbidden path must deny");
});

test("buildHooks: PreToolUse Write hook allows absolute path inside cwd", async () => {
  const { hooks } = makeHooks();
  const writeMatcher = hooks.PreToolUse.find((m) => m.matcher === "Write")!;
  const result = await writeMatcher.hooks[0](
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { path: `${APP_CWD}/app/index.tsx` }, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.equal(result, undefined, "absolute allowed path must return undefined");
});

test("buildHooks: PostToolUse Write hook mirrors absolute path as relative", async () => {
  const { hooks, mirrored } = makeHooks();
  const writeMatcher = hooks.PostToolUse.find((m) => m.matcher === "Write")!;
  await writeMatcher.hooks[0](
    { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { path: `${APP_CWD}/app/foo.tsx`, content: "hello" }, tool_response: {}, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.equal(mirrored.get("app/foo.tsx"), "hello", "absolute path must be stored as relative");
  assert.ok(!mirrored.has(`${APP_CWD}/app/foo.tsx`), "absolute key must not be stored");
});

test("buildHooks: PostToolUse Write hook schedules mirror for allowed relative file", async () => {
  const { hooks, mirrored } = makeHooks();
  const writeMatcher = hooks.PostToolUse.find((m) => m.matcher === "Write")!;
  await writeMatcher.hooks[0](
    { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { path: "app/bar.tsx", content: "world" }, tool_response: {}, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.equal(mirrored.get("app/bar.tsx"), "world");
});

test("buildHooks: PostToolUse Write hook does NOT mirror forbidden path", async () => {
  const { hooks, mirrored } = makeHooks();
  const writeMatcher = hooks.PostToolUse.find((m) => m.matcher === "Write")!;
  await writeMatcher.hooks[0](
    { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { path: "package.json", content: "{}" }, tool_response: {}, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.ok(!mirrored.has("package.json"), "forbidden path must not be mirrored");
});

test("buildHooks: PostToolUse Write hook does NOT mirror /tmp paths (outside cwd)", async () => {
  const { hooks, mirrored } = makeHooks();
  const writeMatcher = hooks.PostToolUse.find((m) => m.matcher === "Write")!;
  await writeMatcher.hooks[0](
    { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { path: "/tmp/leak.txt", content: "x" }, tool_response: {}, tool_use_id: "x", session_id: "s", transcript_path: "/t", cwd: "/c" } as any,
  );
  assert.ok(!mirrored.has("/tmp/leak.txt") && !mirrored.has("leak.txt"), "/tmp path must not be mirrored");
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

// SDK 0.3.173 hook shape (sdk.d.ts line 1486, 814-819, 821, 2203-2215):
//   hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
//   HookEvent keys are PascalCase: 'PreToolUse', 'PostToolUse'
//   HookCallbackMatcher: { matcher?: string; hooks: HookCallback[] }
//   HookCallback: (input, toolUseID, { signal }) => Promise<HookJSONOutput>
//   Input fields: snake_case tool_name, tool_input (object)
//   Deny: SyncHookJSONOutput.hookSpecificOutput.permissionDecision = 'deny'
test("run.mjs hooks use PascalCase HookEvent keys (SDK 0.3.173 sdk.d.ts:821)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  // PascalCase event names required by HookEvent type
  assert.match(src, /PreToolUse/);
  assert.match(src, /PostToolUse/);
  // HookCallbackMatcher shape: { matcher?, hooks: [] } — NOT { match, handler }
  assert.match(src, /matcher:/);
  assert.match(src, /hooks:\s*\[/);
  assert.ok(!src.match(/\bmatch\s*:\s*\{\s*toolName/), "must not use old .match.toolName shape");
  assert.ok(!src.match(/\bhandler\s*:/), "must not use old .handler shape");
});

test("run.mjs Write hook reads snake_case tool_input.path from HookInput (SDK 0.3.173 sdk.d.ts:2205-2206)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  // tool_input is the input object (snake_case per PreToolUseHookInput)
  assert.match(src, /tool_input/);
  // Must not reference old made-up hook.input.path shape
  assert.ok(!src.includes("hook.input.path"), "must not use old hook.input.path shape");
  assert.ok(!src.includes("new_str"), "must not use Messages-API field new_str");
});

test("run.mjs PreToolUse deny uses hookSpecificOutput.permissionDecision (SDK 0.3.173 sdk.d.ts:6218, 2212)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /hookSpecificOutput/);
  assert.match(src, /permissionDecision.*deny/);
  assert.match(src, /hookEventName.*PreToolUse/);
  // Must not use old made-up shape
  assert.ok(!src.includes('"behavior"'), 'must not use old { behavior: "deny" } shape');
  assert.ok(!src.match(/behavior\s*:\s*["']deny/), 'must not use old behavior:deny shape');
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

test("run.mjs uses normalizeMirrorPath before scheduling mirrors", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /normalizeMirrorPath/);
  // Hooks must use relPath not rawPath for scheduling
  assert.match(src, /scheduleMirrorFn\(relPath/);
  assert.ok(!src.includes("scheduleMirrorFn(filePath"), "must not use old filePath variable name");
});

test("run.mjs passes systemPrompt preset to query() (sdk.d.ts:1126)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /systemPrompt/);
  assert.match(src, /type.*preset/);
  assert.match(src, /preset.*claude_code/);
  // Must include the inlined stable prefix for at least one kit
  assert.match(src, /Import allowlist|HARD CONSTRAINTS/);
  assert.ok(!src.includes("costUsd: 0,"), "costUsd must not be hardcoded to 0");
});

test("run.mjs captures SDKResultMessage total_cost_usd and usage for real cost telemetry", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /total_cost_usd/);
  assert.match(src, /input_tokens/);
  assert.match(src, /output_tokens/);
  assert.match(src, /cache_read_input_tokens/);
  assert.match(src, /cache_creation_input_tokens/);
  // Must accumulate across queries
  assert.match(src, /accumulateResult/);
});

// ── Sweeper predicate — legacy rows must not be swept ────────────────────────
// sweepStaleRuns guards with `v.runner !== "agent"` to avoid killing legacy
// in-Convex runs (they have no heartbeat so agentHeartbeatAt ?? 0 is always
// "stale"). These pure tests assert the predicate logic.

/** Simulates the sweeper eligibility check from agentBridge.sweepStaleRuns. */
function isSweeperCandidate(row: { runner?: string; agentHeartbeatAt?: number }, staleThreshold: number): boolean {
  if (row.runner !== "agent") return false; // legacy guard
  const heartbeatAt = row.agentHeartbeatAt ?? 0;
  return heartbeatAt < staleThreshold;
}

test("sweeper: legacy row (no runner field) is never a candidate regardless of heartbeat age", () => {
  const staleThreshold = Date.now() - 5 * 60 * 1000;
  // Legacy row: no runner, no heartbeat — would be killed without the guard
  assert.ok(!isSweeperCandidate({ runner: undefined, agentHeartbeatAt: undefined }, staleThreshold));
  // Legacy row with explicit non-agent runner
  assert.ok(!isSweeperCandidate({ runner: "convex", agentHeartbeatAt: undefined }, staleThreshold));
});

test("sweeper: agent row with stale heartbeat IS a candidate", () => {
  const staleThreshold = Date.now() - 5 * 60 * 1000;
  const staleHeartbeat = Date.now() - 10 * 60 * 1000; // 10 min ago
  assert.ok(isSweeperCandidate({ runner: "agent", agentHeartbeatAt: staleHeartbeat }, staleThreshold));
});

test("sweeper: agent row with missing heartbeat IS a candidate (agentHeartbeatAt ?? 0)", () => {
  const staleThreshold = Date.now() - 5 * 60 * 1000;
  assert.ok(isSweeperCandidate({ runner: "agent", agentHeartbeatAt: undefined }, staleThreshold));
});

test("sweeper: agent row with fresh heartbeat is NOT a candidate", () => {
  const staleThreshold = Date.now() - 5 * 60 * 1000;
  const freshHeartbeat = Date.now() - 30 * 1000; // 30s ago
  assert.ok(!isSweeperCandidate({ runner: "agent", agentHeartbeatAt: freshHeartbeat }, staleThreshold));
});

// ── Metro / bundle probe assertions ──────────────────────────────────────────

test("run.mjs has bundle probe URL (index.bundle?platform=web)", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /index\.bundle\?platform=web/);
  assert.match(src, /METRO_POLL_MAX_MS/);
  assert.match(src, /bundleProbeOk/);
});

test("run.mjs spawns Metro detached before bridge.complete", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  assert.match(src, /detached:\s*true/);
  assert.match(src, /metro\.unref\(\)/);
  assert.match(src, /metroStarted/);
});

test("run.mjs sets ok=false when bundle probe times out", () => {
  const src = fs.readFileSync(
    path.join(ROOT_FOR_TEST, "scripts/agent-runner/run.mjs"),
    "utf8",
  );
  // ok must be computed from both finalErrors AND bundleProbeOk
  assert.match(src, /!finalErrors && bundleProbeOk/);
});
