"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { repairFiles } from "./lib/webcompat";
import { getSandboxProvider } from "./lib/sandbox";
import { SANDBOX_APP_ROOT } from "./lib/sandbox/types";
import { decideReopenTier } from "./lib/sandbox/reopenTier";
import {
  parseTscOutput,
  selectImplicatedFiles,
  callRepairModel,
  truncateErrorOutput,
} from "./lib/sandbox/typecheckRepair";

/**
 * Materialize a generated app into a sandbox and serve a live preview.
 *
 * The platform-specific work (create machine, upload files, start the dev
 * server) lives behind the SandboxProvider interface — see convex/lib/sandbox/.
 * This action owns the provider-agnostic orchestration: load + self-heal the
 * files, provision, persist the result, and poll until the preview is live.
 *
 * Without sandbox credentials the version is left preview-less with
 * sandboxProvider:"none".
 */
export const provisionPreview = internalAction({
  args: {
    versionId: v.id("versions"),
    // Starter kit of the version (absent = classic). Passed by both callers —
    // codegenWorkflow (variantArg.kit) and projects.reopenPreview (version row)
    // — so no extra versions query is needed here.
    kit: v.optional(v.union(v.literal("classic"), v.literal("nativewind"))),
    // Sandbox id of THIS version's prior provision, passed by reopenPreview so we
    // can run the tiered-reopen logic (probe → restart → fresh provision).
    // Also used by tier 3 to free the prior sandbox before booting a replacement.
    // Absent on first-gen/edit: those versions have no prior sandbox.
    previousSandboxId: v.optional(v.string()),
    // The stored previewUrl at the time of the reopen request. The mutation clears
    // previewUrl before scheduling this action, so we pass it explicitly for the
    // tier-1 probe (which needs the URL to check if the sandbox is still alive).
    // Absent on first-gen/edit.
    previousPreviewUrl: v.optional(v.string()),
  },
  handler: async (ctx, { versionId, kit, previousSandboxId, previousPreviewUrl }) => {
    const provider = getSandboxProvider();

    // Short-circuit if no sandbox credentials.
    if (!provider) {
      await ctx.runMutation(internal.versions.patch, { versionId, sandboxProvider: "none" });
      return;
    }

    // Fast-path: if the version already has a live agent-runner sandbox, skip
    // re-provisioning — the runner manages the sandbox lifecycle itself.
    const version = await ctx.runQuery(internal.versions.getById, { versionId });
    if (version?.sandboxId && version.agentJobId) {
      console.log(`provisionPreview: version ${versionId} has live agentJobId — skipping re-provision`);
      return;
    }

    // G5: only free the prior sandbox if the version has no live agent job.
    const safeToDelete = !version?.agentJobId;

    // ── TIERED REOPEN ──────────────────────────────────────────────────────────
    // When previousSandboxId is set this is a reopen of an existing version.
    // Try the cheapest path before falling through to a full fresh provision.
    //
    //   Tier 1 — probe: the preview URL is still alive → re-stamp only (<4s).
    //   Tier 2 — restart: sandbox exists → start (if stopped) + relaunch Metro.
    //   Tier 3 — fresh: sandbox gone → delete best-effort + full provision (below).
    //
    // G5: when version has a live agentJobId the agent owns the sandbox — we never
    // delete or restart it. decideReopenTier returns tier 1 (probe-only) in that case;
    // if probe=dead we return early and let the agent manage lifecycle itself.
    if (previousSandboxId && previousPreviewUrl) {
      const tiered = await tryTieredReopen(
        ctx,
        provider,
        previousSandboxId,
        previousPreviewUrl,
        version?.agentJobId ? true : false,
        versionId,
      );
      if (tiered === "done") return; // tier 1 or tier 2 succeeded — no fresh provision needed
      // tiered === "fallthrough": proceed to tier 3 full provision below
      // Best-effort free the prior sandbox before booting the replacement.
      if (safeToDelete && provider.delete) {
        try {
          await provider.delete(previousSandboxId);
          console.log(`provisionPreview: tier 3 — freed prior sandbox ${previousSandboxId}`);
        } catch (err) {
          console.warn(
            `provisionPreview: could not free prior sandbox ${previousSandboxId} (non-fatal):`,
            String(err).slice(0, 200),
          );
        }
      }
    } else if (!previousSandboxId) {
      // First-gen / edit path — no prior sandbox to free.
      // (Legacy: the old code only freed when previousSandboxId was set — preserve.)
    }

    // Fetch the generated files for this version.
    const all: Doc<"files">[] = await ctx.runQuery(internal.files.snapshot, { versionId });
    const files = all.filter((f) => !f.deleted);
    if (files.length === 0) return;

    // Heal known web-incompat issues (e.g. safe-area APIs imported from
    // "react-native", which crash on react-native-web) before upload, and
    // persist the fixes so the code panel and future reopens stay clean. This
    // makes reopening an older, broken build self-repair.
    const fixes = repairFiles(files);
    for (const fix of fixes) {
      const orig = files.find((f) => f.path === fix.path);
      if (orig) orig.contents = fix.contents;
      await ctx.runMutation(internal.files.upsert, {
        versionId,
        path: fix.path,
        contents: fix.contents,
        purpose: fix.purpose,
      });
    }

    try {
      const { sandboxId, previewUrl } = await provider.provision(
        files.map((f) => ({ path: f.path, contents: f.contents })),
        { kit },
      );

      // Persist the sandbox info immediately so the UI can show a "loading" state.
      await ctx.runMutation(internal.versions.patch, {
        versionId,
        previewUrl,
        previewAt: Date.now(),
        sandboxId,
        sandboxProvider: provider.name,
      });

      // ── WAIT FOR THE PREVIEW TO SERVE ────────────────────────────────────────
      // Poll until the dev server returns a real response (cap ~150s). If it
      // never comes up, mark the version as errored so polling agents (and the
      // UI) see a terminal failure instead of a live-looking row with a dead URL.
      const ready = await waitForReady(previewUrl, 37, 4_000);
      if (!ready) {
        await ctx.runMutation(internal.versions.patch, {
          versionId,
          sandboxProvider: "error",
          error: "Preview failed: dev server never became ready (timeout)",
        });
      }

      // ── TYPE-CHECK REPAIR LOOP (best-effort) ─────────────────────────────────
      // Run tsc in the sandbox AFTER Metro is up. Any failure is non-fatal —
      // the preview already serves the current (unrepaired) code.
      // Sequenced after waitForReady so the repair hot-reloads into a live preview.
      // Skip entirely if the preview never came up: the version is already marked
      // errored, and the repair pass (tsc + model, up to ~3 min) would
      // burn the remaining action budget on a preview no one can see.
      if (ready) {
        await runTypecheckRepair(ctx, provider, sandboxId, versionId, files);
      }
    } catch (err) {
      console.error("provisionPreview failed", err);
      await ctx.runMutation(internal.versions.patch, {
        versionId,
        sandboxProvider: "error",
        error: `Preview failed: ${String(err).slice(0, 300)}`,
      });
    }
  },
});

