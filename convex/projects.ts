import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { createThread, saveMessage } from "@convex-dev/agent";
import { workflow } from "./codegenWorkflow";
import {
  pickVariants,
  deriveTitle,
  DEFAULT_MODEL,
  isModelId,
  supportsEffort,
  DEFAULT_THEME,
  isThemeKey,
  themeDirective,
  themeName,
} from "./lib/styles";
import { validateManifest } from "./lib/validate";
import { STARTER_KITS } from "./agents/starterKit";

const DEMO_USER = "demo";

/**
 * Kick off a project: create the record, a thread + first message per variant,
 * a version row per variant, then start the durable generation workflow.
 *
 * The chosen model + effort apply to every variant in the build and are
 * persisted on each version so edits inherit the same selection.
 */
export const start = mutation({
  args: {
    prompt: v.string(),
    variants: v.number(),
    model: v.optional(v.string()),
    effort: v.optional(v.string()),
    theme: v.optional(v.string()),
  },
  handler: async (ctx, { prompt, variants, model: modelArg, effort: effortArg, theme: themeArg }) => {
    const model = modelArg && isModelId(modelArg) ? modelArg : DEFAULT_MODEL;
    const effort = supportsEffort(model) ? effortArg : undefined;
    const theme = themeArg && isThemeKey(themeArg) ? themeArg : DEFAULT_THEME;
    // Starter kit: env-driven activation, read at HANDLER time (never module
    // top-level). Absent/unknown STARTER_KIT = classic, so `npx convex dev`
    // auto-pushes can never flip the kit by accident.
    const kitEnv = process.env.STARTER_KIT;
    if (kitEnv && kitEnv !== "classic" && kitEnv !== "nativewind") {
      console.warn(`Unknown STARTER_KIT value "${kitEnv}" — falling back to classic`);
    }
    const kit = kitEnv === "nativewind" ? ("nativewind" as const) : ("classic" as const);
    const specs = pickVariants(variants);
    const projectId = await ctx.db.insert("projects", {
      userId: DEMO_USER,
      title: deriveTitle(prompt),
      prompt,
      createdAt: Date.now(),
    });

    const variantArgs = [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const threadId = await createThread(ctx, components.agent, {
        userId: DEMO_USER,
        title: prompt,
      });
      const { messageId } = await saveMessage(ctx, components.agent, { threadId, prompt });
      const directive = themeDirective(theme, { index: i, count: specs.length });
      const versionId = await ctx.db.insert("versions", {
        projectId,
        index: i,
        label: spec.name,
        directive: prompt,
        styleKey: theme,
        styleName: themeName(theme),
        theme,
        kit,
        status: "pending",
        model,
        effort,
        threadId,
        createdAt: Date.now(),
      });
      // Seed starter-kit files so required-file validation passes immediately
      // and the model can focus on product screens rather than infrastructure.
      // Only for first generation — edits clone the parent's files instead.
      await ctx.runMutation(internal.files.seedStarter, {
        versionId,
        files: STARTER_KITS[kit].files,
      });

      variantArgs.push({
        versionId,
        threadId,
        promptMessageId: messageId,
        model,
        effort,
        styleDirective: directive,
        userPrompt: prompt,
        kit,
      });
    }

    await ctx.db.patch(projectId, { activeVersionId: variantArgs[0].versionId });

    const workflowId = await workflow.start(
      ctx,
      internal.codegenWorkflow.generateApp,
      { projectId, variants: variantArgs, isEdit: false },
    );
    for (const va of variantArgs) {
      await ctx.db.patch(va.versionId, { workflowId });
    }

    return { projectId };
  },
});

/** Everything the studio shell needs in one reactive read. */
export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return { project, versions: versions.sort((a, b) => a.index - b.index) };
  },
});

/**
 * One-call lifecycle snapshot for agent-driven QA. Returns everything needed to
 * judge a build+preview from a single request — no GUI, no multi-round polling.
 * The active version also gets a fresh static validateManifest result so callers
 * can assert correctness without running the app.
 */
export const inspect = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;

    const versions = await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    versions.sort((a, b) => a.index - b.index);

    const activeId =
      project.activeVersionId ?? versions[versions.length - 1]?._id ?? null;
    const active = versions.find((vn) => vn._id === activeId) ?? null;

    let activeFileCount = 0;
    let validate: { ok: boolean; problems: string[] } | null = null;
    if (active) {
      const files = await ctx.db
        .query("files")
        .withIndex("by_version", (q) => q.eq("versionId", active._id))
        .collect();
      const live = files.filter((f) => !f.deleted);
      activeFileCount = live.length;
      validate = validateManifest(
        live.map((f) => ({ path: f.path, contents: f.contents })),
        active.kit, // absent on pre-migration rows → classic rules
      );
    }

    return {
      projectId: project._id,
      title: project.title,
      createdAt: project.createdAt,
      hasThumbnail: !!project.thumbnail,
      activeVersionId: activeId,
      active: active
        ? {
            versionId: active._id,
            index: active.index,
            status: active.status,
            theme: active.theme ?? null,
            model: active.model,
            effort: active.effort ?? null,
            sandboxProvider: active.sandboxProvider ?? null,
            sandboxId: active.sandboxId ?? null,
            previewUrl: active.previewUrl ?? null,
            previewAt: active.previewAt ?? null,
            error: active.error ?? null,
          }
        : null,
      activeFileCount,
      validate,
      versions: versions.map((vn) => ({
        versionId: vn._id,
        index: vn.index,
        status: vn.status,
        sandboxProvider: vn.sandboxProvider ?? null,
        error: vn.error ?? null,
      })),
    };
  },
});

