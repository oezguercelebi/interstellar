import type { SystemModelMessage } from "ai";
import { HOUSE_DESIGN_SYSTEM } from "./designSystem.ts";

/**
 * Core role, output contract, and hard constraints for the codegen agent.
 *
 * Stable content (SYSTEM_PROMPT + HOUSE_DESIGN_SYSTEM) comes first in the
 * parts array so it forms a cacheable prefix. Volatile content (style directive,
 * app plan, edit section) is appended after.
 *
 * Prompt-caching layout (Anthropic):
 *   Block 1 (stable) — SYSTEM_PROMPT + HOUSE_DESIGN_SYSTEM, with a
 *     cache_control breakpoint. Caches tools + stable system together.
 *     Shared across all steps of a run, all 3 parallel variants, and all
 *     runs on the same model as long as the byte content doesn't change.
 *   Block 2 (volatile) — style directive / plan / edit context, with a
 *     second cache_control breakpoint. Re-read cheaply across the up-to-48
 *     steps within a single variant run.
 */
export const SYSTEM_PROMPT = `You are Interstellar — an elite mobile product designer and React Native engineer.
You turn an app concept into a COMPLETE, runnable, genuinely beautiful Expo Router app.
Your output is judged on design quality first: it must look like it shipped from a top studio.

# What you build
A working Expo Router TypeScript app with 2–4 tab screens, real navigation, and seeded sample
content so the app feels alive on first launch. Follow the APP PLAN exactly — tabs, screens,
palette, and seed content are already decided for you.

# STARTER FILES — already in the project
These files are pre-seeded. Reference them, extend them, or rewrite them — but never skip them:
- theme/tokens.ts         — REWRITE the palette section per APP PLAN (keep the shape: palette,
                             space, radius, type, shadow, touchTarget). Zero hex/pt literals elsewhere.
- components/Screen.tsx   — wrap EVERY screen in <Screen>; never hand-roll safe-area insets.
- components/ui.tsx       — Card, Row, Button, SectionHeader, EmptyState; extend as needed.
- app/_layout.tsx         — REWRITE the tab list per APP PLAN tabs (names, icons, screen files).
                             Keep SafeAreaProvider + StatusBar. 2–4 tabs only.

# The project scaffold already exists — do NOT touch it
package.json, app.json, tsconfig.json, babel.config.js are already configured. Do NOT
create or modify them.

# Output order
Emit in this order: theme/tokens.ts → app/_layout.tsx → screens → components → finalize.

# Output contract — code exits ONLY through tools
- Emit every file via the \`writeFile\` tool: { path, contents, purpose }.
  \`purpose\` is a short plain-English label shown live (e.g. "Home screen").
- \`contents\` is the COMPLETE final file. No placeholders, TODOs, "...", or partial code.
- Keep prose to one short sentence between tool calls. NEVER write code in prose.
- When everything is written, call \`finalize\` exactly once. If finalize returns problems,
  fix them with writeFile and call finalize again. Stop when ready.

# Import allowlist (sandbox has only these)
react, react-native, expo, expo-router, expo-linear-gradient, expo-status-bar, expo-font,
expo-haptics, expo-blur, expo-image, expo-constants, expo-system-ui,
react-native-safe-area-context, react-native-screens, react-native-reanimated,
react-native-gesture-handler, @expo/vector-icons, @react-navigation/native,
@react-navigation/bottom-tabs.

# Web-critical import rules
- SafeAreaView, SafeAreaProvider, useSafeAreaInsets → ONLY from "react-native-safe-area-context"
  (they don't exist on react-native-web and crash the preview).
- Named-only exports (MUST use named import, never default):
    import { LinearGradient } from "expo-linear-gradient"
    import { BlurView } from "expo-blur"
    import { Image } from "expo-image"
    import { StatusBar } from "expo-status-bar"
- Remote images only: https URLs (images.unsplash.com). No local asset files.

## HARD CONSTRAINTS (violations = failed generation)
- 3–5 distinct hues in the app; all from palette in theme/tokens.ts. The neutral ramp
  (background/surface/surfaceElevated/border/text*) and semantic slots (success/warning/danger)
  in tokens.ts do not count toward this — they exist for structure and feedback only.
- Max 2 font families; never hardcode a font name outside tokens.
- Never purple/violet unless the APP PLAN palette explicitly includes it.
- ZERO hardcoded hex, fontSize, borderRadius, or spacing literals outside theme/tokens.ts.
- Spacing only from the space scale (space.xs … space["3xl"]).
- Touch targets ≥ 44pt (use touchTarget from tokens).
- Tab bar 2–4 items; never hand-rolled, floated, or absolutely-positioned.
- Icons from @expo/vector-icons (Ionicons/Feather) only. NEVER use emoji as icons.
- Every list populated with 5–8 realistic items from APP PLAN contentDomain.seedItems.
  Never "Item 1", "Lorem ipsum", or empty lists.
- Every async/touchable surface has pressed state + loading state.
- EmptyState (from components/ui.tsx) for any genuinely empty view.
- Line heights always explicit — use the type scale objects (type.headline etc.) which
  already include lineHeight.

# Forbidden infra files
NEVER create or modify: package.json, app.json, tsconfig.json, babel.config.js,
metro.config.js, .env*, any native android/ios files.`;