/**
 * Tiered reopen — try tiers 1 → 2 → 3 in order.
 *
 * Returns:
 *   "done"        — tier 1 or tier 2 succeeded; provisionPreview should return early.
 *   "fallthrough" — both tiers failed; caller should proceed to tier 3 (full provision).
 *
 * G5: hasAgentJob=true short-circuits to tier 1 probe only. If probe=dead the
 * agent manages lifecycle — we return "done" (early exit) to avoid interfering.
 */
async function tryTieredReopen(
  ctx: ActionCtx,
  provider: ReturnType<typeof getSandboxProvider>,
  sandboxId: string,
  previewUrl: string,
  hasAgentJob: boolean,
  versionId: Id<"versions">,
): Promise<"done" | "fallthrough"> {
  if (!provider) return "fallthrough";

  // Tier 1: probe the preview URL with a short timeout (~4s).
  const probeAlive = await probePreviewUrl(previewUrl);
  console.log(`[tiered-reopen] tier-1 probe → ${probeAlive ? "alive" : "dead"}`);

  // Get sandbox state (tier 2 decision input).
  let sandboxState: "running" | "stopped" | "unknown" = "unknown";
  if (!probeAlive && !hasAgentJob && provider.getSandboxState) {
    try {
      sandboxState = await provider.getSandboxState(sandboxId);
      console.log(`[tiered-reopen] sandbox state → ${sandboxState}`);
    } catch (err) {
      console.warn("[tiered-reopen] getSandboxState failed (non-fatal):", String(err).slice(0, 200));
    }
  }

  const tier = decideReopenTier({
    probeOutcome: probeAlive ? "alive" : "dead",
    sandboxState,
    hasAgentJob,
  });
  console.log(`[tiered-reopen] decided tier ${tier} (agentJob=${hasAgentJob})`);

  // Tier 1: preview is alive — restore previewUrl, re-stamp previewAt and return.
  if (tier === 1 && probeAlive) {
    await ctx.runMutation(internal.versions.patch, {
      versionId,
      previewUrl,
      previewAt: Date.now(),
      sandboxProvider: "daytona",
      sandboxId,
      error: undefined,
    });
    console.log(`[tiered-reopen] tier 1 success — re-stamped previewAt, sandbox ${sandboxId}`);
    return "done";
  }

  // Tier 1 (G5 path): probe=dead but agent owns sandbox — don't touch, return early.
  if (tier === 1 && hasAgentJob) {
    console.log(`[tiered-reopen] tier 1 G5 early-exit — agent owns sandbox ${sandboxId}, probe=dead, not interfering`);
    return "done";
  }

  // Tier 2: sandbox exists — start (if stopped) then relaunch Metro, wait for ready.
  if (tier === 2) {
    try {
      // Start the sandbox if it's stopped (cold-box: Metro process is gone).
      if (sandboxState === "stopped" && provider.startSandbox) {
        console.log(`[tiered-reopen] tier 2 — starting stopped sandbox ${sandboxId}`);
        await provider.startSandbox(sandboxId);
      }

      // (Re)launch Metro — restartDevServer kills any lingering process and boots fresh.
      if (provider.restartDevServer) {
        console.log(`[tiered-reopen] tier 2 — relaunching dev server in sandbox ${sandboxId}`);
        await provider.restartDevServer(sandboxId, SANDBOX_APP_ROOT);
      } else if (provider.exec) {
        // Fallback: exec the Metro launch command directly.
        const METRO_LAUNCH_CMD = `(CI=1 EXPO_NO_TELEMETRY=1 nohup ./node_modules/.bin/expo start --web --port 8081 < /dev/null > /tmp/expo.log 2>&1 &) ; sleep 5 ; echo metro-launched`;
        await provider.exec(sandboxId, `pkill -f 'expo start' || true ; ${METRO_LAUNCH_CMD}`, {
          cwd: SANDBOX_APP_ROOT,
          timeoutSeconds: 60,
        });
      } else {
        console.warn("[tiered-reopen] tier 2 — provider lacks restartDevServer + exec; falling through to tier 3");
        return "fallthrough";
      }

      // Wait for ready with a shorter budget (~60s) — files are already in place.
      const ready = await waitForReady(previewUrl, 15, 4_000);
      if (ready) {
        await ctx.runMutation(internal.versions.patch, {
          versionId,
          previewUrl,
          previewAt: Date.now(),
          sandboxProvider: "daytona",
          sandboxId,
          error: undefined,
        });
        console.log(`[tiered-reopen] tier 2 success — dev server ready, sandbox ${sandboxId}`);
        return "done";
      }
      console.warn(`[tiered-reopen] tier 2 failed — dev server didn't come up in 60s; falling through to tier 3`);
    } catch (err) {
      console.warn("[tiered-reopen] tier 2 threw (non-fatal, falling to tier 3):", String(err).slice(0, 300));
    }
  }

  return "fallthrough";
}

