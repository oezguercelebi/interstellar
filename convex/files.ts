import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/** Public: the live file list for a version — powers the activity log + code view. */
export const listByVersion = query({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_version", (q) => q.eq("versionId", versionId))
      .collect();
    return files
      .filter((f) => !f.deleted)
      .sort((a, b) => a.path.localeCompare(b.path));
  },
});

/** Internal: full snapshot (incl. deleted markers) for validation + sandbox materialization. */
export const snapshot = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    return await ctx.db
      .query("files")
      .withIndex("by_version", (q) => q.eq("versionId", versionId))
      .collect();
  },
});

/** Internal: idempotent upsert keyed on (versionId, path). Called by the writeFile tool. */
export const upsert = internalMutation({
  args: {
    versionId: v.id("versions"),
    path: v.string(),
    contents: v.string(),
    purpose: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("files")
      .withIndex("by_version_path", (q) =>
        q.eq("versionId", args.versionId).eq("path", args.path),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        contents: args.contents,
        purpose: args.purpose,
        deleted: false,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("files", { ...args, updatedAt: now });
  },
});

/** Internal: soft-delete a file (called by the deleteFile tool). */
export const remove = internalMutation({
  args: { versionId: v.id("versions"), path: v.string() },
  handler: async (ctx, { versionId, path }) => {
    const existing = await ctx.db
      .query("files")
      .withIndex("by_version_path", (q) => q.eq("versionId", versionId).eq("path", path))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { deleted: true, updatedAt: Date.now() });
  },
});

/**
 * Internal: bulk-insert the starter-kit files for a fresh first-generation version.
 * Called once per variant right after the version row is created in projects.start.
 * Uses upsert semantics (by_version_path index) so it is safe to call more than once.
 */
export const seedStarter = internalMutation({
  args: {
    versionId: v.id("versions"),
    files: v.array(
      v.object({ path: v.string(), contents: v.string(), purpose: v.string() }),
    ),
  },
  handler: async (ctx, { versionId, files }) => {
    const now = Date.now();
    for (const f of files) {
      const existing = await ctx.db
        .query("files")
        .withIndex("by_version_path", (q) =>
          q.eq("versionId", versionId).eq("path", f.path),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          contents: f.contents,
          purpose: f.purpose,
          deleted: false,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("files", { versionId, ...f, updatedAt: now });
      }
    }
  },
});

/** Internal: clone all files from one version into another (for edits / restore). */
export const cloneInto = internalMutation({
  args: { fromVersionId: v.id("versions"), toVersionId: v.id("versions") },
  handler: async (ctx, { fromVersionId, toVersionId }) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_version", (q) => q.eq("versionId", fromVersionId))
      .collect();
    const now = Date.now();
    for (const f of files) {
      if (f.deleted) continue;
      await ctx.db.insert("files", {
        versionId: toVersionId,
        path: f.path,
        contents: f.contents,
        purpose: f.purpose,
        updatedAt: now,
      });
    }
  },
});
