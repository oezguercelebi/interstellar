/**
 * Seeded starter-kit files for first-generation versions.
 *
 * These files are inserted into the `files` table before the agent runs so that:
 *  1. Required-file validation passes immediately (tokens.ts, _layout.tsx, Screen.tsx).
 *  2. The agent can focus on product screens instead of infrastructure boilerplate.
 *  3. The model only rewrites the palette in tokens.ts and the tab list in _layout.tsx —
 *     the shapes are already correct and web-compatible.
 *
 * All files use only allowlisted deps and consume tokens exclusively (no literals).
 */

export interface StarterFile {
  path: string;
  contents: string;
  purpose: string;
}

export const STARTER_FILES: StarterFile[] = [
  {
    path: "theme/tokens.ts",
    purpose: "Design tokens",
    contents: `// Design tokens — rewrite the palette to match the APP PLAN; keep the shape.
export const palette = {
  // Backgrounds
  background: "#FFFFFF",
  surface: "#F8F8FA",
  surfaceElevated: "#FFFFFF",
  // Text
  textPrimary: "#0A0A0F",
  textSecondary: "#4A4A5A",
  textTertiary: "#9090A0",
  // Structure
  border: "#E4E4EC",
  // Accent — replace with the plan's accent hex
  accent: "#3D5AFE",
  accentInk: "#FFFFFF",
  accentSoft: "#EEF1FF",
  // Semantic
  success: "#34C759",
  warning: "#FFB020",
  danger: "#FF3B30",
} as const;

// 4-pt grid
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

// Type roles — complete objects with fontSize + lineHeight + fontWeight
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" as const },
  title:      { fontSize: 22, lineHeight: 28, fontWeight: "600" as const },
  headline:   { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  body:       { fontSize: 17, lineHeight: 24, fontWeight: "400" as const },
  subhead:    { fontSize: 15, lineHeight: 20, fontWeight: "400" as const },
  caption:    { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
} as const;

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  floating: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

export const touchTarget = 44;
`,
  },

  {
    path: "components/Screen.tsx",
    purpose: "Safe-area screen wrapper",
    contents: `import React from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, space } from "../theme/tokens";

/**
 * Wraps every screen. Pads the status bar (top) + home indicator (bottom) so
 * content is never hidden. Scrolls by default; use scroll={false} for a
 * fixed full-height screen.
 *
 * STARTER CONTRACT: wrap EVERY screen in <Screen>; never hand-roll safe areas.
 */
export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: insets.top + space.lg,
    paddingBottom: insets.bottom + space["2xl"],
    paddingHorizontal: space.lg,
  };
  if (!scroll) {
    return <View style={[styles.root, pad]}>{children}</View>;
  }
  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={pad}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
});
`,
  },

  {
    path: "components/ui.tsx",
    purpose: "Shared UI primitives",
    contents: `/**
 * Shared UI primitives — Card, Row, Button, SectionHeader, EmptyState.
 * All consume tokens; zero hardcoded literals.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { palette, space, radius, type as type_, shadow, touchTarget } from "../theme/tokens";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Row  (44-pt touch target, chevron trailing)
// ---------------------------------------------------------------------------
export function Row({
  icon,
  title,
  caption,
  onPress,
}: {
  icon?: string;
  title: string;
  caption?: string;
  onPress?: () => void;
}) {
  const [pressed, setPressed] = React.useState(false);
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      style={[styles.row, pressed && styles.rowPressed]}
    >
      {icon ? (
        <View style={styles.iconWrap}>
          <Ionicons name={icon as any} size={20} color={palette.accent} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {caption ? <Text style={styles.rowCaption}>{caption}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.textTertiary} />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Button (primary + secondary)
// ---------------------------------------------------------------------------
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const [pressed, setPressed] = React.useState(false);
  const isPrimary = variant === "primary";
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.buttonLabel, !isPrimary && styles.buttonLabelSecondary]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------
export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
export function EmptyState({
  icon,
  title,
  message,
  ctaLabel,
  onCta,
}: {
  icon?: string;
  title: string;
  message?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <View style={styles.emptyWrap}>
      {icon ? (
        <View style={styles.emptyIconWrap}>
          <Ionicons name={icon as any} size={32} color={palette.accent} />
        </View>
      ) : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {ctaLabel ? <Button label={ctaLabel} onPress={onCta} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  // Card
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  } as ViewStyle,

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: touchTarget,
    gap: space.md,
    paddingVertical: space.sm,
  } as ViewStyle,
  rowPressed: { opacity: 0.6 } as ViewStyle,
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  rowText: { flex: 1 } as ViewStyle,
  rowTitle: { ...type_.headline, color: palette.textPrimary } as TextStyle,
  rowCaption: {
    ...type_.caption,
    color: palette.textSecondary,
    marginTop: 2,
  } as TextStyle,

  // Button
  button: {
    height: touchTarget,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
  } as ViewStyle,
  buttonPrimary: { backgroundColor: palette.accent } as ViewStyle,
  buttonSecondary: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  } as ViewStyle,
  buttonPressed: { opacity: 0.75 } as ViewStyle,
  buttonDisabled: { opacity: 0.4 } as ViewStyle,
  buttonLabel: {
    ...type_.headline,
    color: palette.accentInk,
  } as TextStyle,
  buttonLabelSecondary: { color: palette.textPrimary } as TextStyle,

  // SectionHeader
  sectionHeader: {
    ...type_.headline,
    color: palette.textPrimary,
    marginTop: space.xl,
    marginBottom: space.md,
  } as TextStyle,

  // EmptyState
  emptyWrap: {
    alignItems: "center",
    paddingVertical: space["3xl"],
    gap: space.md,
  } as ViewStyle,
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: palette.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  } as ViewStyle,
  emptyTitle: { ...type_.title, color: palette.textPrimary } as TextStyle,
  emptyMessage: {
    ...type_.body,
    color: palette.textSecondary,
    textAlign: "center",
    paddingHorizontal: space.xl,
  } as TextStyle,
});
`,
  },

  {
    path: "app/_layout.tsx",
    purpose: "Root Tabs navigator",
    contents: `// Root layout — REWRITE the tab list per APP PLAN (names, icons, screen files).
// Keep SafeAreaProvider, Tabs screenOptions shape, and StatusBar.
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
          tabBarInactiveTintColor: palette.textTertiary,
          tabBarStyle: {
            backgroundColor: palette.surface,
            borderTopColor: palette.border,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: "Explore",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
      {/* "dark" on a light bg; "light" on a dark bg — match the palette */}
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
`,
  },
];