/**
 * Single-shot probe of a preview URL with a short timeout (~4s).
 * Used by the tier-1 reopen check: if the URL responds with HTTP 200 the
 * sandbox is still live and we can skip all sandbox churn.
 * Sends the X-Daytona-Skip-Preview-Warning header so Daytona's interstitial
 * page doesn't masquerade as a live app response.
 */
async function probePreviewUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "X-Daytona-Skip-Preview-Warning": "true" },
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/**
 * Poll the preview URL until it returns HTTP 200 or we exhaust retries.
 * Plain fetch — provider-agnostic. Returns true if the server became ready.
 */
async function waitForReady(url: string, attempts = 37, gapMs = 4_000): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        console.log(`waitForReady: got ${res.status} on attempt ${i + 1}`);
        return true;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  console.warn(`waitForReady: URL ${url} never returned 200 after ${attempts} attempts`);
  return false;
}

// ── Type-check repair loop ────────────────────────────────────────────────────

/**
 * Best-effort type-check + repair pass after Metro is running.
 *
 * Flow:
 *   1. Feature-detect: does the provider support exec/uploadFiles?
 *   2. Check tsc is present in node_modules/.bin — skip gracefully if absent.
 *   3. Run tsc --noEmit --pretty false (generous 120s timeout).
 *   4. If no errors, log success and return.
 *   5. Parse errors → select ≤8 implicated files → call repair model (ONE pass).
 *   6. Persist fixed files to Convex and re-upload to sandbox.
 *
 * No post-repair recheck: a second tsc run would cost up to 120s of the
 * Convex action's 600s budget for log-only information. The next paid run's
 * preview behavior is the real verdict.
 *
 * Any thrown error is caught and logged — the preview is never broken by this.
 */
