#!/usr/bin/env node
/**
 * Template generator for scripts/agent-runner/run.mjs.
 *
 * Reads the TypeScript source files from convex/lib/agentRunner/, strips
 * types (best-effort regex), and assembles run.mjs with inlined pure logic.
 *
 * Usage:
 *   node scripts/lib/agentRunnerTemplate.mjs > scripts/agent-runner/run.mjs
 *
 * The committed run.mjs must match this output exactly (enforced by
 * tests/runnerMirror.test.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Strip TypeScript-specific syntax from a .ts source string.
 * Best-effort line-by-line approach: sufficient for the pure-logic files in agentRunner/.
 */
function stripTypes(src) {
  const lines = src.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip type-only import lines
    if (trimmed.startsWith("import type ")) { i++; continue; }

    // Skip `export type X = ...` — may be multi-line (continuation lines start with |)
    if (trimmed.startsWith("export type ") || (trimmed.startsWith("type ") && /^type\s+\w+/.test(trimmed))) {
      i++;
      // Skip continuation lines (union members starting with |, or lines ending with |)
      while (i < lines.length) {
        const next = lines[i].trim();
        if (next.startsWith("|") || next.endsWith("|") || next === "") {
          // empty continuation
          if (next === "") break;
          i++;
        } else {
          break;
        }
      }
      continue;
    }

    // Skip interface declarations (multi-line)
    if (/^(?:export\s+)?interface\s+\w+/.test(trimmed)) {
      i++;
      let depth = 0;
      // Scan until closing brace
      for (let j = i - 1; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        if (depth === 0) { i = j + 1; break; }
      }
      continue;
    }

    // Skip `export { FORBIDDEN_PATHS };` re-export lines (type-only re-exports handled, value re-exports kept)
    // Actually keep export { ... } lines — they're value exports too

    let l = line;

    // Remove "as const"
    l = l.replace(/\s+as\s+const\b/g, "");

    // Remove TypeScript type predicate: `(x): x is Type =>` → `(x) =>`
    l = l.replace(/(\(\w+\))\s*:\s*\w+\s+is\s+\w+/g, "$1");

    // Remove return type on functions: `): ReturnType {` or `): Promise<X> {` or `): string[] {`
    l = l.replace(/\)\s*:\s*Promise<[^>]*>\s*(\{?)$/, ") $1");
    l = l.replace(/\)\s*:\s*\w+(?:<[^>]*>)?(?:\[\])?\s*(\{?)$/, ") $1");

    // Remove `: Type` on const/let/var declarations (with or without =)
    l = l.replace(/^(\s*(?:export\s+)?(?:const|let|var)\s+\w+)\s*:\s*(?:\{[^}]*\}|\w+(?:<[^>]*>)?(?:\[\])?)\s*(=|;)/, "$1 $2");

    // Remove type annotations on function parameters — `: TypeName` or `: TypeName<...>` after param name.
    // Only strip when the annotation looks like a TS type (PascalCase or known lowercase keywords),
    // not JS values like `true`, `false`, numbers, strings, or object properties.
    // Only applies when inside function parens: line contains `function` or `=>` context.
    if (/\bfunction\b|\bexport\s+async\b/.test(l)) {
      const typeAtom = "(?:[A-Z]\\w*|string|number|boolean|unknown|void|undefined|null|never|CryptoKey|Uint8Array|ArrayBuffer)(?:<[^>]*>)?(?:\\[\\])?";
      // `name: T` or `name: T | U | ...` (union) up to a param boundary `, ) =`.
      l = l.replace(
        new RegExp(`(\\w+)\\s*:\\s*${typeAtom}(?:\\s*\\|\\s*${typeAtom})*(?=\\s*[,)=])`, "g"),
        "$1",
      );
    }

    // Remove generic type params from async function declarations
    l = l.replace(/(async\s+function\s+\w+)<[^>]*>/g, "$1");
    l = l.replace(/(function\s+\w+)<[^>]*>/g, "$1");

    // Strip a type annotation on a parameter sitting alone on its own line
    // inside a multi-line signature, e.g. `  payload: TokenPayload,` or
    // `  secret: string,`. The type must look like a TS type (PascalCase or a
    // known lowercase keyword) — NEVER a JS literal like `true`/`null`/a number
    // (those are object-property values, not annotations). Trailing punctuation
    // (`,`, `)`, `) {`) is preserved. Union types (`A | B`) are handled.
    {
      const ownLineAtom =
        "(?:[A-Z]\\w*|string|number|boolean|unknown|void|undefined|null|never|CryptoKey|Uint8Array|ArrayBuffer)(?:<[^>]*>)?(?:\\[\\])?";
      l = l.replace(
        new RegExp(
          `^(\\s*\\w+)\\s*:\\s*${ownLineAtom}(?:\\s*\\|\\s*${ownLineAtom})*(\\s*(?:,|\\)\\s*\\{?)?)$`,
        ),
        "$1$2",
      );
    }

    // Remove `as [Type, Type]` tuple casts
    l = l.replace(/\s+as\s+\[[^\]]*\]/g, "");
    // Remove `as Record<...>` and `as Type<...>` and `as Word` casts
    l = l.replace(/\s+as\s+\w+(?:<[^>]*>)?(?:\[\])?/g, "");

    out.push(l);
    i++;
  }

  return out.join("\n");
}

