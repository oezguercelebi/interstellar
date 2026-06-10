import { Agent, createTool, type ToolCtx } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { stepCountIs } from "ai";
import { z } from "zod";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { validateManifest } from "../lib/validate";

/** Build a codegen agent for a given model + system instructions + tools. */
export function makeAgent(
  model: string,
  instructions: string,
  tools: ReturnType<typeof makeCodegenTools>,
) {
  return new Agent(components.agent, {
    name: "Interstellar Codegen",
    languageModel: anthropic(model),
    instructions,
    tools,
    // Allow many writeFile calls + a finalize self-heal loop in a single turn.
    stopWhen: stepCountIs(48),
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
