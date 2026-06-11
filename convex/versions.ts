import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { versionStatus } from "./schema";

/** Internal: fetch a single version by id (used by awaitVariant poller). */
export const getById = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => ctx.db.get(versionId),
});

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
    // Agent runner bridge fields
    agentJobId: v.optional(v.string()),
    agentHeartbeatAt: v.optional(v.number()),
    agentPhase: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    usage: v.optional(v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      cacheReadTokens: v.number(),
      cacheWriteTokens: v.number(),
    })),
    agentStreamId: v.optional(v.string()),
    agentStreamCursor: v.optional(v.number()),
    agentStreamFullText: v.optional(v.string()),
    runner: v.optional(v.literal("agent")),
  },
  handler: async (ctx, { versionId, ...rest }) => {
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(versionId, patch);
  },
});
