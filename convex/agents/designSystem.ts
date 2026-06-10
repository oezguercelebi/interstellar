/**
 * Interstellar House Design System — injected into every generation run.
 *
 * The verbatim file skeletons (tokens.ts, Screen.tsx, _layout.tsx) have been
 * moved to agents/starterKit.ts and pre-seeded into the files table before
 * the agent runs. This prompt section describes their contracts and the
 * composition rules that govern every screen — it no longer needs to reproduce
 * the code bodies.
 */
export const HOUSE_DESIGN_SYSTEM = `# Design System & Quality Bar

You build a NATIVE-feeling iOS app, not a website in a phone. The STARTER FILES are already in
the project — your job is to fill in product screens, rewrite the palette, and replace the
placeholder tab list. Spend your creativity on content; get infrastructure right by using the
provided components.

## Starter file contracts (already seeded — use them, extend them, rewrite where noted)
- **theme/tokens.ts** — REWRITE the \`palette\` object with the APP PLAN hex values; keep the
  full shape: palette, space (4-pt grid xs→3xl), radius (sm→full), type role objects
  (largeTitle/title/headline/body/subhead/caption — each has fontSize+lineHeight+fontWeight),
  shadow presets, touchTarget=44. Export \`as const\`. Every color, size, and spacing value in
  the whole app flows from this file.
- **components/Screen.tsx** — wrap EVERY screen body in \`<Screen>\`; it handles top (status bar)
  and bottom (home indicator) safe-area insets for free. Use \`scroll={false}\` for fixed layouts.
  NEVER hand-roll \`paddingTop\` for the status bar.
- **components/ui.tsx** — import Card, Row, Button, SectionHeader, EmptyState from here. Extend
  the file freely. All primitives already use tokens; keep that invariant when you add more.
- **app/_layout.tsx** — REWRITE the \`<Tabs.Screen>\` list to match APP PLAN tabs exactly (names,
  Ionicons icon, screen file). Keep \`SafeAreaProvider\`, \`Tabs screenOptions\`, and \`StatusBar\`.
  2–4 tabs. No custom tab bar, no \`paddingBottom\`, no \`position:"absolute"\`.

## Screen structure (every tab screen follows this shape)
1. Wrap body in \`<Screen>\` (handles insets).
2. One HEADER: eyebrow text (type.caption, textSecondary) + display title (type.largeTitle,
   textPrimary). The \`<Screen>\` top padding already clears the status bar — no extra paddingTop.
3. 2–4 SECTIONS: each = a \`<SectionHeader>\` (from ui.tsx) + its cards/rows of seeded content.
   Rhythm: space.xl above each section header, space.md below it, space.md between items.
4. Seeded content must come from APP PLAN contentDomain.seedItems. Minimum density: every screen
   has at least 2 sections with real content — no empty screens, no lone centered elements.

## Composition rules
- **Cards vs Rows**: Card (surface bg, radius.lg, padding space.lg, shadow.card) for rich items
  (image + title + caption, featured stat). Row (min 44pt, leading icon circle + title/caption +
  chevron) for list items. Don't card-wrap every single row.
- **Horizontal scroller**: \`<ScrollView horizontal>\` of ~160–220 px cards for "featured/continue".
- **Stats row**: \`flexDirection:"row"\` of 2–3 equal cards, each a large \`type.title\` number
  + caption label.
- **Hero element**: cap at ~200 px, put it INSIDE a card (never full-bleed behind status bar).
  Optional expo-linear-gradient band INSIDE a rounded card (radius.xl, ~140–180 px height) —
  NOT behind the status bar.
- **EmptyState**: centered icon in a 72 px accentSoft circle + type.title text + type.body caption
  + a Button. NEVER ship a blank screen.

## Component conventions (consuming tokens)
- **Card**: \`backgroundColor: palette.surface, borderRadius: radius.lg, padding: space.lg, ...shadow.card\`
- **Row**: \`flexDirection:"row", alignItems:"center", gap:space.md\`; 40 px icon circle
  (backgroundColor: palette.accentSoft, borderRadius: radius.md); text column
  (title type.headline textPrimary, caption type.caption textSecondary); trailing Ionicons
  chevron-forward textTertiary.
- **Button**: primary = accent fill, accentInk text, borderRadius radius.full, height touchTarget,
  fontWeight 700; expo-haptics on press. Secondary = surface fill + border.
- **Icons**: @expo/vector-icons (Ionicons / Feather), size 20–24, accent or textTertiary.
  Icons over emoji for all chrome elements.
- **Images**: REMOTE only — expo-image \`<Image source={{ uri:"https://images.unsplash.com/..." }}\`
  with explicit width/height/borderRadius. NEVER reference a local asset.

## Safe areas (handled — don't redo it)
- \`<Screen>\` pads top (status bar) + bottom (home indicator) of every screen.
- The built-in \`<Tabs>\` bar handles its own bottom inset and stays tappable.
- \`<SafeAreaProvider>\` is already in app/_layout.tsx — don't add it in screen files.
- Import useSafeAreaInsets/SafeAreaView ONLY from "react-native-safe-area-context".
- Never hardcode inset values (44/47/34) — they vary per device.

## Motion (restrained)
Subtle Reanimated FadeInDown on the header + first cards: 200–350 ms, ease-out, stagger ~40 ms.
Never bouncy springs or durations > 400 ms. Haptics on the key primary action only.

## Quality bar (non-negotiable, whatever the palette)
Generous whitespace with CONSISTENT section rhythm. Crisp hierarchy from the type scale. ONE
confident accent (never a rainbow). Rounded cards with soft shadows. Seeded, believable content
(real names, numbers, copy — from APP PLAN seedItems). Thoughtful empty + loading states on every
async surface. It must feel NATIVE to iOS. Honor the STYLE DIRECTIVE and APP PLAN palette on
EVERY screen — internal consistency is the brand.`;
