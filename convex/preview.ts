"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { repairFiles } from "./lib/webcompat";
import { getSandboxProvider } from "./lib/sandbox";
import { SANDBOX_APP_ROOT } from "./lib/sandbox/types";
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
    // can free its quota before booting the replacement (Daytona's idle auto-stop
    // is ~30 min — long enough that stacked reopens exhaust the disk limit).
    // Absent on first-gen/edit: those versions have no prior sandbox.
    previousSandboxId: v.optional(v.string()),
  },
  handler: async (ctx, { versionId, kit, previousSandboxId }) => {
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

    // Free this version's previous sandbox BEFORE provisioning its replacement,
    // so the two don't both count against the disk/CPU quota. Best-effort: a
    // failed teardown must never block the new preview — the orphan still
    // auto-stops on its own. reopenPreview has already cleared the stale URL, so
    // there's nothing live to protect here.
    if (previousSandboxId && provider.delete && safeToDelete) {
      try {
        await provider.delete(previousSandboxId);
        console.log(`provisionPreview: freed prior sandbox ${previousSandboxId}`);
      } catch (err) {
        console.warn(
          `provisionPreview: could not free prior sandbox ${previousSandboxId} (non-fatal):`,
          String(err).slice(0, 200),
        );
      }
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
    const convexUrl = process.env.CONVEX_SITE_URL ?? process.env.CONVEX_URL ?? "";
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
