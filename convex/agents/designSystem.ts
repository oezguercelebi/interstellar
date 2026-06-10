/**
 * The Interstellar House Design System — injected into the agent's system prompt.
 *
 * Encodes taste principles (hierarchy, depth, restraint, craft) WITHOUT locking
 * a single palette. The concrete colour + personality come from the STYLE DIRECTIVE,
 * so each app can have its own identity — "Auto" lets the model invent a fitting one;
 * a preset pins a specific look.
 */
export const HOUSE_DESIGN_SYSTEM = `# Design System & Quality Bar

You express ALL design through a single \`theme/tokens.ts\` (emit it FIRST) — every
screen and component imports from it; NEVER hardcode a hex, spacing, or radius
anywhere else. The STYLE DIRECTIVE below decides the palette + personality; this
section defines the SHAPE of the tokens and the quality bar that never changes.

\`\`\`ts
// theme/tokens.ts — emit THIS shape, with values chosen per the STYLE DIRECTIVE.
export const palette = {
  bg: "...", surface: "...", surfaceAlt: "...", border: "...",
  text: "...", textDim: "...", textFaint: "...",
  accent: "...", accentInk: "...", accentSoft: "...", // ONE confident accent + its ink + a soft tint
  success: "...", warning: "...", danger: "...",
};
export const gradients = { hero: ["...", "..."] as const }; // a tasteful 2-stop hero gradient
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 }; // tune to the directive's mood
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: "800" as const, letterSpacing: -0.5 },
  title:   { fontSize: 22, lineHeight: 28, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  body:    { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
};
export const shadow = {
  card:     { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  floating: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
};
\`\`\`

## Component conventions
- Cards: \`surface\` bg, radius.lg, shadow.card, space.lg padding. Never raw text floating on \`bg\`.
- Buttons: primary = accent fill / accentInk text, radius.pill, height 52, weight 700; expo-haptics on press. Secondary = surfaceAlt fill.
- Headers: large type.display, generous top padding below the safe area. Consider one expo-linear-gradient hero band on the main screen when it fits the mood.
- Icons: @expo/vector-icons (Ionicons / Feather), 20–24, accent or textDim.
- Lists: FlatList; card-like rows with a leading icon, title (type.heading), caption, trailing chevron. Separate with spacing, not hairlines.
- Tab bars: a custom floating rounded bar (shadow.floating), active tab in accent, inactive in textFaint.
- Empty states: a centered icon inside an accentSoft circle + friendly title/caption + a primary CTA. NEVER ship a blank screen.
- Motion: subtle Reanimated FadeInDown / FadeIn entrances on mount. Haptics on the key action. Tasteful, never bouncy.
- Always wrap the app in SafeAreaProvider and use useSafeAreaInsets — nothing hides under the notch or home indicator.
- Imagery: REMOTE images only (Image source={{ uri: "https://images.unsplash.com/..." }}). NEVER reference local asset files.
- Icons over emoji for UI chrome (greetings, badges, buttons, empty states). A literal emoji is fine only as plain text content, never as the sole content of an icon slot.

## Quality bar (this is the product — non-negotiable, whatever the palette)
Generous whitespace. Crisp hierarchy. ONE confident accent (never a rainbow). Rounded
cards with soft layered shadows (never flat views on a flat background). A real type scale.
Thoughtful empty + loading states. SEEDED sample content so the app looks alive on first
launch (real-sounding names, numbers, copy — not "Lorem ipsum" or "Item 1"). At least one
gradient / icon / motion touch per screen that signals craft. It must feel NATIVE to iOS —
not a website stuffed into a phone. Internal consistency is the brand: honor the STYLE
DIRECTIVE on EVERY screen.`;
