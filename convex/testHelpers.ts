/**
 * QA-only helpers for model-free testing. These seed a KNOWN generated app
 * directly into the DB and reuse the real provisionPreview path, so the whole
 * sandbox → preview → proxy → reopen → scroll → thumbnail surface can be tested
 * without spending an Anthropic generation.
 *
 * `seedFixture` is a public mutation (CLI-invokable for the harness) but it only
 * ever writes hardcoded fixture data under the demo user — it can't generate
 * arbitrary apps, so there's no abuse surface beyond what deleteAll already
 * cleans up.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { FIXTURES, type FixtureKey } from "./lib/__fixtures__/minimalExpoApp";

const DEMO_USER = "demo";

/**
 * Seed a fixture app as a ready project+version+files, optionally provisioning a
 * live preview. Returns the ids so the harness can inspect/provision/teardown.
 */
export const seedFixture = mutation({
  args: {
    fixture: v.optional(v.string()), // "good" | "broken" (default "good")
    title: v.optional(v.string()),
    provision: v.optional(v.boolean()), // kick off a Daytona preview (default false)
  },
  handler: async (ctx, { fixture, title, provision }) => {
    const key = (fixture ?? "good") as FixtureKey;
    const files = FIXTURES[key];
    if (!files) throw new Error(`Unknown fixture "${fixture}" (use "good" or "broken")`);

    const projectTitle = title ?? `QA fixture: ${key}`;
    const projectId = await ctx.db.insert("projects", {
      userId: DEMO_USER,
      title: projectTitle,
      prompt: `[qa-fixture:${key}]`,
      createdAt: Date.now(),
    });

    const versionId = await ctx.db.insert("versions", {
      projectId,
      index: 0,
      label: projectTitle,
      directive: `[qa-fixture:${key}]`,
      styleKey: "auto",
      styleName: "Auto",
      theme: "auto",
      status: "ready", // fixtures are pre-validated; skip the generating state
      model: "fixture",
      createdAt: Date.now(),
    });

    for (const f of files) {
      await ctx.db.insert("files", {
        versionId,
        path: f.path,
        contents: f.contents,
        purpose: f.purpose,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(projectId, { activeVersionId: versionId });

    if (provision) {
      await ctx.scheduler.runAfter(0, internal.preview.provisionPreview, { versionId });
    }

    return { projectId, versionId, fixture: key, provisioned: !!provision };
  },
});
