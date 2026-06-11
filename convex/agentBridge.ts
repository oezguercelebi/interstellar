/**
 * Agent runner bridge — public mutations called by the external job runner.
 *
 * Trust model: every public function verifies jobToken (HMAC-SHA-256) against
 * AGENT_JOB_SECRET env var — fail closed, missing secret rejects all calls.
 *
 * These are public (mutation/action, not internalMutation) because the runner
 * is an unauthenticated external caller using the Convex HTTP mutation API.
 * No "use node" — must stay isolate-safe (Rule 4).
 */
import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { verifyToken } from "./lib/agentRunner/token";
import { repairFiles } from "./lib/webcompat";
import { validateManifest } from "./lib/validate";

// ---------------------------------------------------------------------------
// Token verification helper
// ---------------------------------------------------------------------------

async function checkToken(jobToken: string, versionId: string): Promise<void> {
  const secret = process.env.AGENT_JOB_SECRET ?? "";
  if (!secret) throw new Error("AGENT_JOB_SECRET not configured");
  const result = await verifyToken(jobToken, secret);
  if (!result.valid) throw new Error(`invalid job token: ${result.reason}`);
  if (result.payload.versionId !== versionId) {
    throw new Error("job token versionId mismatch");
  }
}

// ---------------------------------------------------------------------------
// mirrorFile — upsert a batch of files from the runner
// ---------------------------------------------------------------------------

export const mirrorFile = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
    files: v.record(v.string(), v.string()),
  },
  handler: async (ctx, { jobToken, versionId, files }) => {
    await checkToken(jobToken, versionId);
    for (const [path, contents] of Object.entries(files)) {
      await ctx.runMutation(internal.files.upsert, {
        versionId,
        path,
        contents,
        purpose: "agent-mirror",
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// mirrorDelete — soft-delete a file from the runner
// NOTE: not called by run.mjs as of step 4; implemented per plan for future use.
// ---------------------------------------------------------------------------

export const mirrorDelete = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
    path: v.string(),
  },
  handler: async (ctx, { jobToken, versionId, path }) => {
    await checkToken(jobToken, versionId);
    await ctx.runMutation(internal.files.remove, { versionId, path });
    return null;
  },
});

// ---------------------------------------------------------------------------
// appendChatDelta — stateful streaming delta accumulator
// ---------------------------------------------------------------------------

export const appendChatDelta = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
    threadId: v.string(),
    chunk: v.string(),
  },
  handler: async (ctx, { jobToken, versionId, threadId, chunk }) => {
    await checkToken(jobToken, versionId);
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("version not found");

    if (!version.agentStreamId) {
      // First chunk: create the stream + write text-start + text-delta parts.
      const streamId = await ctx.runMutation(
        components.agent.streams.create,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          threadId: threadId as any,
          order: 0,
          stepOrder: 0,
          format: "TextStreamPart",
        },
      );
      const parts = [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", text: chunk },
      ];
      await ctx.runMutation(components.agent.streams.addDelta, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamId: streamId as any,
        start: 0,
        end: 2,
        parts,
      });
      await ctx.db.patch(versionId, {
        agentStreamId: streamId as string,
        agentStreamCursor: 2,
        agentStreamFullText: chunk,
      });
    } else {
      // Subsequent chunk: append text-delta part.
      const cursor = version.agentStreamCursor ?? 0;
      const parts = [{ type: "text-delta", id: "t1", text: chunk }];
      await ctx.runMutation(components.agent.streams.addDelta, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamId: version.agentStreamId as any,
        start: cursor,
        end: cursor + 1,
        parts,
      });
      await ctx.db.patch(versionId, {
        agentStreamCursor: cursor + 1,
        agentStreamFullText: (version.agentStreamFullText ?? "") + chunk,
      });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// heartbeat — runner liveness ping
// ---------------------------------------------------------------------------

export const heartbeat = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
  },
  handler: async (ctx, { jobToken, versionId }) => {
    await checkToken(jobToken, versionId);
    await ctx.db.patch(versionId, { agentHeartbeatAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------
// getPromptText — returns the directive that produced this version
// NOTE: implemented as a mutation because run.mjs uses bridgeMutation for all
// calls. The directive IS the prompt (stored at version-creation time).
// ---------------------------------------------------------------------------

export const getPromptText = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { jobToken, versionId }) => {
    await checkToken(jobToken, versionId);
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("version not found");
    return version.directive;
  },
});

// ---------------------------------------------------------------------------
// complete — runner finished; repair, validate, finalize stream, flip status
// ---------------------------------------------------------------------------

