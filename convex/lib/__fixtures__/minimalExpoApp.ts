/**
 * Fixture file-sets for model-free QA. These are KNOWN generated apps used to
 * exercise the sandbox → preview → proxy → reopen → scroll → thumbnail path
 * without spending an Anthropic generation. No Convex imports — pure data.
 */

export interface FixtureFile {
  path: string;
  contents: string;
  purpose: string;
}

/**
 * GOOD: a minimal, web-correct Expo Router app with a scrollable list so the
 * preview-scroll fix has something to scroll. Passes validateManifest, renders
 * on react-native-web, no crash signatures.
 */
export const GOOD_APP: FixtureFile[] = [
  {
    path: "theme/tokens.ts",
    purpose: "Theme tokens",
    contents: `export const palette = {
  bg: "#0E0E11", surface: "#18181D", text: "#F5F5F7", textDim: "#A0A0AB", accent: "#7C8CF8",
};
export const space = { sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { md: 14, lg: 20 };
`,
  },
  {
    path: "app/_layout.tsx",
    purpose: "Root navigator",
    contents: `import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { palette } from "../theme/tokens";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
    </SafeAreaProvider>
  );
}
`,
  },
  {
    path: "app/index.tsx",
    purpose: "Home screen with a scrollable list",
    contents: `import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, space, radius } from "../theme/tokens";

const ITEMS = Array.from({ length: 30 }, (_, i) => ({
  id: String(i + 1),
  title: "Fixture item " + (i + 1),
  note: "Row " + (i + 1) + " — seeded so the list overflows and scrolls.",
}));

export default function Home() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
      <Text style={styles.title}>QA Fixture</Text>
      <Text style={styles.subtitle}>Scrollable list preview</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: space.xl }}>
        {ITEMS.map((it) => (
          <View key={it.id} style={styles.card}>
            <Text style={styles.cardTitle}>{it.title}</Text>
            <Text style={styles.cardNote}>{it.note}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: space.lg },
  title: { color: palette.text, fontSize: 30, fontWeight: "800" },
  subtitle: { color: palette.textDim, fontSize: 15, marginBottom: space.lg },
  scroll: { flex: 1 },
  card: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md },
  cardTitle: { color: palette.text, fontSize: 17, fontWeight: "600" },
  cardNote: { color: palette.textDim, fontSize: 14, marginTop: 4 },
});
`,
  },
];

/**
 * BROKEN: the exact two web-crash mistakes the codemod/validator target —
 * useSafeAreaInsets imported from "react-native" + a default import of
 * expo-linear-gradient. Used to prove (a) validate flags it, and (b) the
 * preview-time repairFiles heals it so it still renders.
 */
export const BROKEN_APP: FixtureFile[] = [
  GOOD_APP[0],
  GOOD_APP[1],
  {
    path: "app/index.tsx",
    purpose: "Home screen with web-incompatible imports",
    contents: `import { View, Text, ScrollView, useSafeAreaInsets } from "react-native";
import LinearGradient from "expo-linear-gradient";
import { palette, space } from "../theme/tokens";

export default function Home() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, paddingTop: insets.top + space.lg, paddingHorizontal: space.lg }}>
      <LinearGradient colors={[palette.accent, palette.surface]} style={{ height: 120, borderRadius: 16 }} />
      <ScrollView>
        <Text style={{ color: palette.text, fontSize: 24 }}>Broken fixture</Text>
      </ScrollView>
    </View>
  );
}
`,
  },
];

export const FIXTURES = { good: GOOD_APP, broken: BROKEN_APP } as const;
export type FixtureKey = keyof typeof FIXTURES;
