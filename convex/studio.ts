import { v } from "convex/values";
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { components } from "./_generated/api";
import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { workflow } from "./codegenWorkflow";

/**
 * The chat thread for one variant, with streaming deltas. Drives the agent
 * activity log via `useThreadMessages(..., { stream: true })` on the client.
 */
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, { threadId, paginationOpts, streamArgs }) => {
    const paginated = await listUIMessages(ctx, components.agent, { threadId, paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId, streamArgs });
    return { ...paginated, streams };
  },
});

/** Reactive workflow progress for the generation status indicator. */
export const workflowStatus = query({
  args: { workflowId: v.string() },
  handler: async (ctx, { workflowId }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await workflow.status(ctx, workflowId as any);
    } catch {
      return null;
    }
  },
});
