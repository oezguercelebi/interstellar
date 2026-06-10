import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Interstellar data model.
 *
 * The `files` table — not the model's context window — is the source of truth for
 * a generated app. The agent's tools upsert rows here, which makes generation
 * resumable after a crash and lets the UI render each file the instant it lands.
 *
 * The Agent and Workflow components own their own internal tables.
 */
export const versionStatus = v.union(
  v.literal("pending"),
  v.literal("generating"),
  v.literal("repairing"),
  v.literal("ready"),
  v.literal("failed"),
);

export default defineSchema({
  projects: defineTable({
    userId: v.string(),
    title: v.string(),
    prompt: v.string(),
    activeVersionId: v.optional(v.id("versions")),
    thumbnail: v.optional(v.string()), // dataURL JPEG of the first build's preview
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  versions: defineTable({
    projectId: v.id("projects"),
    index: v.number(),
    label: v.string(), // AI-written, e.g. "Added onboarding flow"
    directive: v.string(), // the prompt/instruction that produced this version
    styleKey: v.string(), // theme key: auto | signature | editorial | midnight | playful | mono
    styleName: v.string(),
    theme: v.optional(v.string()), // chosen design theme (see lib/styles THEMES)
    status: versionStatus,
    model: v.string(),
    effort: v.optional(v.string()), // Opus only: low | medium | high
    threadId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    summary: v.optional(v.string()),
    entryScreens: v.optional(v.array(v.string())),
    previewUrl: v.optional(v.string()),
    previewAt: v.optional(v.number()), // when the live sandbox was last provisioned
    sandboxId: v.optional(v.string()),
    sandboxProvider: v.optional(v.string()), // daytona | snack | provisioning | none | error
    error: v.optional(v.string()),
    parentVersionId: v.optional(v.id("versions")),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_index", ["projectId", "index"]),

  files: defineTable({
    versionId: v.id("versions"),
    path: v.string(),
    contents: v.string(),
    purpose: v.string(), // plain-English label shown in the activity log
    deleted: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_version", ["versionId"])
    .index("by_version_path", ["versionId", "path"]),

  checkpoints: defineTable({
    projectId: v.id("projects"),
    versionId: v.id("versions"),
    label: v.string(),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),
});
