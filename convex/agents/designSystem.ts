/**
 * The Interstellar House Design System — injected into the agent's system prompt.
 *
 * Strategy: hand the model a finished-looking SKELETON (real reference code grounded in
 * production Expo apps — obytes/react-native-template-obytes + expo/examples), not a list of
 * principles. The infrastructure is correct BY CONSTRUCTION: a required <Screen> wrapper
 * applies the top + bottom safe-area insets so a title can never hide behind the status bar
 * and content can never clip under the tab bar, and navigation is the built-in <Tabs> bar
 * (auto-handles the home indicator, always tappable). The model copies these verbatim and
 * spends its effort on content; the STYLE DIRECTIVE (injected after) overrides the palette.
 */
export const HOUSE_DESIGN_SYSTEM = `# Design System & Quality Bar

You build a NATIVE-feeling iOS app, not a website in a phone. COPY THE REFERENCE SKELETON
BELOW — same files, same navigation, same <Screen> wrapper, same screen shape — then fill in
the content. The infrastructure is not yours to invent; get it right by copying, and spend your
creativity on the screens. The STYLE DIRECTIVE picks the palette and personality.

## Golden rules (break these and the app looks broken)
1. Navigation = the built-in expo-router \`<Tabs>\` bar. It auto-handles the top + bottom safe
   areas and is always tappable. NEVER hand-roll, float, or absolutely-position a tab bar.
2. EVERY screen's body is wrapped in the \`<Screen>\` component below — it applies the status-bar
   (top) and home-indicator (bottom) insets for you. NEVER put content at the raw top edge, and
   NEVER place a full-bleed gradient/image behind the status bar.
3. Every screen = a HEADER block + 2–4 labeled SECTIONS of real, seeded content. Never one giant
   centered element on an empty screen.
4. All colors / spacing / radius / type come from \`theme/tokens.ts\`. NEVER hardcode a hex.

## Files to emit (in this order)
1. \`theme/tokens.ts\`       — design tokens (emit FIRST; real values, per the directive)
2. \`components/Screen.tsx\` — the safe-area wrapper (copy VERBATIM; every screen uses it)
3. \`app/_layout.tsx\`       — the root \`<Tabs>\` navigator (copy; swap colors/icons/screens)
4. \`app/index.tsx\`         — main tab screen (copy the screen scaffold)
5. \`app/<name>.tsx\`        — 1–2 more tab screens (2–4 tabs total)
6. \`components/*.tsx\`       — reusable Card / Row / SectionHeader / Button / EmptyState

(Adaptive: for a single-purpose app — a timer, one form — a root \`<Stack>\` with just
\`app/index.tsx\` is fine. The \`<Screen>\` wrapper and screen shape stay identical.)

## theme/tokens.ts — emit FIRST, with REAL values (known-good dark set; retune to the directive)
\`\`\`ts
export const palette = {
  bg: "#0B0B0F", surface: "#16161D", surfaceAlt: "#1F1F29", border: "#2A2A36",
  text: "#F5F5F7", textDim: "#A0A0AD", textFaint: "#6B6B78",
  accent: "#7C5CFF", accentInk: "#FFFFFF", accentSoft: "#211B3D",
  success: "#34C759", warning: "#FFB020", danger: "#FF453A",
};
export const gradients = { hero: ["#7C5CFF", "#4B2FCC"] as const };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 };
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: "800" as const, letterSpacing: -0.5 },
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

## components/Screen.tsx — COPY VERBATIM. This makes top + bottom safe areas correct for free.
\`\`\`tsx
import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, space } from "../theme/tokens";

/** Wraps every screen. Pads the status bar (top) + home indicator (bottom) so content is
 *  never hidden. Scrolls by default. Use scroll={false} for a fixed full-height screen. */
export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: insets.top + space.lg,
    paddingBottom: insets.bottom + space.xxl,
    paddingHorizontal: space.lg,
  };
  if (!scroll) return <View style={[styles.root, pad]}>{children}</View>;
  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={pad}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: palette.bg } });
\`\`\`

## app/_layout.tsx — root Tabs (copy; swap colors from tokens, icons, and screen names)
\`\`\`tsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "../theme/tokens";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: palette.accent,
          tabBarInactiveTintColor: palette.textFaint,
          tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} /> }} />
        <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} /> }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} /> }} />
      </Tabs>
      <StatusBar style="light" /> {/* "light" on a dark bg, "dark" on a light bg */}
    </SafeAreaProvider>
  );
}
\`\`\`
2–4 tabs. The built-in bar already insets above the home indicator and is tappable — do NOT add
\`paddingBottom\`, \`position: "absolute"\`, margins, or a custom bar. Pick a fitting Ionicons name
per tab (home, search, albums, person, settings, heart, calendar, wallet, stats-chart, …).

## Screen scaffold — EVERY tab screen follows this exact shape (copy, then fill sections)
\`\`\`tsx
import { View, Text, StyleSheet } from "react-native";
import { Screen } from "../components/Screen";
import { palette, space, type } from "../theme/tokens";

export default function HomeScreen() {
  return (
    <Screen>
      {/* HEADER — the <Screen> wrapper already clears the status bar */}
      <Text style={s.eyebrow}>GOOD MORNING</Text>
      <Text style={s.title}>Today</Text>

      {/* SECTION 1 */}
      <Text style={s.section}>Overview</Text>
      {/* …a stats row or a hero card (≤200px) here… */}

      {/* SECTION 2 */}
      <Text style={s.section}>Recent</Text>
      {/* …a list of rows here… */}
    </Screen>
  );
}

const s = StyleSheet.create({
  eyebrow: { ...type.caption, color: palette.textDim, letterSpacing: 1 },
  title: { ...type.display, color: palette.text, marginTop: space.xs, marginBottom: space.xl },
  section: { ...type.heading, color: palette.text, marginTop: space.xl, marginBottom: space.md },
});
\`\`\`
Fixed rhythm: \`space.xl\` above each section header, \`space.md\` below it, \`space.md\` between
cards/rows in a section. This rhythm alone makes a screen look composed.

## Composition rules (kill the "empty / giant / generic" look)
- NEVER leave large empty space. < 2 sections of real content? ADD content: a stats row, a
  featured card, a horizontal scroller, a list — seeded with believable data.
- One HEADER per screen (eyebrow + display title). Then 2–4 SECTIONS, each = a \`type.heading\`
  label + its cards/rows. That is the minimum density.
- A single hero (progress ring, big number, chart) must NOT own the whole screen: cap it at
  ~200px tall, put it INSIDE a card (never full-bleed behind the status bar), and ALWAYS follow
  it with at least one more section below.
- Cards vs rows: a CARD (surface bg, radius.lg, padding space.lg, shadow.card) for rich items
  (image + title + caption, or a featured stat). A ROW (~64px, leading icon in an accentSoft
  circle + title + caption + trailing chevron) for list items. Group rows in one surface or
  separate them with \`space.md\` — don't card-wrap every single row.
- Horizontal scroller for "featured/continue": \`<ScrollView horizontal>\` of ~160–220px cards.
- Stats: a \`flexDirection: "row"\` of 2–3 equal cards, each a big \`type.title\` number + caption.

## Component conventions
- Card: \`backgroundColor: surface, borderRadius: radius.lg, padding: space.lg, ...shadow.card\`.
- Row: \`flexDirection: "row", alignItems: "center", gap: space.md\`; leading icon (20–24, accent)
  in a 40px accentSoft circle; text column (title \`type.heading\`, caption \`type.caption\` textDim);
  trailing \`<Ionicons name="chevron-forward" color={textFaint} />\`.
- Button: primary = accent fill, accentInk text, \`borderRadius: radius.pill\`, height 52, weight 700,
  centered; \`expo-haptics\` (Haptics.impactAsync) on press. Secondary = surfaceAlt fill.
- EmptyState: centered icon in a 72px accentSoft circle + \`type.title\` line + \`type.body\` textDim
  caption + a primary button. NEVER ship a blank screen.
- Icons: @expo/vector-icons (Ionicons / Feather), 20–24, accent or textDim. Icons over emoji for chrome.
- Images: REMOTE only via expo-image \`<Image source={{ uri: "https://images.unsplash.com/..." }} />\`
  with explicit width/height/borderRadius. NEVER reference a local asset file.
- Optional hero band: a short expo-linear-gradient (gradients.hero) INSIDE a rounded card in the
  first section (radius.xl, ~140–180px) — NOT behind the status bar. The <Screen> top padding stays.

## Safe areas — handled by <Screen> + built-in <Tabs> (don't redo it)
- Root wraps once in \`<SafeAreaProvider>\` + \`<StatusBar style="light"|"dark" />\` (matches bg).
- \`<Screen>\` pads the top (status bar) and bottom (home indicator) of every screen.
- The built-in \`<Tabs>\` bar handles its own bottom inset and stays tappable.
- Import SafeAreaView / SafeAreaProvider / useSafeAreaInsets ONLY from
  "react-native-safe-area-context" — NEVER from "react-native" (undefined on web → crash).
- Don't hardcode 44 / 47 / 34 — insets are correct per device and per platform (Android too).

## Motion (restrained)
Subtle Reanimated FadeInDown entrances on the header + first cards, 200–350ms, eased, stagger ~40ms.
Never bouncy springs or long durations (janky on web). Haptics on the key action only.

## Quality bar (non-negotiable, whatever the palette)
Generous whitespace with a CONSISTENT section rhythm. Crisp hierarchy from the type scale. ONE
confident accent (never a rainbow). Rounded cards with soft shadows — never flat views on a flat
background. SEEDED, believable sample content (real-sounding names, numbers, copy — never "Item 1"
or "Lorem ipsum") so the app feels alive on first launch. Thoughtful empty + loading states. Every
screen filled with 2+ sections of real content. It must feel NATIVE to iOS. Honor the STYLE
DIRECTIVE on EVERY screen — internal consistency is the brand.`;
