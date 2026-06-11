import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decide, HEARTBEAT_STALE_MS } from "./lib/agentRunner/decision";
import type { Doc } from "./_generated/dataModel";
import { makeAgent, makeCodegenTools } from "./agents/codegen";
import { buildSystemBlocks } from "./agents/prompt";
import { validateManifest } from "./lib/validate";
import { formatPaletteTriplets } from "./lib/palette";
import { effortProviderOptions, MODEL_SONNET } from "./lib/styles";
import { repairFiles } from "./lib/webcompat";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

/**
 * Zod schema for the plan step. Kept compact — the model fills this in ~500 tokens.
 * Built per kit (it lives in code, not the cached prompt): only the tab-icon
 * vocabulary differs — Ionicons names for classic, lucide-react-native
 * PascalCase names for nativewind.
 */
const makeAppPlanSchema = (kit: "classic" | "nativewind") =>
  z.object({
    appName: z.string().describe("Short app name (2-4 words)"),
    oneLiner: z.string().describe("One sentence describing the app"),
    tabs: z
      .array(
        z.object({
          name: z.string(),
          icon: z
            .string()
            .describe(
              kit === "nativewind"
                ? "lucide-react-native icon name in PascalCase, e.g. 'House' or 'Search'"
                : "Ionicons icon name, e.g. 'home' or 'search'",
            ),
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
        .min(3)
        // Generous ceiling: models routinely overshoot a tight max and a
        // validation miss costs the whole plan (observed live: 10 items
        // emitted against max(8) -> AI_NoObjectGeneratedError -> planless
        // generation). formatPlan slices to 8.
        .max(20)
        .describe("5-8 realistic example content strings for this app"),
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

type AppPlan = z.infer<ReturnType<typeof makeAppPlanSchema>>;

/**
 * Render the plan as readable YAML-ish text to inject into instructions.
 * For nativewind-kit runs, append the exact HSL channel triplets so the agent
 * copy-pastes them into theme/tokens.ts `c` — it must never hand-convert hex.
 */
function formatPlan(plan: AppPlan, kit: "classic" | "nativewind"): string {
  const tabs = plan.tabs
    .map((t) => `  - name: "${t.name}", icon: "${t.icon}", purpose: "${t.purpose}"`)
    .join("\n");
  const details =
    plan.detailScreens && plan.detailScreens.length > 0
      ? "\ndetailScreens:\n" +
        plan.detailScreens.map((d) => `  - route: "${d.route}", purpose: "${d.purpose}"`).join("\n")
      : "";
  const seeds = plan.contentDomain.seedItems
    .slice(0, 8)
    .map((s) => `    - "${s}"`)
    .join("\n");
  const base = `appName: "${plan.appName}"
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
  if (kit !== "nativewind") return base;
  return `${base}\n${formatPaletteTriplets(plan.palette)}`;
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
    // Starter kit stamped on the version row; optional (absent = classic) so
    // in-flight workflow journals stay valid across the deploy.
    kit: v.optional(v.union(v.literal("classic"), v.literal("nativewind"))),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; fileCount: number; agentLaunched?: boolean }> => {
    const kit = args.kit ?? "classic";
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      status: "generating",
    });

    // Agent-runner gate: if this version was stamped with runner:"agent", hand
    // off to launchAgentRunner instead of running the model inline. Falls back
    // to the legacy path if launchAgentRunner returns launched:false so no
    // existing behavior changes when AGENT_RUNNER is unset.
    const versionForRunner = await ctx.runQuery(internal.versions.getById, { versionId: args.versionId });
    if (versionForRunner?.runner === "agent") {
      const launchResult = await ctx.runAction(internal.preview.launchAgentRunner, {
        versionId: args.versionId,
        isEdit: args.isEdit ?? false,
        kit: args.kit,
        threadId: args.threadId,
        promptMessageId: args.promptMessageId,
        model: args.model,
        effort: args.effort,
        styleDirective: args.styleDirective ?? "",
      });
      if (launchResult.launched) {
        // Schedule a sweep so stale runs get cleaned up
        await ctx.scheduler.runAfter(5 * 60 * 1000, internal.agentBridge.sweepStaleRuns, {});
        return { ok: true, fileCount: 0, agentLaunched: true };
      }
      // Fall through to legacy path
      console.log(`[runVariant] agent launch failed (${launchResult.reason}) — falling back to inline generation`);
    }

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
          "- Provide exactly 5-8 seed items of realistic domain content (never lorem ipsum, never 'Item 1').",
          "- Palette must honour the style directive when one is given; otherwise invent a",
          "  coherent palette that fits the concept's mood (finance = crisp/trustworthy,",
          "  fitness = energetic, meditation = calm/airy, etc.).",
        ].join("\n");

        const { object: plan } = await generateObject({
          model: anthropic(MODEL_SONNET),
          schema: makeAppPlanSchema(kit),
          prompt: planPrompt,
          maxOutputTokens: 1500,
        });

        planSection = formatPlan(plan, kit);

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
      kit,
    });
    const tools = makeCodegenTools(args.versionId, kit);
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

    const { ok, problems } = validateManifest(files, kit);
    await ctx.runMutation(internal.versions.patch, {
      versionId: args.versionId,
      status: ok ? "ready" : "failed",
      error: ok ? undefined : problems.join("; "),
    });

    return { ok, fileCount: files.filter((f) => !f.deleted).length };
  },
});

/**
 * Poll until the external agent runner finishes or is declared dead.
 *
 * Journal-safe: this is a new conditional step and does not affect existing
 * workflow journals (the workflow only calls it when awaitVariant is wired in).
 * Polls every ~12 s using the decision state machine; returns { ok } so the
 * workflow can decide whether to proceed to provisionPreview.
 */
export const awaitVariant = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }): Promise<{ ok: boolean }> => {
    let notFoundCount = 0;
    let attempt = 0;

    while (true) {
      const version = await ctx.runQuery(internal.versions.getById, { versionId });
      if (!version) {
        notFoundCount++;
        if (notFoundCount > 2) throw new Error("version not found after 3 attempts");
        await new Promise((r) => setTimeout(r, 12_000));
        continue;
      }
      notFoundCount = 0;

      const status = version.status;
      // Map version status to JobStatus for the decision machine.
      const jobStatus =
        status === "ready" ? "complete"
        : status === "failed" ? "failed"
        : "running";

      const heartbeatAgeMs = version.agentHeartbeatAt
        ? Date.now() - version.agentHeartbeatAt
        : HEARTBEAT_STALE_MS + 1; // treat missing heartbeat as stale

      const action = decide({
        jobStatus,
        heartbeatAgeMs,
        attempt,
        sandboxState: "unknown", // sandbox state not tracked here; rely on heartbeat
        tscCycle: 0,
        isEdit: false,
        budgetExhausted: false,
        turnLimitReached: false,
        notFoundCount: 0,
      });

      if (action === "complete") return { ok: true };
      if (action === "fail") return { ok: false };
      if (action === "continue") {
        await new Promise((r) => setTimeout(r, 12_000));
        continue;
      }
      // retry-* actions: throw so the workflow step retries.
      attempt++;
      throw new Error(`awaitVariant retry triggered: ${action}`);
    }
  },
});
