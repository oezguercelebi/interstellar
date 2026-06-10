#!/usr/bin/env node
/**
 * scripts/qa-e2e.mjs — the ONE command an agent runs to verify the
 * generate→preview→render loop, model-free, and read ONE JSON verdict.
 *
 * It seeds a known fixture app (no Anthropic call), provisions a live Daytona
 * preview, waits for it, then drives a headless-browser render check through the
 * same-origin proxy. Sandboxes are pre-cleaned and torn down in a finally block.
 *
 * Usage:
 *   node scripts/qa-e2e.mjs [--fixture good|broken] [--keep] [--screenshot] [--preclean-all]
 *
 * Precleaning only deletes sandboxes created from this project's DAYTONA_SNAPSHOT;
 * --preclean-all wipes every sandbox in your Daytona org (use with care).
 *
 * Verdict (last line of stdout, JSON), exit 0 pass / 1 fail:
 *   { ok, step, fixture, projectId, versionId, sandboxId, previewUrl,
 *     validateOk, rendered, consoleErrors, durationMs, error }
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { runMutation, runQuery } from "./lib/convex.mjs";
import { preclean, teardown } from "./lib/sandboxLifecycle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => process.stderr.write(`[qa-e2e] ${a.join(" ")}\n`);

const argv = process.argv.slice(2);
let fixture = "good";
let keep = false;
let screenshot = false;
let precleanAll = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--fixture") fixture = argv[++i];
  else if (argv[i] === "--keep") keep = true;
  else if (argv[i] === "--screenshot") screenshot = true;
  else if (argv[i] === "--preclean-all") precleanAll = true;
}

const t0 = Date.now();
const verdict = {
  ok: false,
  step: "init",
  fixture,
  projectId: null,
  versionId: null,
  sandboxId: null,
  previewUrl: null,
  validateOk: null,
  rendered: null,
  consoleErrors: [],
  durationMs: 0,
  error: null,
};

/** Run a node script, capture its stdout JSON (last JSON-looking line). */
function runScript(rel, args) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(__dirname, rel), ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => {
      let json = null;
      try {
        // the script prints one JSON object (pretty); parse the whole thing
        json = JSON.parse(out);
      } catch {
        // fall back to last non-empty line
        const line = out.trim().split("\n").filter(Boolean).pop();
        try { json = JSON.parse(line); } catch { /* leave null */ }
      }
      resolve({ code, json, raw: out });
    });
  });
}

function finish(code) {
  verdict.durationMs = Date.now() - t0;
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  process.exit(code);
}

let sandboxId = null;
try {
  // 1. Pre-clean stale sandboxes (scoped to this project's snapshot) so we
  //    never collide with the CPU quota.
  verdict.step = "preclean";
  await preclean([], { all: precleanAll });

  // 2. Seed a fixture app + provision a preview (no model call).
  verdict.step = "seed";
  const seed = await runMutation("testHelpers:seedFixture", { fixture, provision: true });
  verdict.projectId = seed.projectId;
  verdict.versionId = seed.versionId;
  log(`seeded ${fixture}: project=${seed.projectId}`);

  // 3. Read the static validation result up front.
  const snap0 = await runQuery("projects:inspect", { projectId: seed.projectId });
  verdict.validateOk = snap0?.validate?.ok ?? null;

  // 4. Wait for the live preview.
  verdict.step = "wait-ready";
  const waited = await runScript("wait-preview-ready.mjs", [seed.projectId, "--timeout", "180000"]);
  if (!waited.json?.ok) {
    verdict.error = `preview not ready: ${waited.json?.reason || "unknown"}`;
    finish(1);
  }
  sandboxId = waited.json.sandboxId;
  verdict.sandboxId = sandboxId;
  verdict.previewUrl = waited.json.previewUrl;
  log(`preview ready: sandbox=${sandboxId}`);

  // 5. Headless render check through the proxy.
  verdict.step = "render-check";
  const qaArgs = [sandboxId, "--wait", "45000"];
  if (screenshot) qaArgs.push("--screenshot");
  const qa = await runScript("qa-preview.mjs", qaArgs);
  verdict.rendered = qa.json?.rendered ?? false;
  verdict.consoleErrors = qa.json?.consoleErrors ?? [];

  verdict.ok = verdict.rendered === true;
  verdict.step = "done";
  finish(verdict.ok ? 0 : 1);
} catch (e) {
  verdict.error = (e && e.message) || String(e);
  finish(1);
} finally {
  if (!keep && sandboxId) await teardown(sandboxId);
}