/**
 * Read and strip-type a single agentRunner .ts file.
 * Removes the opening doc comment and import/export-from lines.
 */
function inlineModule(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const stripped = stripTypes(src);

  // Remove import lines (they will be inlined together)
  const noImports = stripped
    .split("\n")
    .filter((line) => !line.match(/^import\s/))
    .join("\n");

  // Remove the leading doc comment block if present
  const noDocComment = noImports.replace(/^\/\*\*[\s\S]*?\*\/\n?/, "");

  return noDocComment.trim();
}

/**
 * Build the SDK-correct hooks config for the agent query.
 * Exported so tests/agentRunner.test.ts can exercise it without needing run.mjs.
 *
 * SDK 0.3.173 shape (sdk.d.ts lines 814-819, 821, 1486, 2203-2215, 6205-6219):
 *   hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
 *   HookCallbackMatcher: { matcher?: string; hooks: HookCallback[]; timeout?: number }
 *   HookCallback: (input, toolUseID, { signal }) => Promise<HookJSONOutput>
 *   HookInput fields are snake_case: tool_name, tool_input (object), tool_use_id
 *   Deny via SyncHookJSONOutput: { hookSpecificOutput: { hookEventName:'PreToolUse',
 *                                   permissionDecision:'deny', permissionDecisionReason } }
 */
export function buildHooks({ appCwd, scheduleMirrorFn, isForbiddenPathFn }) {
  return {
    PreToolUse: [
      {
        matcher: "Write",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            if (isForbiddenPathFn(filePath)) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: `Refusing to write forbidden path: ${filePath}`,
                },
              };
            }
          },
        ],
      },
      {
        matcher: "Edit",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            if (isForbiddenPathFn(filePath)) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: `Refusing to edit forbidden path: ${filePath}`,
                },
              };
            }
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Write",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            const contents = toolInput.content ?? toolInput.file_text ?? "";
            if (filePath && !isForbiddenPathFn(filePath)) {
              scheduleMirrorFn(filePath, contents);
            }
          },
        ],
      },
      {
        matcher: "Edit",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            if (filePath && !isForbiddenPathFn(filePath)) {
              try {
                const { readFileSync } = await import("node:fs");
                const contents = readFileSync(`${appCwd}/${filePath}`, "utf8");
                scheduleMirrorFn(filePath, contents);
              } catch {
                // Best-effort.
              }
            }
          },
        ],
      },
    ],
  };
}

/**
 * Pure helper: build the tsc error follow-up user turn message.
 * Exported so tests/agentRunner.test.ts can exercise it.
 */
export function buildTscFollowUpTurn(errorBlock) {
  return [
    "TypeScript errors were found after your changes. Please fix them.",
    "",
    "```",
    errorBlock,
    "```",
    "",
    "Run `npx tsc --noEmit --pretty false` after your edits to verify they are resolved.",
  ].join("\n");
}

