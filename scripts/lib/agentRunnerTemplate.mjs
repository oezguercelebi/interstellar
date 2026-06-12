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
 * Normalize a file path delivered by a tool hook (PreToolUse/PostToolUse) to a
 * project-relative path suitable for mirroring and forbidden-path checks.
 *
 * Rules:
 *   1. If the path starts with appCwd + "/" — strip that prefix → relative path.
 *   2. If the path starts with "/" but NOT with appCwd — it is outside the cwd
 *      (e.g. /tmp/..., /etc/...) → return null (skip).
 *   3. If the path is already relative — strip a leading "./" if present.
 *   4. An empty string → null.
 *   5. Never returns a path starting with "../" (outside the cwd) → null.
 *
 * Exported for pure unit tests.
 */
export function normalizeMirrorPath(rawPath, appCwd) {
  if (!rawPath) return null;
  let p = rawPath;
  // Case 1: absolute path inside cwd
  const prefix = appCwd.endsWith("/") ? appCwd : appCwd + "/";
  if (p.startsWith(prefix)) {
    p = p.slice(prefix.length);
  } else if (p === appCwd) {
    // Exactly the cwd itself — not a file
    return null;
  } else if (p.startsWith("/")) {
    // Absolute path outside cwd
    return null;
  }
  // Case 3: strip leading ./
  if (p.startsWith("./")) p = p.slice(2);
  // Guard: no traversal outside cwd
  if (!p || p.startsWith("../") || p === "..") return null;
  return p;
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
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd) ?? rawPath;
            if (isForbiddenPathFn(relPath)) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: `Refusing to write forbidden path: ${relPath}`,
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
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd) ?? rawPath;
            if (isForbiddenPathFn(relPath)) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: `Refusing to edit forbidden path: ${relPath}`,
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
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd);
            if (relPath && !isForbiddenPathFn(relPath)) {
              const contents = toolInput.content ?? toolInput.file_text ?? "";
              scheduleMirrorFn(relPath, contents);
            }
          },
        ],
      },
      {
        matcher: "Edit",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd);
            if (relPath && !isForbiddenPathFn(relPath)) {
              try {
                const { readFileSync } = await import("node:fs");
                const contents = readFileSync(`${appCwd}/${relPath}`, "utf8");
                scheduleMirrorFn(relPath, contents);
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
 * Extract a named template-literal export from a TS source string.
 * Handles: export const NAME = `...`; (backtick string, possibly multi-line)
 * Returns the raw text between the backticks (with escapes intact).
 * Throws if the export is not found, so drift is caught at generation time.
 */
function extractTemplateLiteral(src, exportName) {
  // Match: export const NAME = `...`; where content may span lines.
  // We search for the opening backtick after the assignment and scan to the
  // matching closing backtick (handling escaped backticks \`).
  const assignRe = new RegExp(`export const ${exportName}\\s*=\\s*\``);
  const match = assignRe.exec(src);
  if (!match) throw new Error(`extractTemplateLiteral: "${exportName}" not found`);
  let i = match.index + match[0].length;
  let result = "";
  while (i < src.length) {
    if (src[i] === "\\") {
      // Escaped character — include both chars
      result += src[i] + (src[i + 1] ?? "");
      i += 2;
    } else if (src[i] === "`") {
      // Closing backtick
      return result;
    } else {
      result += src[i];
      i++;
    }
  }
  throw new Error(`extractTemplateLiteral: "${exportName}" has no closing backtick`);
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

  // Read the prompt-cache-anchor source files and extract the stable system prefix
  // text verbatim. These strings are inlined into run.mjs so the agent gets the same
  // constraints as the legacy path. The source files are never imported (Rule 4 / convex
  // entry files); we read them as text and extract their template literals.
  // IMPORTANT: extracting here at generation time means the mirror test will catch any
  // drift — whenever prompt.ts or designSystem.ts changes, run.mjs must be regenerated.
  const promptSrc = fs.readFileSync(path.join(root, "convex/agents/prompt.ts"), "utf8");
  const designSrc = fs.readFileSync(path.join(root, "convex/agents/designSystem.ts"), "utf8");
  const SYSTEM_PROMPT_TEXT = extractTemplateLiteral(promptSrc, "SYSTEM_PROMPT");
  const SYSTEM_PROMPT_NATIVEWIND_TEXT = extractTemplateLiteral(promptSrc, "SYSTEM_PROMPT_NATIVEWIND");
  const HOUSE_DESIGN_SYSTEM_TEXT = extractTemplateLiteral(designSrc, "HOUSE_DESIGN_SYSTEM");
  const HOUSE_DESIGN_SYSTEM_NATIVEWIND_TEXT = extractTemplateLiteral(designSrc, "HOUSE_DESIGN_SYSTEM_NATIVEWIND");

  // Build the two stable prefixes (classic and nativewind) as JSON-serialised strings
  // so they can be embedded as JS string literals in run.mjs without escaping hell.
  // JSON.stringify produces a valid JS string literal (double-quoted, all special chars escaped).
  const STABLE_CLASSIC_JSON = JSON.stringify(`${SYSTEM_PROMPT_TEXT}\n\n${HOUSE_DESIGN_SYSTEM_TEXT}`);
  const STABLE_NATIVEWIND_JSON = JSON.stringify(`${SYSTEM_PROMPT_NATIVEWIND_TEXT}\n\n${HOUSE_DESIGN_SYSTEM_NATIVEWIND_TEXT}`);

  const content = `#!/usr/bin/env node
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

// ── System prompt (kit-selected stable prefix, inlined from convex/agents/) ───
// These constants are extracted from prompt.ts + designSystem.ts at generation
// time so the runner enforces the same import allowlist, hard constraints, and
// design-system rules as the legacy Convex codegen path.
// classic kit:
const STABLE_SYSTEM_CLASSIC = ${STABLE_CLASSIC_JSON};
// nativewind kit:
const STABLE_SYSTEM_NATIVEWIND = ${STABLE_NATIVEWIND_JSON};

/**
 * Select the stable system prefix for the given kit.
 * Returns the combined SYSTEM_PROMPT + HOUSE_DESIGN_SYSTEM text.
 */
function selectStableSystem(kitName) {
  return kitName === "nativewind" ? STABLE_SYSTEM_NATIVEWIND : STABLE_SYSTEM_CLASSIC;
}

/**
 * Build the system prompt option for query() — SDK 0.2.73+/0.3.173 shape:
 *   { type: 'preset', preset: 'claude_code', append?: string }
 * The stable prefix is appended after the preset so the import allowlist and
 * hard constraints are always in effect. styleDirective is appended last if set.
 */
function buildSystemPromptOption(kitName, styleDirectiveText) {
  const stableText = selectStableSystem(kitName);
  const appendParts = [stableText];
  if (styleDirectiveText) {
    appendParts.push(\`# STYLE DIRECTIVE (apply on every screen)\\n\${styleDirectiveText}\`);
  }
  return {
    type: "preset",
    preset: "claude_code",
    append: appendParts.join("\\n\\n"),
  };
}

// ── Mirror path normalization ─────────────────────────────────────────────────
// Normalizes absolute or relative paths from tool hooks to project-relative
// paths for mirroring. Returns null for paths outside the cwd (skip those).
function normalizeMirrorPath(rawPath, appCwd) {
  if (!rawPath) return null;
  let p = rawPath;
  const prefix = appCwd.endsWith("/") ? appCwd : appCwd + "/";
  if (p.startsWith(prefix)) {
    p = p.slice(prefix.length);
  } else if (p === appCwd) {
    return null;
  } else if (p.startsWith("/")) {
    return null; // absolute path outside cwd — skip
  }
  if (p.startsWith("./")) p = p.slice(2);
  if (!p || p.startsWith("../") || p === "..") return null;
  return p;
}

// ── Runner constants (module-level — accessible from self-test and run()) ─────
const APP_CWD = "/home/daytona/expo-app";
const MAX_TSC_CYCLES = 4;
const BUNDLE_PROBE_URL = "http://localhost:8081/index.bundle?platform=web&dev=true";
const METRO_HTML_PROBE_URL = "http://localhost:8081/";
const METRO_POLL_INTERVAL_MS = 4_000;
const METRO_POLL_MAX_MS = 160_000;

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

  // normalizeMirrorPath
  assert(normalizeMirrorPath("/home/daytona/expo-app/app/index.tsx", "/home/daytona/expo-app") === "app/index.tsx", "normalize: strips absolute cwd prefix");
  assert(normalizeMirrorPath("app/index.tsx", "/home/daytona/expo-app") === "app/index.tsx", "normalize: already-relative passthrough");
  assert(normalizeMirrorPath("./app/index.tsx", "/home/daytona/expo-app") === "app/index.tsx", "normalize: strips leading ./");
  assert(normalizeMirrorPath("/tmp/foo.txt", "/home/daytona/expo-app") === null, "normalize: /tmp is outside cwd → null");
  assert(normalizeMirrorPath("/home/daytona/expo-app", "/home/daytona/expo-app") === null, "normalize: exact cwd → null");
  assert(normalizeMirrorPath("", "/home/daytona/expo-app") === null, "normalize: empty → null");
  assert(normalizeMirrorPath("../sibling/file.ts", "/home/daytona/expo-app") === null, "normalize: traversal → null");

  // hooks shape (SDK 0.3.173 verified)
  const mirrored = new Map();
  const CWD = "/home/daytona/expo-app";
  const hooks = buildHooks({
    appCwd: CWD,
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
  // PreToolUse deny for forbidden path (relative)
  const writeMatchers = hooks.PreToolUse.filter((m) => m.matcher === "Write");
  assert(writeMatchers.length === 1, "PreToolUse has Write matcher");
  const denyResult = await writeMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "package.json" } });
  assert(denyResult?.hookSpecificOutput?.permissionDecision === "deny", "Write forbidden path (relative) returns deny");
  assert(denyResult?.hookSpecificOutput?.hookEventName === "PreToolUse", "deny hookEventName is PreToolUse");
  // PreToolUse deny for forbidden path (absolute)
  const denyAbsResult = await writeMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: CWD + "/package.json" } });
  assert(denyAbsResult?.hookSpecificOutput?.permissionDecision === "deny", "Write forbidden path (absolute) returns deny");
  // PreToolUse allow for allowed path (absolute)
  const allowAbsResult = await writeMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: CWD + "/app/index.tsx" } });
  assert(allowAbsResult === undefined, "allowed absolute path returns undefined from PreToolUse hook");
  // PreToolUse allow for allowed path (relative)
  const allowResult = await writeMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "app/index.tsx" } });
  assert(allowResult === undefined, "allowed relative path returns undefined from PreToolUse hook");
  // PostToolUse Write schedules mirror — absolute path → normalized relative
  const postWriteMatchers = hooks.PostToolUse.filter((m) => m.matcher === "Write");
  assert(postWriteMatchers.length === 1, "PostToolUse has Write matcher");
  await postWriteMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: CWD + "/app/foo.tsx", content: "hello" } });
  assert(mirrored.get("app/foo.tsx") === "hello", "PostToolUse Write (absolute path) mirrors as relative");
  // PostToolUse Write — relative path
  await postWriteMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "app/bar.tsx", content: "world" } });
  assert(mirrored.get("app/bar.tsx") === "world", "PostToolUse Write (relative path) mirrors as relative");
  // PostToolUse Write does NOT mirror forbidden paths
  await postWriteMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "package.json", content: "{}" } });
  assert(!mirrored.has("package.json"), "PostToolUse Write does NOT mirror forbidden path");
  // PostToolUse Write does NOT mirror paths outside cwd
  await postWriteMatchers[0].hooks[0]({ tool_name: "Write", tool_input: { path: "/tmp/secret.txt", content: "x" } });
  assert(!mirrored.has("/tmp/secret.txt"), "PostToolUse Write does NOT mirror /tmp paths");

  // Metro constants
  assert(typeof BUNDLE_PROBE_URL === "string" && BUNDLE_PROBE_URL.includes("index.bundle"), "BUNDLE_PROBE_URL defined and looks like a bundle URL");
  assert(typeof METRO_HTML_PROBE_URL === "string" && METRO_HTML_PROBE_URL.includes("localhost:8081"), "METRO_HTML_PROBE_URL defined");
  assert(METRO_POLL_MAX_MS === 160_000, "METRO_POLL_MAX_MS is 160s");
  assert(METRO_POLL_INTERVAL_MS === 4_000, "METRO_POLL_INTERVAL_MS is 4s");

  // system prompt option
  const sysOpt = buildSystemPromptOption("classic", "");
  assert(sysOpt.type === "preset", "systemPromptOption: type=preset");
  assert(sysOpt.preset === "claude_code", "systemPromptOption: preset=claude_code");
  assert(typeof sysOpt.append === "string" && sysOpt.append.length > 100, "systemPromptOption: append has stable prefix");
  assert(sysOpt.append.includes("Import allowlist") || sysOpt.append.includes("HARD CONSTRAINTS"), "systemPromptOption: append contains constraints");
  const sysOptNw = buildSystemPromptOption("nativewind", "dark mode");
  assert(sysOptNw.append.includes("dark mode"), "systemPromptOption nativewind: append includes styleDirective");
  assert(sysOptNw.append.includes("NativeWind") || sysOptNw.append.includes("className"), "systemPromptOption nativewind: uses NW prefix");

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
import fs from "node:fs";

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

/**
 * Build the SDK-correct hooks config for the agent query.
 *
 * SDK 0.3.173 shape (sdk.d.ts lines 814-819, 2203-2215, 6205-6219):
 *   hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>
 *   HookCallbackMatcher: { matcher?: string; hooks: HookCallback[]; timeout?: number }
 *   HookCallback: (input, toolUseID, { signal }) => Promise<HookJSONOutput>
 *   Deny via SyncHookJSONOutput.hookSpecificOutput.permissionDecision = 'deny'
 *   Paths are normalized via normalizeMirrorPath before forbidden check and mirror.
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
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd) ?? rawPath;
            if (isForbiddenPathFn(relPath)) {
              console.log(\`[runner] PreToolUse Write blocked forbidden: \${relPath}\`);
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: \`Refusing to write forbidden path: \${relPath}\`,
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
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd) ?? rawPath;
            if (isForbiddenPathFn(relPath)) {
              console.log(\`[runner] PreToolUse Edit blocked forbidden: \${relPath}\`);
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: \`Refusing to edit forbidden path: \${relPath}\`,
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
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd);
            if (relPath && !isForbiddenPathFn(relPath)) {
              const contents = toolInput.content ?? toolInput.file_text ?? "";
              console.log(\`[runner] PostToolUse Write mirror: \${relPath}\`);
              scheduleMirrorFn(relPath, contents);
            }
          },
        ],
      },
      {
        matcher: "Edit",
        hooks: [
          async (input) => {
            const toolInput = input.tool_input ?? {};
            const rawPath = toolInput.path ?? toolInput.file_path ?? "";
            const relPath = normalizeMirrorPath(rawPath, appCwd);
            if (relPath && !isForbiddenPathFn(relPath)) {
              // After an Edit the file was modified — read it back for mirroring.
              try {
                const { readFileSync } = await import("node:fs");
                const contents = readFileSync(\`\${appCwd}/\${relPath}\`, "utf8");
                console.log(\`[runner] PostToolUse Edit mirror: \${relPath}\`);
                scheduleMirrorFn(relPath, contents);
              } catch {
                // Best-effort; mirror will be stale but not fatal.
                console.warn(\`[runner] PostToolUse Edit readback failed: \${relPath}\`);
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

    // System prompt: { type:'preset', preset:'claude_code', append: <stable prefix + style> }
    // (sdk.d.ts line 1126: systemPrompt?: string | { type:'preset'; preset:'claude_code'; append? })
    // The stable prefix carries the import allowlist, hard constraints, and design system rules.
    const systemPromptOption = buildSystemPromptOption(kit ?? "classic", styleDirective ?? "");
    console.log("[runner] systemPrompt kit=" + (kit ?? "classic") + " appendLen=" + systemPromptOption.append.length);

    // Shared query options — reused for the main query and every tsc repair cycle.
    const queryOptions = {
      model: model || "claude-opus-4-8",
      permissionMode: "dontAsk",
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      maxTurns: 40,
      cwd: APP_CWD,
      hooks,
      systemPrompt: systemPromptOption,
    };

    // Accumulate cost from the SDK result messages across all query() calls.
    // SDKResultMessage (type:'result') carries total_cost_usd and usage (BetaUsage).
    // BetaUsage fields: input_tokens, output_tokens, cache_read_input_tokens,
    //   cache_creation_input_tokens (sdk.d.ts NonNullableUsage via BetaUsage).
    let totalCostUsd = 0;
    const totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    function accumulateResult(message) {
      if (message.type !== "result") return;
      totalCostUsd += message.total_cost_usd ?? 0;
      const u = message.usage ?? {};
      totalUsage.inputTokens       += u.input_tokens ?? 0;
      totalUsage.outputTokens      += u.output_tokens ?? 0;
      totalUsage.cacheReadTokens   += u.cache_read_input_tokens ?? 0;
      totalUsage.cacheWriteTokens  += u.cache_creation_input_tokens ?? 0;
    }

    // Launch the query. The SDK returns an AsyncGenerator; we iterate it to
    // consume assistant messages and tool events, streaming text deltas to
    // Convex via appendChatDelta.
    console.log("[runner] launching query");
    const q = query({
      prompt: promptText,
      options: queryOptions,
    });

    let msgCount = 0;
    for await (const message of q) {
      msgCount++;
      console.log(\`[runner] msg[\${msgCount}] type=\${message.type}\`);
      accumulateResult(message);
      // Stream assistant text deltas to Convex.
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text) {
            scheduleDelta(block.text);
          }
        }
      }
    }
    console.log(\`[runner] query complete, \${msgCount} messages, costUsd=\${totalCostUsd}\`);

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
        options: { ...queryOptions, maxTurns: 10 },
      });

      for await (const message of fixQ) {
        accumulateResult(message);
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

    // ── Metro: kill any lingering expo start (excluding this runner process) ──
    execSync("pkill -f 'expo start' || true", { stdio: "ignore" });

    // ── Metro: shell double-fork — survives Daytona session teardown ─────────
    // Legacy form from convex/lib/sandbox/daytona.ts: subshell-backgrounded
    // nohup so the process tree is detached from this runner's session.
    // execSync blocks for the sleep 5, giving Metro a head start before probing.
    const METRO_LAUNCH_SHELL = \`(CI=1 EXPO_NO_TELEMETRY=1 nohup ./node_modules/.bin/expo start --web --port 8081 < /dev/null > /tmp/expo.log 2>&1 &) ; sleep 5\`;
    let metroStarted = false;
    try {
      execSync(METRO_LAUNCH_SHELL, { cwd: APP_CWD, stdio: "ignore" });
      metroStarted = true;
      console.log("[metro] launched via shell double-fork, logs at /tmp/expo.log");
      console.log("[metro] Metro logs at /tmp/expo.log");
    } catch (err) {
      console.warn("[metro] Metro launch failed:", err.message);
    }

    // ── Bundle probe: poll until Metro serves the web bundle ─────────────────
    // Budget parity with legacy waitForReady (37×4s ≈ 150s → 160s here).
    // Each iteration: warm GET / (html), then GET index.bundle (bundle).
    let bundleProbeOk = false;

    if (metroStarted) {
      const totalAttempts = Math.ceil(METRO_POLL_MAX_MS / METRO_POLL_INTERVAL_MS);
      let attempt = 0;
      const deadline = Date.now() + METRO_POLL_MAX_MS;
      while (Date.now() < deadline) {
        attempt++;
        let htmlStatus = 0;
        let bundleStatus = 0;
        try {
          const htmlRes = await fetch(METRO_HTML_PROBE_URL);
          htmlStatus = htmlRes.status;
        } catch { /* Metro not ready yet */ }
        try {
          const bundleRes = await fetch(BUNDLE_PROBE_URL);
          bundleStatus = bundleRes.status;
          if (bundleStatus === 200) {
            bundleProbeOk = true;
          }
        } catch { /* Metro not ready yet */ }
        console.log(\`[metro] probe attempt \${attempt}/\${totalAttempts}: html=\${htmlStatus}, bundle=\${bundleStatus}\`);
        if (bundleProbeOk) {
          console.log("[metro] bundle probe: 200 OK");
          break;
        }
        await new Promise((r) => setTimeout(r, METRO_POLL_INTERVAL_MS));
      }
      if (!bundleProbeOk) {
        console.warn("[metro] bundle probe timed out after " + METRO_POLL_MAX_MS + "ms");
      }
    }

    const metroNote = metroStarted
      ? (bundleProbeOk ? "Metro running, bundle OK" : "Metro started but bundle probe timed out")
      : "Metro failed to start";

    const ok = !finalErrors && bundleProbeOk;
    const report = {
      ok,
      summary: finalErrors
        ? \`tsc still has errors after \${tscCycle} repair cycle(s); \${metroNote}\`
        : ok
          ? \`Agent run complete — tsc clean; \${metroNote}\`
          : \`Agent run complete — tsc clean but \${metroNote}\`,
      entryScreens: [],
      costUsd: totalCostUsd,
      usage: totalUsage,
    };

    console.log("[runner] bridge:complete ok=" + report.ok + " costUsd=" + report.costUsd);
    await bridgeMutation("agentBridge:complete", { versionId, report });

    // ── Post-complete Metro alive check ───────────────────────────────────────
    await new Promise(r => setTimeout(r, 5000));
    try {
      execSync("pgrep -f 'expo start'", { stdio: "ignore" });
      console.log("[metro] post-complete alive check: Metro still running");
    } catch {
      console.log("[metro] post-complete alive check: Metro NOT running (teardown regression?)");
    }
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

  // Write runnerArtifact.ts alongside run.mjs
  const artifactPath = path.join(root, "convex/lib/agentRunner/runnerArtifact.ts");
  const artifactFileContent = "// AUTO-GENERATED — do not edit. Run: node scripts/lib/agentRunnerTemplate.mjs\nexport const RUN_MJS = " + JSON.stringify(content) + ";\n";
  fs.writeFileSync(artifactPath, artifactFileContent, "utf8");

  return content;
}

// If run directly, write run.mjs to disk (and artifact as side effect)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outPath = path.join(ROOT, "scripts/agent-runner/run.mjs");
  const result = generate(ROOT);
  fs.writeFileSync(outPath, result, "utf8");
  console.error("[template] wrote " + outPath);
}
