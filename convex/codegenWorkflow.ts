import { v } from "convex/values";
import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";

/** Durable orchestrator for the generation pipeline. */
export const workflow = new WorkflowManager(components.workflow);

const variantArg = v.object({
  versionId: v.id("versions"),
  threadId: v.string(),
  promptMessageId: v.string(),
  model: v.string(),
  effort: v.optional(v.string()),
  styleDirective: v.string(),
  userPrompt: v.optional(v.string()), // present on first-gen; absent on edits (plan step skipped)
  // Starter kit stamped on the version row. Optional so in-flight workflow
  // journals from before the kit field stay valid across the deploy; absent = classic.
  kit: v.optional(v.union(v.literal("classic"), v.literal("nativewind"))),
});

/**
 * Generate N variants in parallel. Each variant: stream code → provision a live
 * preview. Workpool bounds concurrency and retries each variant independently,
 * so one model overload never sinks the whole run. The handler is pure
 * orchestration; all real work happens inside durable `step.runAction` calls.
 */
export const generateApp = workflow.define({
  args: {
    projectId: v.id("projects"),
    variants: v.array(variantArg),
    isEdit: v.boolean(),
  },
  handler: async (step, { variants, isEdit }): Promise<void> => {
    await Promise.all(
      variants.map(async (variant, i) => {
        await step.runAction(
          internal.codegen.runVariant,
          { ...variant, isEdit },
          { name: `generate-v${i}`, retry: true },
        );
        await step.runAction(
          internal.preview.provisionPreview,
          { versionId: variant.versionId, kit: variant.kit },
          { name: `preview-v${i}` },
        );
      }),
    );
  },
});