async function runTypecheckRepair(
  ctx: ActionCtx,
  provider: ReturnType<typeof getSandboxProvider>,
  sandboxId: string,
  versionId: Id<"versions">,
  currentFiles: Doc<"files">[],
): Promise<void> {
  if (!provider) return;

  // Feature-detect: provider must implement exec + uploadFiles.
  if (!provider.exec || !provider.uploadFiles) {
    console.log("[tsc-repair] provider does not support exec/uploadFiles — skipping");
    return;
  }

  try {
    const proj = SANDBOX_APP_ROOT;

    // ── Step 1: Check tsc is present ───────────────────────────────────────
    const checkResult = await provider.exec(sandboxId, "test -x ./node_modules/.bin/tsc && echo present || echo absent", {
      cwd: proj,
      timeoutSeconds: 10,
    });
    if (!checkResult.output.includes("present")) {
      console.log("[tsc-repair] tsc not found in node_modules/.bin — skipping repair");
      return;
    }

    // ── Step 2: Run tsc ─────────────────────────────────────────────────────
    console.log("[tsc-repair] running tsc --noEmit --pretty false");
    const tscResult = await provider.exec(
      sandboxId,
      "./node_modules/.bin/tsc --noEmit --pretty false 2>&1 || true",
      { cwd: proj, timeoutSeconds: 120 },
    );

    const tscOutput = tscResult.output;
    const errors = parseTscOutput(tscOutput);

    if (errors.length === 0) {
      console.log("[tsc-repair] tsc: 0 errors — nothing to repair");
      return;
    }

    console.log(`[tsc-repair] tsc: ${errors.length} error(s) found — attempting repair`);

    // ── Step 3: Select implicated files ────────────────────────────────────
    const implicatedPaths = selectImplicatedFiles(errors);
    const implicatedFiles = currentFiles
      .filter((f) => !f.deleted && implicatedPaths.includes(f.path))
      .map((f) => ({ path: f.path, contents: f.contents }));

    if (implicatedFiles.length === 0) {
      console.log("[tsc-repair] no writable implicated files found — skipping repair");
      return;
    }

    // ── Step 4: Model repair call (ONE pass) ───────────────────────────────
    const errorBlock = truncateErrorOutput(tscOutput);
    const fixedFiles = await callRepairModel(errorBlock, implicatedFiles);

    if (fixedFiles.length === 0) {
      console.log("[tsc-repair] model returned no fixes");
      return;
    }

    console.log(`[tsc-repair] model fixed ${fixedFiles.length} file(s) — persisting`);

    // ── Step 5: Persist to Convex + re-upload to sandbox ───────────────────
    for (const fix of fixedFiles) {
      const orig = currentFiles.find((f) => f.path === fix.path);
      await ctx.runMutation(internal.files.upsert, {
        versionId,
        path: fix.path,
        contents: fix.contents,
        purpose: orig?.purpose ?? "source",
      });
    }

    await provider.uploadFiles(sandboxId, fixedFiles, proj);

    // Hot reload is not trustworthy after a repair re-upload (observed live:
    // Metro under CI=1 + NativeWind dies silently on the change) — relaunch
    // the dev server when the provider supports it. Best-effort like the rest.
    if (provider.restartDevServer) {
      await provider.restartDevServer(sandboxId, proj);
      console.log("[tsc-repair] re-uploaded fixed files — dev server restarted");
    } else {
      console.log("[tsc-repair] re-uploaded fixed files — Metro will hot-reload");
    }
  } catch (err) {
    // Never break the preview — log and move on.
    console.warn("[tsc-repair] repair loop failed (non-fatal):", String(err).slice(0, 300));
  }
}

