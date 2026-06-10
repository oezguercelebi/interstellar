/** Client mirror of the design themes (labels + swatch for the composer picker). */

export interface ThemeOption {
  id: string;
  name: string;
  blurb: string;
  /** A representative swatch color for the chip/dot. */
  swatch: string;
  /** Optional second stop to render a gradient dot (auto uses a rainbow hint). */
  swatch2?: string;
  dark?: boolean;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "auto", name: "Auto", blurb: "Let the AI design a fitting identity", swatch: "#FF4D00", swatch2: "#58A6FF" },
  { id: "signature", name: "Flight Manual", blurb: "Paper, ink, one signal orange", swatch: "#FF4D00" },
  { id: "editorial", name: "Calm Editorial", blurb: "Muted, magazine-like, airy", swatch: "#C2603F" },
  { id: "midnight", name: "Midnight", blurb: "Dark, sleek, indigo accent", swatch: "#7C8CF8", dark: true },
  { id: "playful", name: "Vivid Playful", blurb: "Energetic, bold, rounded", swatch: "#FF6B4A" },
  { id: "mono", name: "Minimal Mono", blurb: "Near-monochrome, Swiss precision", swatch: "#0A0A0A" },
];

export const DEFAULT_THEME = "auto";

export function themeOption(id?: string): ThemeOption {
  return THEME_OPTIONS.find((t) => t.id === id) ?? THEME_OPTIONS[0];
}