/**
 * Generate the full run.mjs content.
 * @param {string} root - Absolute path to the repo root
 * @returns {string} The generated file content
 */
export function generate(root) {
  const forbiddenSrc = inlineModule("convex/lib/agentRunner/forbidden.ts");
  const overlaySrc = inlineModule("convex/lib/agentRunner/overlay.ts");
  const decisionSrc = inlineModule("convex/lib/agentRunner/decision.ts");
  const reportSrc = inlineModule("convex/lib/agentRunner/report.ts");
  const tokenSrc = inlineModule("convex/lib/agentRunner/token.ts");

  return `#!/usr/bin/env node
/**
 * Agent runner — self-contained Node ESM script.
 *
 * DO NOT EDIT THIS FILE DIRECTLY.
 * Generated from scripts/lib/agentRunnerTemplate.mjs — run:
 *   node scripts/lib/agentRunnerTemplate.mjs > scripts/agent-runner/run.mjs
 *
 * Env contract (all required unless noted):
 *   ANTHROPIC_API_KEY   — Anthropic key (scoped, spend-capped)
 *   CONVEX_URL          — Convex deployment URL
 *   JOB_TOKEN           — HMAC-signed job token (passed as arg to every bridge call)
 *   versionId           — Convex version doc id
 *   threadId            — Convex thread id
 *   promptMessageId     — Convex message id for the initial prompt
 *   model               — Claude model slug
 *   effort              — "low" | "medium" | "high"
 *   kit                 — starter kit name
 *   isEdit              — "true" | "false"
 *   styleDirective      — (optional) extra style instruction
 *
 * Bridge: outbound-only Convex mutations via plain HTTP
 *   POST {CONVEX_URL}/api/mutation  { path: "agentBridge:X", args: { jobToken, ...} }
 *   JOB_TOKEN is an HMAC arg on every call — no custom request headers.
 *
 * Agent SDK 0.3.173 API (sdk.d.ts verified from box):
 *   query({ prompt, options? }) → Query (AsyncIterable<SDKMessage>)
 *   options.permissionMode: PermissionMode — 'dontAsk' (camelCase)
 *   options.allowedTools: string[]
 *   options.hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
 *     HookEvent = 'PreToolUse' | 'PostToolUse' | ... (PascalCase)
 *     HookCallbackMatcher = { matcher?: string; hooks: HookCallback[]; timeout?: number }
 *     HookCallback = (input: HookInput, toolUseID, { signal }) => Promise<HookJSONOutput>
 *   Hook input fields are snake_case: tool_name, tool_input (object), tool_use_id
 *   PreToolUse deny: { hookSpecificOutput: { hookEventName:'PreToolUse',
 *                       permissionDecision:'deny', permissionDecisionReason:'...' } }
 *   Multi-turn: new query() call per tsc repair cycle
 *
 * Flags:
 *   --self-test         — run pure-logic self-tests and exit 0 (no network)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// INLINED PURE LOGIC (generated from convex/lib/agentRunner/*.ts)
// ═══════════════════════════════════════════════════════════════════════════════

// ── forbidden.ts ──────────────────────────────────────────────────────────────
${forbiddenSrc}

// ── overlay.ts ────────────────────────────────────────────────────────────────
${overlaySrc}

// ── decision.ts ───────────────────────────────────────────────────────────────
${decisionSrc}

// ── report.ts ─────────────────────────────────────────────────────────────────
${reportSrc}

// ── token.ts ──────────────────────────────────────────────────────────────────
${tokenSrc}

// ── tsc follow-up turn builder ────────────────────────────────────────────────
function buildTscFollowUpTurn(errorBlock) {
  return [
    "TypeScript errors were found after your changes. Please fix them.",
    "",
    "\`\`\`",
    errorBlock,
    "\`\`\`",
    "",
    "Run \`npx tsc --noEmit --pretty false\` after your edits to verify they are resolved.",
  ].join("\\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELF-TEST (--self-test flag — no network, no SDK)
// ═══════════════════════════════════════════════════════════════════════════════

async function runSelfTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      console.error(\`FAIL: \${label}\`);
      failed++;
    }
  }

  // forbidden
  assert(FORBIDDEN_PATHS.has("package.json"), "FORBIDDEN_PATHS has package.json");
  assert(isForbiddenPath("./tsconfig.json"), "isForbiddenPath strips ./");
  assert(!isForbiddenPath("app/index.tsx"), "isForbiddenPath allows app files");

  // overlay
  assert(looksLikeMetroOverlay("Unable to resolve module foo"), "overlay: Unable to resolve");
  assert(looksLikeMetroOverlay("Bundling failed"), "overlay: Bundling failed");
  assert(!looksLikeMetroOverlay("<html><body>Hello</body></html>"), "overlay: healthy html");

  // decision
  assert(
    decide({ jobStatus: "complete", heartbeatAgeMs: 0, attempt: 0, sandboxState: "running", tscCycle: 0, isEdit: false, budgetExhausted: false, turnLimitReached: false, notFoundCount: 0 }) === "complete",
    "decide: complete",
  );
  assert(
    decide({ jobStatus: "running", heartbeatAgeMs: 0, attempt: 0, sandboxState: "running", tscCycle: 0, isEdit: false, budgetExhausted: false, turnLimitReached: false, notFoundCount: 0 }) === "continue",
    "decide: continue",
  );
  assert(
    decide({ jobStatus: "failed", heartbeatAgeMs: 0, attempt: 0, sandboxState: "running", tscCycle: 0, isEdit: true, budgetExhausted: false, turnLimitReached: false, notFoundCount: 0 }) === "retry-git-reset",
    "decide: retry-git-reset for isEdit",
  );

  // report
  const r = parseRunnerReport({ ok: true, summary: "ok", entryScreens: [], costUsd: 1, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  assert(r.valid === true, "parseRunnerReport: valid payload");
  const bad = parseRunnerReport(null);
  assert(bad.valid === false, "parseRunnerReport: null is invalid");

  // tsc follow-up
  const turn = buildTscFollowUpTurn("error TS2345: foo");
  assert(turn.includes("error TS2345: foo"), "buildTscFollowUpTurn: includes error");
  assert(turn.includes("TypeScript errors"), "buildTscFollowUpTurn: includes preamble");

  // hooks shape (SDK 0.3.173 verified)
  const mirrored = new Map();
  const hooks = buildHooks({
    appCwd: "/fake",
    scheduleMirrorFn: (p, c) => mirrored.set(p, c),
    isForbiddenPathFn: isForbiddenPath,
  });
  assert(Array.isArray(hooks.PreToolUse), "hooks.PreToolUse is an array (PascalCase key)");
  assert(Array.isArray(hooks.PostToolUse), "hooks.PostToolUse is an array (PascalCase key)");
  assert(!hooks.preToolUse, "hooks must NOT have camelCase preToolUse key");
  assert(!hooks.postToolUse, "hooks must NOT have camelCase postToolUse key");
  // Each matcher must have 'hooks' array (not 'handler')
  for (const m of [...hooks.PreToolUse, ...hooks.PostToolUse]) {
    assert(Array.isArray(m.hooks), "HookCallbackMatcher must have .hooks array");
    assert(!m.handler, "HookCallbackMatcher must NOT have .handler (old wrong shape)");
    assert(!m.match, "HookCallbackMatcher must NOT have .match (old wrong shape)");
  }
  // PreToolUse deny for forbidden path must return hookSpecificOutput with permissionDecision:'deny'
  const writeMatchers = hooks.PreToolUse.filter((m) => m.matcher === "Write");
  assert(writeMatchers.length === 1, "PreToolUse has Write matcher");
  const denyResult = await writeMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "package.json" } });
  assert(denyResult?.hookSpecificOutput?.permissionDecision === "deny", "Write forbidden path returns deny");
  assert(denyResult?.hookSpecificOutput?.hookEventName === "PreToolUse", "deny hookEventName is PreToolUse");
  // PreToolUse allow for allowed path must return undefined
  const allowResult = await writeMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "app/index.tsx" } });
  assert(allowResult === undefined, "allowed path returns undefined from PreToolUse hook");
  // PostToolUse Write schedules mirror
  const postWriteMatchers = hooks.PostToolUse.filter((m) => m.matcher === "Write");
  assert(postWriteMatchers.length === 1, "PostToolUse has Write matcher");
  await postWriteMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "app/foo.tsx", content: "hello" } });
  assert(mirrored.get("app/foo.tsx") === "hello", "PostToolUse Write schedules mirror");
  // PostToolUse Write does NOT mirror forbidden paths
  await postWriteMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "package.json", content: "{}" } });
  assert(!mirrored.has("package.json"), "PostToolUse Write does NOT mirror forbidden path");

  console.log(\`Self-test: \${passed} passed, \${failed} failed\`);
  if (failed > 0) process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

if (process.argv.includes("--self-test")) {
  await runSelfTests();
  process.exit(0);
}

const {
  ANTHROPIC_API_KEY,
  CONVEX_URL,
  JOB_TOKEN,
  versionId,
  threadId,
  promptMessageId,
  model,
  effort,
  kit,
  isEdit: isEditEnv,
  styleDirective,
} = process.env;

// ── Bridge: outbound-only Convex mutations via plain HTTP ─────────────────────
// Plan §1/G6: poll-only, no inbound HTTP surface, no custom auth header.
// JOB_TOKEN is passed as an HMAC arg so convex/agentBridge.ts can verify it.
// Endpoint: POST {CONVEX_URL}/api/mutation  { path, args }

async function bridgeMutation(fnPath, args) {
  const res = await fetch(\`\${CONVEX_URL}/api/mutation\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: fnPath,
      args: { jobToken: JOB_TOKEN, ...args },
      format: "json",
    }),
  });
  if (!res.ok) {
    throw new Error(\`bridge \${fnPath} returned HTTP \${res.status}\`);
  }
  const body = await res.json();
  if (body.status === "error") {
    throw new Error(\`bridge \${fnPath} error: \${body.errorMessage}\`);
  }
  return body.value ?? null;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000;
let heartbeatTimer = null;

function startHeartbeat() {
  heartbeatTimer = setInterval(async () => {
    try {
      await bridgeMutation("agentBridge:heartbeat", { versionId });
    } catch (err) {
      console.warn("[runner] heartbeat failed:", err.message);
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ── File mirror batching (300ms debounce) ─────────────────────────────────────
// PostToolUse Write/Edit hooks accumulate writes; a 300ms debounce batches
// them into a single bridge.mirrorFile call per burst.

const MIRROR_DEBOUNCE_MS = 300;
let mirrorPending = new Map(); // path → contents
let mirrorTimer = null;

async function flushMirror() {
  if (mirrorPending.size === 0) return;
  const batch = Object.fromEntries(mirrorPending);
  mirrorPending = new Map();
  try {
    await bridgeMutation("agentBridge:mirrorFile", { versionId, files: batch });
  } catch (err) {
    console.warn("[runner] mirrorFile failed:", err.message);
  }
}

function scheduleMirror(filePath, contents) {
  mirrorPending.set(filePath, contents);
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(flushMirror, MIRROR_DEBOUNCE_MS);
}

// ── Chat delta streaming ───────────────────────────────────────────────────────
// Word-chunk throttle: accumulate text from assistant message events and
// flush to appendChatDelta once per word boundary or on explicit flush.

let deltaBuffer = "";
let deltaTimer = null;
const DELTA_FLUSH_MS = 80; // ~80ms chunk cadence

function scheduleDelta(text) {
  deltaBuffer += text;
  if (deltaTimer) return;
  deltaTimer = setTimeout(async () => {
    deltaTimer = null;
    if (!deltaBuffer) return;
    const chunk = deltaBuffer;
    deltaBuffer = "";
    try {
      await bridgeMutation("agentBridge:appendChatDelta", { versionId, threadId, chunk });
    } catch (err) {
      console.warn("[runner] appendChatDelta failed:", err.message);
    }
  }, DELTA_FLUSH_MS);
}

async function flushDelta() {
  if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
  if (!deltaBuffer) return;
  const chunk = deltaBuffer;
  deltaBuffer = "";
  try {
    await bridgeMutation("agentBridge:appendChatDelta", { versionId, threadId, chunk });
  } catch (err) {
    console.warn("[runner] appendChatDelta flush failed:", err.message);
  }
}

// ── tsc verify (runs locally inside the sandbox box) ─────────────────────────
// tsc is invoked with execSync — it's a local process, no bridge round-trip.

import { execSync } from "node:child_process";

function runTscLocally(cwd) {
  try {
    execSync("npx tsc --noEmit --pretty false", { cwd, stdio: "pipe", timeout: 60_000 });
    return { hasErrors: false, output: "" };
  } catch (err) {
    const output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    return { hasErrors: true, output: output.trim() };
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────
// Agent SDK 0.3.173 API (verified from box's sdk.d.ts):
//   query({ prompt, options? }) → Query (AsyncIterable<SDKMessage>)
//   options.permissionMode: PermissionMode — 'dontAsk' (camelCase)
//   options.allowedTools: string[]
//   options.hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
//     HookEvent = 'PreToolUse' | 'PostToolUse' | ... (PascalCase)
//     HookCallbackMatcher = { matcher?: string; hooks: HookCallback[]; timeout?: number }
//     HookCallback = (input: HookInput, toolUseID, { signal }) => Promise<HookJSONOutput>
//   HookInput fields (snake_case):
//     PreToolUseHookInput:  { hook_event_name, tool_name, tool_input, tool_use_id, ... }
//     PostToolUseHookInput: { hook_event_name, tool_name, tool_input, tool_response, ... }
//   PreToolUse deny return (SyncHookJSONOutput):
//     { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
//                             permissionDecisionReason: '...' } }
//   matcher?: string — matched against tool_name; omit to match all tools

const APP_CWD = "/home/daytona/expo-app";
const MAX_TSC_CYCLES = 4;

/**
 * Build the SDK-correct hooks config for the agent query.
 *
 * SDK 0.3.173 shape (sdk.d.ts lines 814-819, 2203-2215, 6205-6219):
 *   hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
 *   HookCallbackMatcher: { matcher?: string; hooks: HookCallback[]; timeout?: number }
 *   HookCallback: (input, toolUseID, { signal }) => Promise<HookJSONOutput>
 *   Deny via SyncHookJSONOutput.hookSpecificOutput.permissionDecision = 'deny'
 *
 * Exported for pure unit tests — no SDK import required to test the logic.
 */
export function buildHooks(opts) {
  const { appCwd, scheduleMirrorFn, isForbiddenPathFn } = opts;

  return {
    // sdk.d.ts line 821: HookEvent 'PreToolUse' (PascalCase)
    PreToolUse: [
      {
        // matcher matches tool_name. Match Write and Edit to block forbidden paths.
        matcher: "Write",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            if (isForbiddenPathFn(filePath)) {
              console.log(\`[runner] PreToolUse Write blocked forbidden: \${filePath}\`);
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: \`Refusing to write forbidden path: \${filePath}\`,
                },
              };
            }
          },
        ],
      },
      {
        matcher: "Edit",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            if (isForbiddenPathFn(filePath)) {
              console.log(\`[runner] PreToolUse Edit blocked forbidden: \${filePath}\`);
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: \`Refusing to edit forbidden path: \${filePath}\`,
                },
              };
            }
          },
        ],
      },
    ],
    // sdk.d.ts line 821: HookEvent 'PostToolUse' (PascalCase)
    PostToolUse: [
      {
        matcher: "Write",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            const contents = toolInput.content ?? toolInput.file_text ?? "";
            if (filePath && !isForbiddenPathFn(filePath)) {
              console.log(\`[runner] PostToolUse Write mirror: \${filePath}\`);
              scheduleMirrorFn(filePath, contents);
            }
          },
        ],
      },
      {
        matcher: "Edit",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const filePath = toolInput.path ?? toolInput.file_path ?? "";
            if (filePath && !isForbiddenPathFn(filePath)) {
              // After an Edit the file was modified — read it back for mirroring.
              try {
                const { readFileSync } = await import("node:fs");
                const contents = readFileSync(\`\${appCwd}/\${filePath}\`, "utf8");
                console.log(\`[runner] PostToolUse Edit mirror: \${filePath}\`);
                scheduleMirrorFn(filePath, contents);
              } catch {
                // Best-effort; mirror will be stale but not fatal.
                console.warn(\`[runner] PostToolUse Edit readback failed: \${filePath}\`);
              }
            }
          },
        ],
      },
    ],
  };
}

async function run() {
  console.log("[runner] starting, versionId=" + versionId);
  startHeartbeat();

  try {
    // Dynamic import — SDK is installed in the nw2 snapshot, not in this repo.
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    console.log("[runner] SDK imported");

    // The initial prompt arrives via env: promptMessageId identifies the
    // message in the Convex thread. The actual text is baked into that message;
    // the bridge fetches it and returns it as the prompt string.
    console.log("[runner] bridge:getPromptText");
    const promptText = await bridgeMutation("agentBridge:getPromptText", {
      versionId,
      promptMessageId,
    });
    console.log("[runner] prompt fetched, length=" + (promptText?.length ?? 0));

    let tscCycle = 0;

    // Build the hooks config using the real SDK 0.3.173 shape.
    // hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
    // (sdk.d.ts line 1486)
    const hooks = buildHooks({
      appCwd: APP_CWD,
      scheduleMirrorFn: scheduleMirror,
      isForbiddenPathFn: isForbiddenPath,
    });

    // Launch the query. The SDK returns an AsyncGenerator; we iterate it to
    // consume assistant messages and tool events, streaming text deltas to
    // Convex via appendChatDelta.
    console.log("[runner] launching query");
    const q = query({
      prompt: promptText,
      options: {
        model: model || "claude-opus-4-8",
        permissionMode: "dontAsk",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        maxTurns: 40,
        cwd: APP_CWD,
        hooks,
      },
    });

    let msgCount = 0;
    for await (const message of q) {
      msgCount++;
      console.log(\`[runner] msg[\${msgCount}] type=\${message.type}\`);
      // Stream assistant text deltas to Convex.
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text) {
            scheduleDelta(block.text);
          }
        }
      }
    }
    console.log(\`[runner] query complete, \${msgCount} messages\`);

    await flushDelta();
    await flushMirror();

    // tsc verify loop — runs locally in the sandbox, feeds errors back as a
    // new query() per cycle (the previous query has completed; multi-turn via
    // new query calls is the correct pattern).
    while (tscCycle < MAX_TSC_CYCLES) {
      const { hasErrors, output } = runTscLocally(APP_CWD);
      if (!hasErrors) break;

      tscCycle++;
      console.log(\`[runner] tsc cycle \${tscCycle}: errors found, feeding back\`);

      const fixQ = query({
        prompt: buildTscFollowUpTurn(output),
        options: {
          model: model || "claude-opus-4-8",
          permissionMode: "dontAsk",
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          maxTurns: 10,
          cwd: APP_CWD,
          hooks,
        },
      });

      for await (const message of fixQ) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text" && block.text) {
              scheduleDelta(block.text);
            }
          }
        }
      }

      await flushDelta();
      await flushMirror();
    }

    // Final tsc check to determine ok/fail status.
    const { hasErrors: finalErrors } = runTscLocally(APP_CWD);
    console.log(\`[runner] final tsc: hasErrors=\${finalErrors}\`);

    const report = {
      ok: !finalErrors,
      summary: finalErrors
        ? \`tsc still has errors after \${tscCycle} repair cycle(s)\`
        : "Agent run complete — tsc clean",
      entryScreens: [],
      costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };

    console.log("[runner] bridge:complete ok=" + report.ok);
    await bridgeMutation("agentBridge:complete", { versionId, report });
  } catch (err) {
    console.error("[runner] fatal:", err);
    await bridgeMutation("agentBridge:fail", { versionId, reason: String(err) }).catch(() => {});
    process.exit(1);
  } finally {
    stopHeartbeat();
  }
}

run();
`;
}

// If run directly, output the generated content to stdout
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(generate(ROOT));
}