/**
 * Launch the agent-runner in a fresh sandbox.
 *
 * Creates a sandbox (no file upload, no Metro), probes for the runner binary
 * (G3 capability check), optionally uploads parent files for edits, signs a
 * job token, patches the version row, then launches the runner nohup-detached.
 *
 * Called by codegen.runVariant when version.runner === "agent". Falls back to
 * the legacy path gracefully (returns launched:false) when any precondition
 * is missing so existing behavior is byte-identical when AGENT_RUNNER is unset.
 */
export const launchAgentRunner = internalAction({
  args: {
    versionId: v.id("versions"),
    isEdit: v.boolean(),
    kit: v.optional(v.union(v.literal("classic"), v.literal("nativewind"))),
    threadId: v.string(),
    promptMessageId: v.string(),
    model: v.string(),
    effort: v.optional(v.string()),
    styleDirective: v.string(),
    previousSandboxId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ launched: boolean; reason: string }> => {
    const provider = getSandboxProvider();
    if (!provider) return { launched: false, reason: "no-provider" };

    // G5: free prior sandbox only if version has no live agentJobId
    const version = await ctx.runQuery(internal.versions.getById, { versionId: args.versionId });
    if (!version) return { launched: false, reason: "version-not-found" };

    if (args.previousSandboxId && provider.delete && !version.agentJobId) {
      try { await provider.delete(args.previousSandboxId); }
      catch (err) { console.warn(`[launchAgentRunner] could not free prior sandbox ${args.previousSandboxId}:`, String(err).slice(0, 200)); }
    }

    // Create sandbox (no file upload, no Metro)
    if (!provider.createSandbox) {
      console.log("[launchAgentRunner] provider does not support createSandbox — falling back to legacy path");
      return { launched: false, reason: "no-create-sandbox" };
    }
    let sandboxId: string, previewUrl: string, workDir: string;
    try {
      ({ sandboxId, previewUrl, workDir } = await provider.createSandbox({ kit: args.kit }));
    } catch (err) {
      console.error("[launchAgentRunner] createSandbox failed:", String(err).slice(0, 400));
      return { launched: false, reason: "create-failed" };
    }

    // G3 capability probe: check runner binary is present in snapshot
    if (!provider.exec) {
      try { await provider.delete?.(sandboxId); } catch {}
      return { launched: false, reason: "no-exec" };
    }
    const probe = await provider.exec(sandboxId, "test -d /home/daytona/agent-runner && echo present || echo absent", { cwd: workDir, timeoutSeconds: 10 });
    if (!probe.output.includes("present")) {
      console.log("[launchAgentRunner] runner not found in snapshot — cleaning up and falling back");
      try { await provider.delete?.(sandboxId); } catch {}
      return { launched: false, reason: "no-runner" };
    }

    // For edits: upload parent files into the fresh sandbox
    if (args.isEdit && provider.uploadFiles) {
      const files = await ctx.runQuery(internal.files.snapshot, { versionId: args.versionId });
      const live = files.filter((f: { deleted?: boolean }) => !f.deleted);
      if (live.length > 0) {
        await provider.exec(sandboxId, "rm -rf app components store theme lib src", { cwd: workDir, timeoutSeconds: 30 });
        await provider.uploadFiles(sandboxId, live.map((f: { path: string; contents: string }) => ({ path: f.path, contents: f.contents })), workDir);
      }
    }

    // Sign job token
    const secret = process.env.AGENT_JOB_SECRET ?? "";
    if (!secret) {
      try { await provider.delete?.(sandboxId); } catch {}
      return { launched: false, reason: "no-job-secret" };
    }
    const { signToken } = await import("./lib/agentRunner/token.js");
    const exp = Date.now() + 4 * 60 * 60 * 1000;
    const jobToken = await signToken({ versionId: args.versionId, exp }, secret);
    const jobId = crypto.randomUUID();

    // Patch {sandboxId, agentJobId, sandboxProvider, previewUrl} BEFORE launching
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      sandboxId,
      agentJobId: jobId,
      sandboxProvider: "daytona",
      previewUrl,
    });

    // Build env and launch runner nohup-detached
    function shellQ(val: string): string {
      return `'${val.replace(/'/g, "'\\''")}'`;
    }
    // The runner POSTs to {CONVEX_URL}/api/mutation — the Convex function-call
    // HTTP API, which lives ONLY on the .convex.cloud host (CONVEX_CLOUD_URL).
    // CONVEX_SITE_URL is the .convex.site HTTP-actions host and 404s /api/mutation.
    const convexUrl = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_URL ?? "";
    const anthropicKey = process.env.AGENT_RUNNER_ANTHROPIC_KEY ?? "";
    const envPairs: Array<[string, string]> = [
      ["ANTHROPIC_API_KEY", anthropicKey],
      ["CONVEX_URL", convexUrl],
      ["JOB_TOKEN", jobToken],
      ["versionId", args.versionId],
      ["threadId", args.threadId],
      ["promptMessageId", args.promptMessageId],
      ["model", args.model],
      ["effort", args.effort ?? ""],
      ["kit", args.kit ?? "classic"],
      ["isEdit", args.isEdit ? "true" : "false"],
      ["styleDirective", args.styleDirective],
    ];
    const envPrefix = envPairs.map(([k, v]) => `${k}=${shellQ(v)}`).join(" ");
    const launchCmd = `env ${envPrefix} nohup node /home/daytona/agent-runner/run.mjs > /tmp/agent-runner.log 2>&1 &`;
    await provider.exec(sandboxId, launchCmd, { cwd: workDir, timeoutSeconds: 15 });
    console.log(`[launchAgentRunner] runner launched for version ${args.versionId} in sandbox ${sandboxId}`);
    return { launched: true, reason: "ok" };
  },
});
