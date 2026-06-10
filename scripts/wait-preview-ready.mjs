#!/usr/bin/env node
/**
 * scripts/wait-preview-ready.mjs — poll a version until its preview is live.
 *
 * Replaces ad-hoc bash pollers: structured JSON verdict, hard timeout, and it
 * detects the terminal error state (provisionPreview now patches
 * sandboxProvider:"error" on Metro timeout) so it fails fast instead of hanging.
 *
 * Usage:
 *   node scripts/wait-preview-ready.mjs <projectId> [--timeout 180000] [--interval 4000]
 *
 * Output (stdout JSON), exit 0 if ready / 1 otherwise:
 *   { ok, status, sandboxProvider, sandboxId, previewUrl, elapsedMs, reason }
 */
import { runQuery } from "./lib/convex.mjs";

const log = (...a) => process.stderr.write(`[wait] ${a.join(" ")}\n`);

const argv = process.argv.slice(2);
const projectId = argv[0];
if (!projectId) {
  process.stderr.write("Usage: node scripts/wait-preview-ready.mjs <projectId> [--timeout ms] [--interval ms]\n");
  process.exit(1);
}
let timeout = 180_000;
let interval = 4_000;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--timeout") timeout = Number(argv[++i]);
  else if (argv[i] === "--interval") interval = Number(argv[++i]);
}

const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emit(v) {
  process.stdout.write(JSON.stringify({ ...v, elapsedMs: Date.now() - t0 }, null, 2) + "\n");
}

while (Date.now() - t0 < timeout) {
  let snap;
  try {
    snap = await runQuery("projects:inspect", { projectId });
  } catch (e) {
    log(`inspect failed (retrying): ${String(e).slice(0, 100)}`);
    await sleep(interval);
    continue;
  }
  const a = snap?.active;
  if (!a) {
    emit({ ok: false, reason: "no-active-version" });
    process.exit(1);
  }
  const provider = a.sandboxProvider;
  log(`status=${a.status} provider=${provider} url=${a.previewUrl ? "yes" : "no"}`);

  // Terminal success: live daytona preview with a URL.
  if (provider === "daytona" && a.previewUrl && a.previewAt) {
    emit({
      ok: true,
      status: a.status,
      sandboxProvider: provider,
      sandboxId: a.sandboxId,
      previewUrl: a.previewUrl,
      reason: "ready",
    });
    process.exit(0);
  }
  // Terminal failures.
  if (provider === "error" || a.status === "failed") {
    emit({ ok: false, status: a.status, sandboxProvider: provider, reason: a.error || "error" });
    process.exit(1);
  }
  if (provider === "none") {
    emit({ ok: false, sandboxProvider: provider, reason: "no-sandbox-key" });
    process.exit(1);
  }
  await sleep(interval);
}

emit({ ok: false, reason: "timeout" });
process.exit(1);