/**
 * Reopen a preview whose sandbox has auto-stopped/expired: re-provision a fresh
 * Daytona sandbox from the still-stored files. Cheap — no model call.
 */
export const reopenPreview = mutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("Version not found");
    // Mark as re-provisioning and clear the stale URL so the UI shows a boot state.
    await ctx.db.patch(versionId, {
      sandboxProvider: "provisioning",
      previewUrl: undefined,
      previewAt: undefined,
      error: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.preview.provisionPreview, {
      versionId,
      kit: version.kit, // stamped at creation; absent (pre-migration) = classic
      // Captured before re-provision: provisionPreview deletes it so the old and
      // new sandboxes don't both count against the disk quota during the reopen.
      previousSandboxId: version.sandboxId,
    });
  },
});

/** Build history — recent projects with their active version's preview + status. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", DEMO_USER))
      .order("desc")
      .take(48);

    return Promise.all(
      projects.map(async (project) => {
        const versions = await ctx.db
          .query("versions")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        const active =
          versions.find((v) => v._id === project.activeVersionId) ??
          versions.sort((a, b) => b.index - a.index)[0];
        return {
          _id: project._id,
          title: project.title,
          createdAt: project.createdAt,
          status: active?.status ?? "pending",
          previewUrl: active?.previewUrl,
          thumbnail: project.thumbnail,
          model: active?.model,
          effort: active?.effort,
          styleName: active?.styleName,
          versionCount: versions.length,
        };
      }),
    );
  },
});

/**
 * Store the build's preview thumbnail (a small dataURL JPEG captured client-side
 * from the live preview). Written once, on the first successful build — we don't
 * overwrite an existing thumbnail on later edits, so the gallery keeps the
 * original "hero" shot.
 */
export const setThumbnail = mutation({
  args: { projectId: v.id("projects"), dataUrl: v.string() },
  handler: async (ctx, { projectId, dataUrl }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.thumbnail) return; // never overwrite
    if (!dataUrl.startsWith("data:image/") || dataUrl.length > 1_000_000) return; // sanity (Convex doc cap ~1 MiB)
    await ctx.db.patch(projectId, { thumbnail: dataUrl });
  },
});

/**
 * Wipe every build for the demo user — projects + their versions and files.
 * Used to reset the gallery. Agent/workflow component tables are left to
 * expire on their own (they're internal and harmless once orphaned).
 */
export const deleteAll = mutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", DEMO_USER))
      .collect();
    let versionsDeleted = 0;
    let filesDeleted = 0;
    for (const project of projects) {
      const versions = await ctx.db
        .query("versions")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      for (const version of versions) {
        const files = await ctx.db
          .query("files")
          .withIndex("by_version", (q) => q.eq("versionId", version._id))
          .collect();
        for (const f of files) {
          await ctx.db.delete(f._id);
          filesDeleted++;
        }
        await ctx.db.delete(version._id);
        versionsDeleted++;
      }
      await ctx.db.delete(project._id);
    }
    return { projects: projects.length, versions: versionsDeleted, files: filesDeleted };
  },
});

/** Clear the stored thumbnail so the next preview load re-captures it. */
export const clearThumbnail = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await ctx.db.patch(projectId, { thumbnail: undefined });
  },
});

/** Whether this project still needs a thumbnail (drives one-shot client capture). */
export const needsThumbnail = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    return !!project && !project.thumbnail;
  },
});

/** Follow-up edit: clone the active version's files into a new version and re-run. */
export const edit = mutation({
  args: { projectId: v.id("projects"), prompt: v.string() },
  handler: async (ctx, { projectId, prompt }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("Project not found");
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const parent =
      versions.find((v) => v._id === project.activeVersionId) ??
      versions.sort((a, b) => b.index - a.index)[0];
    if (!parent) throw new Error("No version to edit");

    const threadId =
      parent.threadId ??
      (await createThread(ctx, components.agent, { userId: DEMO_USER, title: prompt }));
    const { messageId } = await saveMessage(ctx, components.agent, { threadId, prompt });

    // Edits inherit the build's model + effort + theme selection.
    const model = isModelId(parent.model) ? parent.model : DEFAULT_MODEL;
    const effort = supportsEffort(model) ? parent.effort : undefined;
    const theme = parent.theme && isThemeKey(parent.theme) ? parent.theme : DEFAULT_THEME;
    const nextIndex = Math.max(...versions.map((v) => v.index)) + 1;
    const versionId = await ctx.db.insert("versions", {
      projectId,
      index: nextIndex,
      label: deriveTitle(prompt),
      directive: prompt,
      styleKey: parent.styleKey,
      styleName: parent.styleName,
      theme,
      // Edits inherit the parent's kit FOREVER — pre-migration projects keep
      // the classic prompt + validator regardless of the STARTER_KIT env.
      kit: parent.kit,
      status: "pending",
      model,
      effort,
      threadId,
      parentVersionId: parent._id,
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.files.cloneInto, {
      fromVersionId: parent._id,
      toVersionId: versionId,
    });
    await ctx.db.patch(projectId, { activeVersionId: versionId });

    const workflowId = await workflow.start(ctx, internal.codegenWorkflow.generateApp, {
      projectId,
      variants: [
        { versionId, threadId, promptMessageId: messageId, model, effort, styleDirective: themeDirective(theme, { index: 0, count: 1 }), kit: parent.kit },
      ],
      isEdit: true,
    });
    await ctx.db.patch(versionId, { workflowId });
    return { versionId };
  },
});
