/** Shared types across the Interstellar studio UI and Convex backend contracts. */

export type VersionStatus =
  | "pending"
  | "generating"
  | "repairing"
  | "ready"
  | "failed";

/** A generated source file, the source of truth for a version. */
export interface GeneratedFile {
  path: string;
  contents: string;
  purpose: string;
  updatedAt: number;
}

/** One of the parallel design directions a prompt can fan out into. */
export interface VariantStyle {
  key: string;
  name: string;
  blurb: string;
  /** Appended to the agent's house design system to steer the look. */
  directive: string;
  /** Tailwind accent for the variant chip. */
  accent: string;
}

export const VARIANT_STYLES: VariantStyle[] = [
  {
    key: "editorial",
    name: "Calm Editorial",
    blurb: "Airy, typographic, lots of whitespace",
    accent: "var(--ios-blue, #007AFF)",
    directive:
      "Style direction: CALM EDITORIAL. Generous whitespace, large refined typography, muted neutral palette with a single restrained accent, thin dividers, magazine-like hierarchy. Understated and premium.",
  },
  {
    key: "playful",
    name: "Vivid Playful",
    blurb: "Bold color, rounded, friendly",
    accent: "#FF4D00",
    directive:
      "Style direction: VIVID PLAYFUL. Confident saturated colors, big rounded corners, soft shadows, friendly micro-illustrations via icons, energetic gradients used tastefully. Joyful but still clean.",
  },
  {
    key: "midnight",
    name: "Midnight Pro",
    blurb: "Dark, sleek, high-contrast",
    accent: "#A366FF",
    directive:
      "Style direction: MIDNIGHT PRO. Dark theme by default, high contrast, glassy surfaces, neon-tinged accent, crisp data-dense layouts. Feels like a premium pro tool.",
  },
];

/** Single-variant default direction (no extra style steering). */
export const DEFAULT_STYLE: VariantStyle = {
  key: "signature",
  name: "Interstellar Signature",
  blurb: "Our house taste",
  accent: "#FF4D00",
  directive: "",
};
