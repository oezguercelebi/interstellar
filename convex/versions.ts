import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { versionStatus } from "./schema";

/** Public: one version (for the preview pane / code view). */
export const get = query({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => ctx.db.get(versionId),
});

/** Public: all versions of a project, oldest → newest (the time-travel timeline). */
export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return versions.sort((a, b) => a.index - b.index);
  },
});

/** Internal: create a version row. */
export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    index: v.number(),
    label: v.string(),
    directive: v.string(),
    styleKey: v.string(),
    styleName: v.string(),
    model: v.string(),
    threadId: v.optional(v.string()),
    parentVersionId: v.optional(v.id("versions")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("versions", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
  },
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
  },
  handler: async (ctx, { versionId, ...rest }) => {
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(versionId, patch);
  },
});

/** Public: promote a version to be the project's active one (time-travel restore / keep variant). */
export const setActive = mutation({
  args: { projectId: v.id("projects"), versionId: v.id("versions") },
  handler: async (ctx, { projectId, versionId }) => {
    await ctx.db.patch(projectId, { activeVersionId: versionId });
  },
});
