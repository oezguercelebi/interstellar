import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { makeAgent, makeCodegenTools } from "./agents/codegen";
import { buildSystemBlocks } from "./agents/prompt";
import { validateManifest } from "./lib/validate";
import { effortProviderOptions, MODEL_SONNET } from "./lib/styles";
import { repairFiles } from "./lib/webcompat";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

/**
 * Zod schema for the plan step. Kept compact — the model fills this in ~500 tokens.
 */
const AppPlanSchema = z.object({
  appName: z.string().describe("Short app name (2-4 words)"),
  oneLiner: z.string().describe("One sentence describing the app"),
  tabs: z
    .array(
      z.object({
        name: z.string(),
        icon: z.string().describe("Ionicons icon name, e.g. 'home' or 'search'"),
        purpose: z.string().describe("One sentence: what this tab shows"),
      }),
    )
    .min(2)
    .max(4),
  detailScreens: z
    .array(
      z.object({
        route: z.string().describe("e.g. app/detail.tsx"),
        purpose: z.string(),
      }),
    )
    .max(3)
    .optional(),
  contentDomain: z.object({
    description: z.string(),
    seedItems: z
      .array(z.string())
      .min(5)
      .max(8)
      .describe("Realistic example content strings for this app"),
  }),
  palette: z.object({
    mode: z.enum(["light", "dark"]),
    background: z.string().describe("Hex color for the background"),
    surface: z.string().describe("Hex color for cards/surfaces"),
    textPrimary: z.string().describe("Hex color for primary text"),
    accent: z.string().describe("Hex color for the primary accent"),
    personality: z.string().describe("One-line design personality description"),
  }),
});

type AppPlan = z.infer<typeof AppPlanSchema>;

/** Render the plan as readable YAML-ish text to inject into instructions. */
function formatPlan(plan: AppPlan): string {
  const tabs = plan.tabs
    .map((t) => `  - name: "${t.name}", icon: "${t.icon}", purpose: "${t.purpose}"`)
    .join("\n");
  const details =
    plan.detailScreens && plan.detailScreens.length > 0
      ? "\ndetailScreens:\n" +
        plan.detailScreens.map((d) => `  - route: "${d.route}", purpose: "${d.purpose}"`).join("\n")
      : "";
  const seeds = plan.contentDomain.seedItems.map((s) => `    - "${s}"`).join("\n");
  return `appName: "${plan.appName}"
oneLiner: "${plan.oneLiner}"
tabs:
${tabs}${details}
contentDomain:
  description: "${plan.contentDomain.description}"
  seedItems:
${seeds}
palette:
  mode: "${plan.palette.mode}"
  background: "${plan.palette.background}"
  surface: "${plan.palette.surface}"
  textPrimary: "${plan.palette.textPrimary}"
  accent: "${plan.palette.accent}"
  personality: "${plan.palette.personality}"`;
}

/**
 * Generate (or edit) one app variant. Streams the model's tool calls; each
 * writeFile lands in the `files` table reactively, so the UI fills in live.
 * Runs as a durable workflow step — safe to retry.
 */
