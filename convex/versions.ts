import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { versionStatus } from "./schema";

/** Internal: patch any subset of mutable version fields. */
export const patch = internalMutation({
  args: {
    versionId: v.id("versions"),
    status: v.optional(versionStatus),
    label: v.optional(v.string()),
    summary: v.optional(v.string()),
    entryScreens: v.optional(v.array(v.string())),
    previewUrl: v.optional(v.string()),
    previewAt: v.optional(v.number()),
    sandboxId: v.optional(v.string()),
    sandboxProvider: v.optional(v.string()),
    threadId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    error: v.optional(v.string()),
    plan: v.optional(v.string()),
  },
  handler: async (ctx, { versionId, ...rest }) => {
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(versionId, patch);
  },
});
