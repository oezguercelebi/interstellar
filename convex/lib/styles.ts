/** Model ids, effort gating, and the design theme registry. Convex-local (no Next imports). */

export const MODEL_OPUS = "claude-opus-4-8";
export const MODEL_SONNET = "claude-sonnet-4-6";
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";

/** The user-selectable model tiers (shown in the chat composer). */
export const MODELS = [MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS] as const;
export type ModelId = (typeof MODELS)[number];

/** Default tier — Sonnet: balanced taste for ~1/5 the cost of Opus. */
export const DEFAULT_MODEL: ModelId = MODEL_SONNET;

export function isModelId(m: string): m is ModelId {
  return (MODELS as readonly string[]).includes(m);
}

/**
 * Effort only applies to Opus 4.8 (adaptive thinking via output_config.effort).
 * Sonnet/Haiku reject the param, so we only forward it for Opus.
 */
export function supportsEffort(model: string): boolean {
  return model === MODEL_OPUS;
}

/** The Anthropic providerOptions for a model+effort, or undefined when N/A. */
export function effortProviderOptions(
  model: string,
  effort?: string,
): Record<string, unknown> | undefined {
  if (!supportsEffort(model) || !effort) return undefined;
  return { anthropic: { effort } };
}

export interface VariantSpec {
  key: string;
  name: string;
  directive: string;
}

/**
 * Design themes. "auto" (default) lets the model invent a palette + personality
 * that fits the app concept — Interstellar is no longer locked to one look. The
 * presets pin a specific identity. Each `directive` is appended to the prompt as
 * the STYLE DIRECTIVE; the neutral house system supplies the token shape.
 */
export interface ThemeSpec {
  key: string;
  name: string;
  directive: string;
}

const AUTO_DIRECTIVE = `Auto — YOU choose the design identity. Read the app concept and invent a palette and
personality that genuinely fits it (e.g. a finance app feels trustworthy and crisp; a kids
app feels playful; a meditation app feels calm and airy; a developer tool feels precise and
dark). Pick ONE confident accent colour, a coherent neutral scale, a mood for radii (tight &
technical vs soft & friendly), and a hero gradient that matches. Do NOT default to pink unless
the concept truly calls for it. Commit fully and apply it consistently on every screen.`;

export const THEMES: ThemeSpec[] = [
  { key: "auto", name: "Auto", directive: AUTO_DIRECTIVE },
  {
    key: "signature",
    name: "Flight Manual",
    directive:
      "Flight Manual: paper bg #F5F4F0, ink text #16181B, surface #FCFBF8, ONE signal accent #FF4D00 (International Orange) used sparingly for primary actions and live state, flat colors (no gradients), hairline borders, mono-spaced micro-labels, precise aerospace-documentation calm.",
  },
  {
    key: "editorial",
    name: "Calm Editorial",
    directive:
      "Calm Editorial: accent #C2603F (terracotta), lots of whitespace, heavy display weights, muted warm neutrals, magazine-like restraint, minimal gradients.",
  },
  {
    key: "midnight",
    name: "Midnight",
    directive:
      "Midnight Pro: DARK — bg #0E0E11, surface #18181D, surfaceAlt #202028, border #26262C, text #F5F5F7, textDim #A0A0AB, accent #7C8CF8 (indigo), glowing soft shadows, sleek and premium.",
  },
  {
    key: "playful",
    name: "Vivid Playful",
    directive:
      "Vivid Playful: accent #FF6B4A, large radii (radius.xl everywhere), bold confident gradients, energetic and friendly, generous rounded shapes.",
  },
  {
    key: "mono",
    name: "Minimal Mono",
    directive:
      "Minimal Mono: near-monochrome — bg #FFFFFF, surface #FAFAFA, text #0A0A0A, a restrained type-led layout, ONE small accent (#0A0A0A or a single muted hue) used sparingly, tight radii, Swiss/utilitarian precision.",
  },
];

export const DEFAULT_THEME = "auto";

export function isThemeKey(k: string): boolean {
  return THEMES.some((t) => t.key === k);
}

function themeByKey(key: string): ThemeSpec {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}

/**
 * The STYLE DIRECTIVE for one variant of a build. For multi-variant builds we
 * nudge each variant toward a DISTINCT interpretation so "3 variations" actually
 * looks different — auto fans across aesthetic lanes; a preset explores three
 * takes within its family.
 */
export function themeDirective(
  themeKey: string,
  opts: { index: number; count: number },
): string {
  const theme = themeByKey(themeKey);
  if (opts.count <= 1) return theme.directive;

  if (theme.key === "auto") {
    const lanes = [
      "Lane 1: light & warm, friendly and approachable.",
      "Lane 2: dark & sleek, premium and focused.",
      "Lane 3: bold & vivid, energetic with a strong accent.",
    ];
    return `${theme.directive}\n\nThis is variant ${opts.index + 1} of ${opts.count} — make it visibly DISTINCT from the others. ${lanes[opts.index % lanes.length]}`;
  }
  return `${theme.directive}\n\nThis is variant ${opts.index + 1} of ${opts.count} — keep the theme's identity but explore a distinct interpretation (different layout emphasis, gradient, or accent intensity) from the other variants.`;
}

/** A short display label for a stored theme key. */
export function themeName(themeKey?: string): string {
  return themeByKey(themeKey ?? DEFAULT_THEME).name;
}

/** How many variants to generate for a given count (style now comes from theme). */
export function pickVariants(count: number): VariantSpec[] {
  return Array.from({ length: count >= 3 ? 3 : 1 }, (_, i) => ({
    key: `v${i}`,
    name: `Variant ${i + 1}`,
    directive: "",
  }));
}

/** A short, human project title from the prompt. */
export function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  const firstClause = cleaned.split(/[.,\n]/)[0];
  const title = firstClause.length > 48 ? firstClause.slice(0, 46).trimEnd() + "…" : firstClause;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