export const complete = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
    report: v.object({
      ok: v.boolean(),
      summary: v.string(),
      entryScreens: v.array(v.string()),
      costUsd: v.number(),
      usage: v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheReadTokens: v.number(),
        cacheWriteTokens: v.number(),
      }),
    }),
  },
  handler: async (ctx, { jobToken, versionId, report }) => {
    await checkToken(jobToken, versionId);
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("version not found");

    // Load files, repair web-compat issues, then re-validate.
    let files = await ctx.runQuery(internal.files.snapshot, { versionId });
    const fixes = repairFiles(files.filter((f) => !f.deleted));
    if (fixes.length > 0) {
      for (const fix of fixes) {
        await ctx.runMutation(internal.files.upsert, {
          versionId,
          path: fix.path,
          contents: fix.contents,
          purpose: fix.purpose,
        });
      }
      files = await ctx.runQuery(internal.files.snapshot, { versionId });
    }

    const kit = (version.kit ?? "classic") as "classic" | "nativewind";
    const { ok: manifestOk, problems } = validateManifest(files, kit);
    const finalOk = report.ok && manifestOk;

    // Finish the active chat stream and persist the full text as a message.
    const threadId = version.threadId;
    if (version.agentStreamId && threadId) {
      await ctx.runMutation(components.agent.streams.finish, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamId: version.agentStreamId as any,
      });
      await ctx.runMutation(components.agent.messages.addMessages, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        threadId: threadId as any,
        messages: [
          {
            message: {
              role: "assistant",
              content: version.agentStreamFullText ?? report.summary,
            },
            status: "success",
          },
        ],
      });
    }

    const errorParts = [
      ...(manifestOk ? [] : problems),
      ...(report.ok ? [] : [report.summary]),
    ];

    await ctx.db.patch(versionId, {
      status: finalOk ? "ready" : "failed",
      error: finalOk ? undefined : errorParts.join("; "),
      agentJobId: undefined,
      sandboxProvider: finalOk ? "daytona" : version.sandboxProvider,
      previewAt: finalOk ? Date.now() : version.previewAt,
      costUsd: report.costUsd,
      usage: report.usage,
      agentStreamId: undefined,
      agentStreamCursor: undefined,
      agentStreamFullText: undefined,
      entryScreens: report.entryScreens.length > 0 ? report.entryScreens : version.entryScreens,
      summary: report.summary || version.summary,
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// fail — runner fatal error; flip version to failed and clean up stream
// ---------------------------------------------------------------------------

export const fail = mutation({
  args: {
    jobToken: v.string(),
    versionId: v.id("versions"),
    reason: v.string(),
  },
  handler: async (ctx, { jobToken, versionId, reason }) => {
    await checkToken(jobToken, versionId);
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("version not found");

    // Best-effort stream finish to avoid orphaned streaming rows.
    if (version.agentStreamId) {
      try {
        await ctx.runMutation(components.agent.streams.finish, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          streamId: version.agentStreamId as any,
        });
      } catch {
        // Ignore — stream may already be closed.
      }
    }

    await ctx.db.patch(versionId, {
      status: "failed",
      error: reason,
      agentJobId: undefined,
      agentStreamId: undefined,
      agentStreamCursor: undefined,
      agentStreamFullText: undefined,
    });

    return null;
  },
});

// ---------------------------------------------------------------------------
// sweepStaleRuns — internal mutation to mark heartbeat-stale generating versions
// as failed. Activation: bootstrap via ctx.scheduler once at deploy time (step 5).
// Does NOT self-reschedule here so it stays safe to call idempotently.
// ---------------------------------------------------------------------------

export const sweepStaleRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const staleThreshold = Date.now() - 5 * 60 * 1000; // 5 minutes
    const generating = await ctx.db
      .query("versions")
      .filter((q) => q.eq(q.field("status"), "generating"))
      .collect();

    for (const v of generating) {
      // Only sweep agent-runner rows (runner === "agent"). Legacy in-Convex runs
      // have no heartbeat (agentHeartbeatAt is always undefined) so treating
      // `agentHeartbeatAt ?? 0` as stale would kill every legacy run >5min.
      if (v.runner !== "agent") continue;

      const heartbeatAt = v.agentHeartbeatAt ?? 0;
      if (heartbeatAt < staleThreshold) {
        await ctx.db.patch(v._id, {
          status: "failed",
          error: "agent runner heartbeat timeout (swept by sweepStaleRuns)",
          agentJobId: undefined,
          agentStreamId: undefined,
          agentStreamCursor: undefined,
          agentStreamFullText: undefined,
        });
      }
    }
  },
});