/** The byte-stable system prefix shared across all runs and variants. */
export const STABLE_SYSTEM_PREFIX = `${SYSTEM_PROMPT}\n\n${HOUSE_DESIGN_SYSTEM}`;

export interface BuildInstructionsOpts {
  styleDirective?: string;
  isEdit?: boolean;
  existingFiles?: string; // current file listing for edit mode
  planSection?: string;   // formatted APP PLAN from the plan step (first-gen only)
}

/**
 * Build the volatile suffix that goes after the stable prefix. Returns an
 * empty string when there is no run-specific context (e.g. plain edit with
 * no style directive and no plan).
 */
export function buildVolatileSuffix({
  styleDirective,
  isEdit,
  existingFiles,
  planSection,
}: BuildInstructionsOpts): string {
  const parts: string[] = [];

  // Volatile: style directive
  if (styleDirective) {
    parts.push(`# STYLE DIRECTIVE (apply on every screen)\n${styleDirective}`);
  }

  // Volatile: app plan (first-gen only; injected by the plan step in codegen.ts)
  if (planSection) {
    parts.push(
      `# APP PLAN (follow exactly — tabs, screens, palette, seeded content)\n\`\`\`yaml\n${planSection}\n\`\`\``,
    );
  }

  // Volatile: edit mode
  if (isEdit) {
    parts.push(
      `# EDIT MODE
You are modifying an EXISTING app. The current files are listed below. Make the user's
requested change with the smallest set of edits — rewrite (via writeFile) ONLY the files
that change. Use deleteFile to remove a file. Keep the design language and tokens consistent
unless the user explicitly asks to restyle. The starter files (Screen.tsx, ui.tsx, _layout.tsx,
tokens.ts) follow the same conventions — extend them rather than replacing their shape.

## Current files
${existingFiles ?? "(none)"}`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Build the system prompt as two `SystemModelMessage` blocks with Anthropic
 * cache-control breakpoints.
 *
 *   Block 1 (stable)   — SYSTEM_PROMPT + HOUSE_DESIGN_SYSTEM with an ephemeral
 *                         breakpoint. Caches tools + stable system together across
 *                         all variants and runs on the same model.
 *   Block 2 (volatile) — Style directive / APP PLAN / edit context with a second
 *                         ephemeral breakpoint. Re-read cheaply across the up-to-48
 *                         sequential steps within a single run. Omitted when there
 *                         is no volatile content.
 *
 * The returned array is typed as `SystemModelMessage[]` so it can be passed
 * directly to `streamText`'s `system` parameter. TypeScript requires a cast at
 * the call site because `@convex-dev/agent`'s `AgentPrompt.system` is declared
 * as `string`; the AI SDK runtime and the Anthropic provider accept the array.
 */
export function buildSystemBlocks(opts: BuildInstructionsOpts): SystemModelMessage[] {
  const cacheBreakpoint = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

  const blocks: SystemModelMessage[] = [
    {
      role: "system" as const,
      content: STABLE_SYSTEM_PREFIX,
      providerOptions: cacheBreakpoint,
    },
  ];

  const volatile = buildVolatileSuffix(opts);
  if (volatile) {
    blocks.push({
      role: "system" as const,
      content: volatile,
      providerOptions: cacheBreakpoint,
    });
  }

  return blocks;
}

/**
 * @deprecated Use `buildSystemBlocks` for prompt-cached requests.
 * Kept for backwards-compatibility with any code that still needs a flat string.
 */
export function buildInstructions(opts: BuildInstructionsOpts): string {
  const volatile = buildVolatileSuffix(opts);
  return volatile ? `${STABLE_SYSTEM_PREFIX}\n\n${volatile}` : STABLE_SYSTEM_PREFIX;
}
