import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { makeAgent, makeCodegenTools } from "./agents/codegen";
import { buildInstructions } from "./agents/prompt";
import { validateManifest } from "./lib/validate";
import { effortProviderOptions } from "./lib/styles";
import { repairFiles } from "./lib/webcompat";

/**
 * Generate (or edit) one app variant. Streams the model's tool calls; each
 * writeFile lands in the `files` table reactively, so the UI fills in live.
 * Runs as a durable workflow step — safe to retry.
 */
export const runVariant = internalAction({
  args: {
    versionId: v.id("versions"),
    threadId: v.string(),
    promptMessageId: v.string(),
    model: v.string(),
    effort: v.optional(v.string()),
    styleDirective: v.string(),
    isEdit: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; fileCount: number }> => {
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      status: "generating",
    });

    // In edit mode, give the model the current file list as context.
    let existingFiles: string | undefined;
    if (args.isEdit) {
      const files: Doc<"files">[] = await ctx.runQuery(internal.files.snapshot, {
        versionId: args.versionId,
      });
      existingFiles = files
        .filter((f) => !f.deleted)
        .map((f) => `- ${f.path} (${f.purpose})`)
        .join("\n");
    }

    const instructions = buildInstructions({
      styleDirective: args.styleDirective,
      isEdit: args.isEdit,
      existingFiles,
    });
    const tools = makeCodegenTools(args.versionId);
    const agent = makeAgent(args.model, instructions, tools);

    try {
      // Opus 4.8 supports adaptive-thinking effort; other models reject it, so
      // effortProviderOptions returns undefined and we omit providerOptions.
      const providerOptions = effortProviderOptions(args.model, args.effort);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const genOpts: any = { promptMessageId: args.promptMessageId };
      if (providerOptions) genOpts.providerOptions = providerOptions;
      const result = await agent.streamText(
        ctx,
        { threadId: args.threadId },
        genOpts,
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
    } catch (err) {
      console.error("streamText failed", err);
    }

    // Authoritative gate: the file table is the source of truth.
    let files: Doc<"files">[] = await ctx.runQuery(internal.files.snapshot, {
      versionId: args.versionId,
    });

    // Deterministically heal web-incompat imports (e.g. safe-area APIs pulled
    // from "react-native") before validating + storing, so the very first
    // preview renders on web instead of crashing.
    const fixes = repairFiles(files.filter((f) => !f.deleted));
    if (fixes.length > 0) {
      for (const fix of fixes) {
        await ctx.runMutation(internal.files.upsert, {
          versionId: args.versionId,
          path: fix.path,
          contents: fix.contents,
          purpose: fix.purpose,
        });
      }
      files = await ctx.runQuery(internal.files.snapshot, { versionId: args.versionId });
    }

    const { ok, problems } = validateManifest(files);
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      status: ok ? "ready" : "failed",
      error: ok ? undefined : problems.join("; "),
    });

    return { ok, fileCount: files.filter((f) => !f.deleted).length };
  },
});