export const runVariant = internalAction({
  args: {
    versionId: v.id("versions"),
    threadId: v.string(),
    promptMessageId: v.string(),
    model: v.string(),
    effort: v.optional(v.string()),
    styleDirective: v.string(),
    userPrompt: v.optional(v.string()), // present on first-gen; absent on edits (plan step skipped)
    isEdit: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; fileCount: number }> => {
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      status: "generating",
    });

    // In edit mode, give the model the current file list as context.
    let existingFiles: string | undefined;
    if (args.isEdit) {
      const files: Doc<"files">[] = await ctx.runQuery(internal.files.snapshot, {
        versionId: args.versionId,
      });
      existingFiles = files
        .filter((f) => !f.deleted)
        .map((f) => `- ${f.path} (${f.purpose})`)
        .join("\n");
    }

    // -----------------------------------------------------------------------
    // Plan step (first-generation only)
    // -----------------------------------------------------------------------
    let planSection: string | undefined;
    if (!args.isEdit) {
      try {
        const conceptLine = args.userPrompt ?? "(no concept provided)";
        const directiveLine = args.styleDirective
          ? `Style directive: "${args.styleDirective}"`
          : "Style directive: none — invent a palette that genuinely fits the concept.";

        const planPrompt = [
          `App concept: "${conceptLine}"`,
          directiveLine,
          "",
          "Generate a concrete app plan for this concept.",
          "- Tabs, screens, and seed items must directly reflect the app concept.",
          "- Seed items must be realistic domain content (never lorem ipsum, never 'Item 1').",
          "- Palette must honour the style directive when one is given; otherwise invent a",
          "  coherent palette that fits the concept's mood (finance = crisp/trustworthy,",
          "  fitness = energetic, meditation = calm/airy, etc.).",
        ].join("\n");

        const { object: plan } = await generateObject({
          model: anthropic(MODEL_SONNET),
          schema: AppPlanSchema,
          prompt: planPrompt,
          maxOutputTokens: 1500,
        });

        planSection = formatPlan(plan);

        // Persist plan JSON on the version row (additive, non-blocking).
        await ctx.runMutation(internal.versions.patch, {
          versionId: args.versionId,
          plan: JSON.stringify(plan),
        });
      } catch (err) {
        console.error("[plan step] generateObject failed — proceeding without APP PLAN:", err);
        // planSection stays undefined; generation continues without it.
      }
    }

    // Build the system prompt as two cache-annotated blocks:
    //   Block 1 (stable)  — SYSTEM_PROMPT + HOUSE_DESIGN_SYSTEM, cached across all
    //                        variants and runs on this model.
    //   Block 2 (volatile) — style directive / plan / edit context, cached across
    //                        all sequential steps of THIS run only.
    const systemBlocks = buildSystemBlocks({
      styleDirective: args.styleDirective,
      isEdit: args.isEdit,
      existingFiles,
      planSection,
    });
    const tools = makeCodegenTools(args.versionId);
    const agent = makeAgent(args.model, tools);

    try {
      // Opus 4.8 supports adaptive-thinking effort; other models reject it, so
      // effortProviderOptions returns undefined and we omit providerOptions.
      const effortOpts = effortProviderOptions(args.model, args.effort);

      // `AgentPrompt.system` is typed as `string` in @convex-dev/agent, but the
      // AI SDK and the Anthropic provider accept `SystemModelMessage[]` at runtime.
      // The cast is safe: the array flows through startGeneration unchanged and
      // lands as the `system` param of AI SDK's streamText.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const genOpts: any = {
        promptMessageId: args.promptMessageId,
        system: systemBlocks,
        ...(effortOpts ? { providerOptions: effortOpts } : {}),
      };
      const result = await agent.streamText(
        ctx,
        { threadId: args.threadId },
        genOpts,
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
    } catch (err) {
      console.error("streamText failed", err);
    }

    // Authoritative gate: the file table is the source of truth.
    let files: Doc<"files">[] = await ctx.runQuery(internal.files.snapshot, {
      versionId: args.versionId,
    });

    // Deterministically heal web-incompat imports (e.g. safe-area APIs pulled
    // from "react-native") before validating + storing, so the very first
    // preview renders on web instead of crashing.
    const fixes = repairFiles(files.filter((f) => !f.deleted));
    if (fixes.length > 0) {
      for (const fix of fixes) {
        await ctx.runMutation(internal.files.upsert, {
          versionId: args.versionId,
          path: fix.path,
          contents: fix.contents,
          purpose: fix.purpose,
        });
      }
      files = await ctx.runQuery(internal.files.snapshot, { versionId: args.versionId });
    }

    const { ok, problems } = validateManifest(files);
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      status: ok ? "ready" : "failed",
      error: ok ? undefined : problems.join("; "),
    });

    return { ok, fileCount: files.filter((f) => !f.deleted).length };
  },
});
