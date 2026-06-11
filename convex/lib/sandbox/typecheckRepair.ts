/**
 * Sandbox type-check repair loop (§5 of .tm/research/firstgen-conclusions.md).
 *
 * After a generated Expo app is uploaded into the sandbox and Metro is running,
 * this module runs `tsc --noEmit` in the sandbox, and if it reports errors:
 *   1. Parses the output to find the implicated source files.
 *   2. Makes ONE bounded model call (generateObject) with the errors + file
 *      contents, asking for fixed whole-file rewrites.
 *   3. Persists the fixes back to the files table and re-uploads them so Metro
 *      hot-reloads the corrected code.
 *
 * Design constraints:
 *   - Strictly best-effort: any failure logs a warning and returns — the preview
 *     as-is is always the worst case, never a broken provision.
 *   - One model pass, bounded inputs: ≤50 error lines, ≤8 implicated files.
 *   - Fixed files must be a strict subset of the implicated set; the repair may
 *     never create new files or touch infra files (package.json, app.json,
 *     tsconfig.json, babel/metro configs).
 *   - No new dependencies — uses generateObject from "ai" + anthropic() from
 *     "@ai-sdk/anthropic" exactly as convex/codegen.ts does.
 *
 * This module has NO Convex imports so the pure helpers (parseTscOutput,
 * buildRepairPrompt, selectImplicatedFiles) can be unit-tested without Convex.
 */

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { MODEL_SONNET } from "../styles.ts";
import type { AppFile } from "./types";
import { FORBIDDEN_PATHS } from "../agentRunner/forbidden.ts";
// Re-export so existing imports of FORBIDDEN_PATHS from this module keep working.
export { FORBIDDEN_PATHS };

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of tsc error lines fed to the model. */
export const MAX_ERROR_LINES = 50;

/** Maximum number of implicated files fed to the model. */
export const MAX_IMPLICATED_FILES = 8;

// ── tsc output parsing ────────────────────────────────────────────────────────

/**
 * Parsed representation of a tsc diagnostic line.
 * tsc --pretty false emits lines like:
 *   app/index.tsx(12,5): error TS2345: Argument of type ...
 */
export interface TscError {
  filePath: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

/**
 * Parse `tsc --noEmit --pretty false` output into structured errors.
 * Lines that don't match the diagnostic pattern are silently skipped.
 */
export function parseTscOutput(output: string): TscError[] {
  const errors: TscError[] = [];
  // Pattern: <path>(<line>,<col>): error TS<code>: <message>
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    const m = re.exec(line);
    if (!m) continue;
    errors.push({
      filePath: m[1].trim(),
      line: parseInt(m[2], 10),
      col: parseInt(m[3], 10),
      code: m[4],
      message: m[5].trim(),
    });
  }
  return errors;
}

/**
 * Extract unique file paths from parsed errors, capped at MAX_IMPLICATED_FILES.
 * Normalises paths: strips a leading "./" so they match AppFile.path keys.
 * Filters out forbidden infra files.
 */
export function selectImplicatedFiles(
  errors: TscError[],
  maxFiles = MAX_IMPLICATED_FILES,
): string[] {
  const seen = new Set<string>();
  for (const e of errors) {
    const normalised = e.filePath.replace(/^\.\//, "");
    if (!FORBIDDEN_PATHS.has(normalised)) seen.add(normalised);
    if (seen.size >= maxFiles) break;
  }
  return [...seen];
}

/**
 * Build the repair prompt content to feed to the model.
 * Exported for unit-testing.
 */
export function buildRepairPrompt(
  errorLines: string,
  implicatedFiles: AppFile[],
): string {
  const fileBlock = implicatedFiles
    .map((f) => `=== ${f.path} ===\n${f.contents}`)
    .join("\n\n");

  return `You are fixing TypeScript errors in a React Native / Expo app.
Return whole-file rewrites for ONLY the files that need changes.
Do NOT modify package.json, app.json, tsconfig.json, babel.config.*, or metro.config.*.
Do NOT add new files. Only return files from the list provided.

## TypeScript errors (tsc --noEmit --pretty false)

${errorLines}

## Source files

${fileBlock}`;
}

// ── Zod schema for the model response ────────────────────────────────────────

const RepairResponseSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().describe("Repo-relative path, e.g. app/index.tsx"),
        contents: z.string().describe("Full corrected file contents"),
      }),
    )
    .describe("Only files that needed changes; no new files"),
});

// ── Model repair call ─────────────────────────────────────────────────────────

/**
 * Call the model to repair TypeScript errors.
 * Returns only the files whose paths were in `implicatedPaths` and are not
 * forbidden — the model is instructed not to stray, but we guard defensively.
 */
export async function callRepairModel(
  errorBlock: string,
  filesToFix: AppFile[],
): Promise<AppFile[]> {
  const prompt = buildRepairPrompt(errorBlock, filesToFix);
  const implicatedSet = new Set(filesToFix.map((f) => f.path));

  const { object } = await generateObject({
    model: anthropic(MODEL_SONNET),
    schema: RepairResponseSchema,
    maxOutputTokens: 16_000,
    messages: [{ role: "user", content: prompt }],
  });

  // Defensive filter: only accept files in the implicated set, never forbidden paths.
  return object.files.filter(
    (f) => implicatedSet.has(f.path) && !FORBIDDEN_PATHS.has(f.path),
  );
}

// ── Truncation helper ─────────────────────────────────────────────────────────

/**
 * Truncate tsc output to at most `maxLines` diagnostic lines.
 * Returns the truncated string and a note if lines were dropped.
 */
export function truncateErrorOutput(
  output: string,
  maxLines = MAX_ERROR_LINES,
): string {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length <= maxLines) return lines.join("\n");
  const truncated = lines.slice(0, maxLines);
  truncated.push(`... (${lines.length - maxLines} more errors truncated)`);
  return truncated.join("\n");
}
