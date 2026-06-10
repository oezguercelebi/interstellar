/**
 * Deterministic hex → HSL plumbing for the NativeWind plan step.
 *
 * The nativewind starter kit's `theme/tokens.ts` holds HSL channel triplets
 * ("H S% L%", shadcn-exact — opacity modifiers like bg-primary/50 keep
 * working). The plan step's palette arrives as hex, so `formatPlan`
 * (convex/codegen.ts) appends a `paletteTriplets:` block computed here: the
 * agent copy-pastes exact values into the `c` map and never hand-converts hex.
 *
 * Pure TS — no convex imports — so it stays unit-testable under
 * `node --test --experimental-strip-types` (tests/palette.test.ts) and inside
 * the C3 pure closure (tests/boundaries.test.ts).
 */

/** The plan palette fields the triplet derivation consumes (see AppPlanSchema). */
export interface PlanPalette {
  mode: "light" | "dark";
  background: string; // hex, e.g. "#FFFFFF"
  surface: string; // hex — becomes the `card` slot
  textPrimary: string; // hex — becomes the `foreground` slot
  accent: string; // hex — becomes the `primary` slot
}

interface Hsl {
  h: number; // 0-359 (degrees)
  s: number; // 0-100 (percent)
  l: number; // 0-100 (percent)
}

/**
 * Every slot in the seeded theme/tokens.ts `c` map, in the same order, so the
 * emitted block can be copied straight in (agents/starterKitNativewind.ts and
 * the baked tailwind.config color map must agree with this set).
 */
export const TRIPLET_SLOTS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "success",
  "warning",
  "border",
  "input",
  "ring",
] as const;

export type TripletSlot = (typeof TRIPLET_SLOTS)[number];

/**
 * Parse a hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA — leading "#" optional,
 * alpha ignored) into rounded HSL components. Returns null on malformed input
 * so callers can fall back instead of sinking the whole plan step.
 */
export function parseHexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let digits = m[1].toLowerCase();
  if (digits.length === 4) digits = digits.slice(0, 3); // drop alpha nibble
  if (digits.length === 8) digits = digits.slice(0, 6); // drop alpha byte
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join("");
  if (digits.length !== 6) return null;

  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

const fmt = (c: Hsl): string => `${c.h} ${c.s}% ${c.l}%`;

/** "#3D5AFE" → "231 99% 62%". Throws on malformed input (deterministic otherwise). */
export function hexToHslTriplet(hex: string): string {
  const hsl = parseHexToHsl(hex);
  if (!hsl) throw new Error(`Not a hex color: ${JSON.stringify(hex)}`);
  return fmt(hsl);
}

/**
 * Per-input fallbacks (the seeded tokens.ts defaults) — used only when the
 * plan step emits a malformed hex for that slot, so one bad value never
 * degrades the rest of the derivation.
 */
const FALLBACK: Record<"background" | "surface" | "textPrimary" | "accent", Hsl> = {
  background: { h: 0, s: 0, l: 100 },
  surface: { h: 240, s: 5, l: 98 },
  textPrimary: { h: 240, s: 10, l: 4 },
  accent: { h: 231, s: 99, l: 62 },
};

/**
 * Derive the full 19-slot triplet map from the plan's four hex colors + mode.
 *
 * Direct conversions: background, foreground (textPrimary), card (surface),
 * primary (accent). Everything else is a deterministic HSL-space default:
 *  - secondary/muted: near-neutral of the background hue (l 96 light / 16 dark)
 *  - border/input:    same hue, l 90 light / 24 dark
 *  - accent (tint):   primary hue at l 95 light / 22 dark; accent-foreground a
 *                     readable shade of the same hue
 *  - primary-foreground: white on dark-enough primaries, near-black otherwise
 *  - muted-foreground: desaturated foreground hue at mid lightness
 *  - destructive/success/warning: fixed shadcn-style values (plan hexes carry
 *    no semantics for these)
 *  - ring = primary; *-foreground on background-ish slots = foreground
 */
export function deriveTriplets(palette: PlanPalette): Record<TripletSlot, string> {
  const dark = palette.mode === "dark";
  const bg = parseHexToHsl(palette.background) ?? FALLBACK.background;
  const fg = parseHexToHsl(palette.textPrimary) ?? FALLBACK.textPrimary;
  const card = parseHexToHsl(palette.surface) ?? FALLBACK.surface;
  const primary = parseHexToHsl(palette.accent) ?? FALLBACK.accent;

  const neutralS = Math.min(bg.s, 10);
  const secondary: Hsl = { h: bg.h, s: neutralS, l: dark ? 16 : 96 };
  const border: Hsl = { h: bg.h, s: neutralS, l: dark ? 24 : 90 };

  return {
    background: fmt(bg),
    foreground: fmt(fg),
    card: fmt(card),
    "card-foreground": fmt(fg),
    primary: fmt(primary),
    "primary-foreground": primary.l > 62 ? "0 0% 10%" : "0 0% 100%",
    secondary: fmt(secondary),
    "secondary-foreground": fmt(fg),
    muted: fmt(secondary),
    "muted-foreground": fmt({ h: fg.h, s: Math.min(fg.s, 8), l: dark ? 64 : 46 }),
    accent: fmt({ h: primary.h, s: primary.s, l: dark ? 22 : 95 }),
    "accent-foreground": fmt({ h: primary.h, s: Math.min(primary.s, 80), l: dark ? 90 : 40 }),
    destructive: "0 84% 60%",
    "destructive-foreground": "0 0% 100%",
    success: "142 71% 45%",
    warning: "38 92% 50%",
    border: fmt(border),
    input: fmt(border),
    ring: fmt(primary),
  };
}

/**
 * The `paletteTriplets:` block formatPlan appends for nativewind-kit runs —
 * YAML-ish, same dialect as the rest of the APP PLAN.
 */
export function formatPaletteTriplets(palette: PlanPalette): string {
  const triplets = deriveTriplets(palette);
  const lines = TRIPLET_SLOTS.map((slot) => `  ${slot}: "${triplets[slot]}"`);
  return `paletteTriplets:  # copy these EXACT values into the \`c\` map in theme/tokens.ts\n${lines.join("\n")}`;
}
