import { Agent, createTool, type ToolCtx } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { stepCountIs } from "ai";
import type { AnthropicMessageMetadata } from "@ai-sdk/anthropic";
import type { ProviderMetadata } from "ai";
import { z } from "zod";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { validateManifest } from "../lib/validate";

/**
 * Extract and log Anthropic prompt-cache token counts from a step's
 * providerMetadata. Fields surface under `providerMetadata.anthropic` as
 * defined by `AnthropicMessageMetadata` in `@ai-sdk/anthropic`.
 */
function logCacheUsage(providerMetadata: ProviderMetadata | undefined): void {
  if (!providerMetadata) return;
  const meta = providerMetadata.anthropic as unknown as AnthropicMessageMetadata | undefined;
  if (!meta) return;
  // `usage` is typed as JSONObject on AnthropicMessageMetadata; cast to access fields.
  const usage = meta.usage as Record<string, number> | undefined;
  const cacheWrite =
    meta.cacheCreationInputTokens ??
    (usage?.cache_creation_input_tokens ?? 0);
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const uncached = usage?.input_tokens ?? 0;
  console.log(
    `[cache] write=${cacheWrite} read=${cacheRead} uncached=${uncached}`,
  );
}

/**
 * Build a codegen agent for a given model and tools.
 *
 * System instructions are intentionally NOT set here; instead they are
 * passed as `system` on each `streamText` call so we can attach
 * Anthropic cache-control breakpoints (see `buildSystemBlocks` in prompt.ts).
 * Passing the system per-call lets the stable prefix carry a breakpoint that
 * caches tools + system together, and a second breakpoint covers the volatile
 * suffix across all 48 sequential steps within a run.
 */
export function makeAgent(
  model: string,
  tools: ReturnType<typeof makeCodegenTools>,
) {
  return new Agent(components.agent, {
    name: "Interstellar Codegen",
    languageModel: anthropic(model),
    tools,
    // Allow many writeFile calls + a finalize self-heal loop in a single turn.
    stopWhen: stepCountIs(48),
    usageHandler: (_ctx, { providerMetadata }) => {
      // Log Anthropic prompt-cache usage for every step so cache hits are
      // visible in Convex logs. `usageHandler` receives `providerMetadata`
      // which includes `anthropic.cacheCreationInputTokens` / `usage` fields.
      logCacheUsage(providerMetadata);
    },
  });
}

/**
 * Tools the model uses to emit an app. Each is a closure over the target
 * versionId so its handler can write to the right file set. Code exits ONLY
 * through these — which is what makes generation streamable, durable and resumable.
 *
 * (Agent v0.6: tools use `inputSchema` + `execute(ctx, input)`.)
 */
export function makeCodegenTools(versionId: Id<"versions">) {
  const writeFile = createTool({
    description:
      "Write a complete source file to the app. Provide the full final contents — never a diff or placeholder.",
    inputSchema: z.object({
      path: z.string().describe("Repo-relative path, e.g. app/index.tsx or theme/tokens.ts"),
      contents: z.string().describe("The complete file contents"),
      purpose: z.string().describe("Short plain-English label, e.g. 'Home screen'"),
    }),
    execute: async (ctx: ToolCtx, { path, contents, purpose }): Promise<string> => {
      await ctx.runMutation(internal.files.upsert, { versionId, path, contents, purpose });
      return `Wrote ${path}`;
    },
  });

  const deleteFile = createTool({
    description: "Delete a file that is no longer needed.",
    inputSchema: z.object({ path: z.string() }),
    execute: async (ctx: ToolCtx, { path }): Promise<string> => {
      await ctx.runMutation(internal.files.remove, { versionId, path });
      return `Deleted ${path}`;
    },
  });

  const finalize = createTool({
    description:
      "Call once when the app is complete. Validates the app; if it returns problems, fix them and call finalize again.",
    inputSchema: z.object({
      summary: z.string().describe("One-sentence summary of what you built"),
      entryScreens: z.array(z.string()).describe("The main screen names, e.g. ['Home','Detail']"),
    }),
    execute: async (ctx: ToolCtx, { summary, entryScreens }): Promise<string> => {
      const files = await ctx.runQuery(internal.files.snapshot, { versionId });
      const { ok, problems } = validateManifest(files);
      if (!ok) {
        return `NOT READY — fix these and call finalize again:\n- ${problems.join("\n- ")}`;
      }
      await ctx.runMutation(internal.versions.patch, { versionId, summary, entryScreens });
      return "READY ✅ — the app passed validation.";
    },
  });

  return { writeFile, deleteFile, finalize };
}
