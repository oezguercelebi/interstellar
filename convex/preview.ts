"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { repairFiles } from "./lib/webcompat";
import { getSandboxProvider } from "./lib/sandbox";

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
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const provider = getSandboxProvider();

    // Short-circuit if no sandbox credentials.
    if (!provider) {
      await ctx.runMutation(internal.versions.patch, { versionId, sandboxProvider: "none" });
      return;
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
