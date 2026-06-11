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
 * Agent SDK API (documented at code.claude.com/docs/en/agent-sdk/typescript):
 *   query({ prompt, options }) → AsyncGenerator<SDKMessage>
 *   options.permissionMode = "dontAsk"  (camelCase)
 *   options.allowedTools   = ["Read","Write","Edit","Bash","Glob","Grep"]
 *   options.hooks.preToolUse  — array of { match, handler } objects
 *   options.hooks.postToolUse — array of { match, handler } objects
 *   Write hook input: { path, content }; Edit hook input: { path, edits[] }
 *   Multi-turn: query.streamInput(asyncIterable) feeds follow-up user messages
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

function runSelfTests() {
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

  console.log(\`Self-test: \${passed} passed, \${failed} failed\`);
  if (failed > 0) process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

if (process.argv.includes("--self-test")) {
  runSelfTests();
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
// Agent SDK API (code.claude.com/docs/en/agent-sdk/typescript):
//   query({ prompt, options }) → AsyncGenerator<SDKMessage>
//   options.permissionMode = "dontAsk"  (camelCase per docs)
//   options.allowedTools   = ["Read","Write","Edit","Bash","Glob","Grep"]
//   options.hooks.preToolUse  / postToolUse — { match: { toolName }, handler }
//   Write hook input: { path, content }; Edit hook input: { path, edits[] }
//   Multi-turn tsc feedback: q.streamInput(asyncIterable) on the active query

const APP_CWD = "/home/daytona/expo-app";
const MAX_TSC_CYCLES = 4;

// Build an AsyncIterable<SDKUserMessage> from a single string message.
async function* singleUserMessage(text) {
  yield { type: "user", message: { role: "user", content: text } };
}

async function run() {
  startHeartbeat();

  try {
    // Dynamic import — SDK is installed in the nw2 snapshot, not in this repo.
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    // The initial prompt arrives via env: promptMessageId identifies the
    // message in the Convex thread. The actual text is baked into that message;
    // the bridge fetches it and returns it as the prompt string.
    const promptText = await bridgeMutation("agentBridge:getPromptText", {
      versionId,
      promptMessageId,
    });

    let tscCycle = 0;

    // Hooks wired to the SDK's documented tool names and input shapes.
    // preToolUse: write-deny FORBIDDEN_PATHS (deny before the write happens).
    // postToolUse: mirror Write/Edit to Convex via the 300ms batcher.
    const hooks = {
      preToolUse: [
        {
          match: { toolName: "Write" },
          handler: async (hook) => {
            if (isForbiddenPath(hook.input.path ?? "")) {
              return {
                behavior: "deny",
                message: \`Refusing to write forbidden path: \${hook.input.path}\`,
              };
            }
          },
        },
        {
          match: { toolName: "Edit" },
          handler: async (hook) => {
            if (isForbiddenPath(hook.input.path ?? "")) {
              return {
                behavior: "deny",
                message: \`Refusing to edit forbidden path: \${hook.input.path}\`,
              };
            }
          },
        },
      ],
      postToolUse: [
        {
          match: { toolName: "Write" },
          handler: async (hook) => {
            if (hook.input.path && !isForbiddenPath(hook.input.path)) {
              scheduleMirror(hook.input.path, hook.input.content ?? "");
            }
          },
        },
        {
          match: { toolName: "Edit" },
          handler: async (hook) => {
            // After an Edit the file has been modified; read it back for mirroring.
            if (hook.input.path && !isForbiddenPath(hook.input.path)) {
              try {
                const { readFileSync } = await import("node:fs");
                const contents = readFileSync(
                  \`\${APP_CWD}/\${hook.input.path}\`,
                  "utf8",
                );
                scheduleMirror(hook.input.path, contents);
              } catch {
                // Best-effort; mirror will be stale but not fatal.
              }
            }
          },
        },
      ],
    };

    // Launch the query. The SDK returns an AsyncGenerator; we iterate it to
    // consume assistant messages and tool events, streaming text deltas to
    // Convex via appendChatDelta.
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

    for await (const message of q) {
      // Stream assistant text deltas to Convex.
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

    // tsc verify loop — runs locally in the sandbox, feeds errors back via
    // q.streamInput() as per the SDK's multi-turn documented mechanism.
    // Each cycle is a new query() because the first query has already
    // completed; we pass the tsc error as the follow-up prompt.
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

    const report = {
      ok: !finalErrors,
      summary: finalErrors
        ? \`tsc still has errors after \${tscCycle} repair cycle(s)\`
        : "Agent run complete — tsc clean",
      entryScreens: [],
      costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };

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
