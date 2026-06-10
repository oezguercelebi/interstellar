/**
 * NativeWind starter kit ("nativewind") — seeded files for first-generation
 * versions, in the shadcn / react-native-reusables dialect.
 *
 * 15 files: theme/tokens.ts (THE palette rewrite target), app/_layout.tsx
 * (tab-list rewrite target), components/Screen.tsx, lib/utils.ts, 8 vendored
 * RNR primitives (components/ui/*) and 3 house app-pattern components.
 *
 * Styling contract baked into every body here:
 *  - Semantic color classes ONLY (bg-background / bg-card / text-foreground /
 *    text-muted-foreground / …). The baked tailwind.config.js REPLACES
 *    theme.colors, so raw palette classes (bg-blue-500, text-white) do not
 *    compile in the sandbox at all.
 *  - ZERO Tailwind arbitrary values; spacing from the numeric scale.
 *  - Type via <Text variant="largeTitle|title|headline|body|subhead|caption">.
 *  - Touch targets >= 44px by construction (min-h-11 on all interactive kit
 *    pieces).
 *  - style={} only where values cannot be classes: safe-area insets in
 *    Screen.tsx and navigator color props in app/_layout.tsx (via colors.*).
 *
 * tailwind.config.js / global.css / babel.config.js / metro.config.js /
 * nativewind-env.d.ts are baked snapshot infra (scripts/lib/nativewindConfig.mjs)
 * — never seeded, never uploaded, fully forbidden. The one load-bearing link
 * is the `import "../global.css"` line in app/_layout.tsx.
 *
 * Vendored components are trimmed from react-native-reusables (MIT) —
 * https://github.com/founded-labs/react-native-reusables — see per-file headers.
 *
 * G3 color audit (plan §1.5 implementation note): every color-bearing class
 * below is in the semantic slot set; the one non-semantic RNR original found
 * was separator's arbitrary h-[1px]/w-[1px], rewritten to scale h-px/w-px.
 * Status-chip text on bg-success/bg-warning uses text-background (correct
 * contrast in both light and dark token sets).
 *
 * Embedded import lines use the @/ alias (baked tsconfig maps @/* -> ./*) so
 * they never resolve against real repo files (C3 closure safety).
 */

import type { StarterFile } from "./starterKit.ts";

export const STARTER_FILES_NATIVEWIND: StarterFile[] = [
  {
    path: "theme/tokens.ts",
    purpose: "Design tokens",
    contents: `import { vars } from "nativewind";

// HSL channel triplets ("H S% L%") — REWRITE ONLY these values per APP PLAN.
// The plan emits the exact triplets; copy them, never hand-convert hex.
const c = {
  background: "0 0% 100%",        foreground: "240 10% 4%",
  card: "240 5% 98%",             "card-foreground": "240 10% 4%",
  primary: "231 99% 62%",         "primary-foreground": "0 0% 100%",
  secondary: "240 5% 96%",        "secondary-foreground": "240 6% 10%",
  muted: "240 5% 96%",            "muted-foreground": "240 4% 46%",
  accent: "231 100% 95%",         "accent-foreground": "231 80% 40%",
  destructive: "0 84% 60%",       "destructive-foreground": "0 0% 100%",
  success: "142 71% 45%",         warning: "38 92% 50%",
  border: "240 6% 90%",           input: "240 6% 90%",
  ring: "231 99% 62%",
} as const;

// Applied as style={theme} on the root View in app/_layout.tsx (NativeWind vars()).
export const theme = vars(
  Object.fromEntries(Object.entries(c).map(([k, v]) => [\`--\${k}\`, v])),
);

// Raw color strings for props that need values, not classes (tab bar tint, icons).
export const colors = Object.fromEntries(
  Object.entries(c).map(([k, v]) => [k, \`hsl(\${v})\`]),
) as Record<keyof typeof c, string>;
`,
  },

  {
    path: "app/_layout.tsx",
    purpose: "Root Tabs navigator",
    contents: `import "../global.css";                          // load-bearing: validator-enforced
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View } from "react-native";
import { House, Compass } from "lucide-react-native";
import { theme, colors } from "@/theme/tokens";

// REWRITE the <Tabs.Screen> list per APP PLAN (names, icons, screen files) and
// set the StatusBar style to match the plan's mode. KEEP the wrapper View with
// style={theme} (it scopes the design tokens), SafeAreaProvider, and the
// global.css import above.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={theme} className="flex-1 bg-background">
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors["muted-foreground"],
            tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          }}
        >
          <Tabs.Screen name="index" options={{ title: "Home",
            tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }} />
          <Tabs.Screen name="explore" options={{ title: "Explore",
            tabBarIcon: ({ color, size }) => <Compass color={color} size={size} /> }} />
        </Tabs>
        <StatusBar style="auto" />
      </View>
    </SafeAreaProvider>
  );
}
`,
  },

  {
    path: "components/Screen.tsx",
    purpose: "Safe-area screen wrapper",
    contents: `import * as React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Wraps every screen. Pads the status bar (top) + home indicator (bottom) so
 * content is never hidden. Scrolls by default; use scroll={false} for a
 * fixed full-height screen.
 *
 * STARTER CONTRACT: wrap EVERY screen in <Screen>; never hand-roll safe areas.
 * The style props below are THE one sanctioned style={} site in app code —
 * dynamic safe-area insets cannot be expressed as Tailwind classes.
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
    paddingTop: insets.top + 16,
    paddingBottom: insets.bottom + 32,
  };
  if (!scroll) {
    return (
      <View className="flex-1 bg-background px-5" style={pad}>
        {children}
      </View>
    );
  }
  return (
    <View className="flex-1 bg-background">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-5"
        contentContainerStyle={pad}
      >
        {children}
      </ScrollView>
    </View>
  );
}
`,
  },

  {
    path: "lib/utils.ts",
    purpose: "Class-name helper",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  },

  {
    path: "components/ui/text.tsx",
    purpose: "Typography",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import * as Slot from "@rn-primitives/slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Text as RNText } from "react-native";
import { cn } from "@/lib/utils";

// Provided by Button/Badge so nested <Text> picks up their text styling.
const TextClassContext = React.createContext<string | undefined>(undefined);

// House type roles — explicit line heights baked in. ALWAYS pick a variant;
// never compose ad-hoc font-size classes.
const textVariants = cva("text-foreground", {
  variants: {
    variant: {
      largeTitle: "text-4xl font-bold leading-10 tracking-tight",
      title: "text-2xl font-semibold leading-8 tracking-tight",
      headline: "text-lg font-semibold leading-6",
      body: "text-base font-normal leading-6",
      subhead: "text-sm font-normal leading-5",
      caption: "text-xs font-medium leading-4",
    },
  },
  defaultVariants: { variant: "body" },
});

type TextProps = React.ComponentProps<typeof RNText> &
  VariantProps<typeof textVariants> & { asChild?: boolean };

function Text({ className, variant, asChild = false, ...props }: TextProps) {
  const textClass = React.useContext(TextClassContext);
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      className={cn(textVariants({ variant }), textClass, className)}
      {...props}
    />
  );
}

export { Text, TextClassContext, textVariants };
`,
  },

  {
    path: "components/ui/button.tsx",
    purpose: "Button",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import * as Slot from "@rn-primitives/slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Pressable } from "react-native";
import { TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Pressed + disabled states built in; every size keeps a >= 44px touch
// target (min-h-11) by construction. Label goes in a child <Text>.
const buttonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-xl",
  {
    variants: {
      variant: {
        default: "bg-primary active:opacity-90",
        secondary: "bg-secondary active:opacity-80",
        destructive: "bg-destructive active:opacity-90",
        outline: "border border-input bg-background active:bg-accent",
        ghost: "active:bg-accent",
      },
      size: {
        default: "min-h-11 px-5 py-2.5",
        sm: "min-h-11 px-4 py-2",
        lg: "min-h-12 px-8 py-3",
        icon: "min-h-11 min-w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const buttonTextVariants = cva("font-semibold", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
      ghost: "text-foreground",
    },
    size: {
      default: "text-base leading-6",
      sm: "text-sm leading-5",
      lg: "text-base leading-6",
      icon: "text-base leading-6",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = React.ComponentProps<typeof Pressable> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Pressable : Pressable;
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Component
        accessibilityRole="button"
        className={cn(
          buttonVariants({ variant, size }),
          disabled && "opacity-50",
          className,
        )}
        disabled={disabled}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button, buttonVariants, buttonTextVariants };
export type { ButtonProps };
`,
  },

  {
    path: "components/ui/card.tsx",
    purpose: "Card family",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import * as React from "react";
import { View, type ViewProps } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn("rounded-2xl border border-border bg-card shadow-sm", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn("gap-1.5 p-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return (
    <Text variant="headline" className={cn("text-card-foreground", className)} {...props} />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return (
    <Text variant="subhead" className={cn("text-muted-foreground", className)} {...props} />
  );
}

function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn("p-4 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: ViewProps) {
  return <View className={cn("flex-row items-center gap-2 p-4 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
`,
  },

  {
    path: "components/ui/input.tsx",
    purpose: "Text input",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import * as React from "react";
import { TextInput, type TextInputProps } from "react-native";
import { cn } from "@/lib/utils";

function Input({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      className={cn(
        "min-h-11 rounded-xl border border-input bg-background px-4 py-2 text-base leading-5 text-foreground placeholder:text-muted-foreground focus:border-ring",
        props.editable === false && "opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
`,
  },

  {
    path: "components/ui/badge.tsx",
    purpose: "Status chip",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { View, type ViewProps } from "react-native";
import { TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "flex-row items-center self-start rounded-full px-2.5 py-0.5",
  {
    variants: {
      variant: {
        default: "bg-primary",
        secondary: "bg-secondary",
        destructive: "bg-destructive",
        outline: "border border-border bg-transparent",
        success: "bg-success",
        warning: "bg-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

// text-background on success/warning = correct contrast for light AND dark
// token sets (light bg -> light text on saturated chip; dark bg -> dark text).
const badgeTextVariants = cva("text-xs font-medium leading-4", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      destructive: "text-destructive-foreground",
      outline: "text-foreground",
      success: "text-background",
      warning: "text-background",
    },
  },
  defaultVariants: { variant: "default" },
});

type BadgeProps = ViewProps & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <View className={cn(badgeVariants({ variant }), className)} {...props} />
    </TextClassContext.Provider>
  );
}

export { Badge, badgeVariants };
`,
  },

  {
    path: "components/ui/separator.tsx",
    purpose: "Divider",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import * as SeparatorPrimitive from "@rn-primitives/separator";
import * as React from "react";
import { cn } from "@/lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorPrimitive.RootProps) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
`,
  },

  {
    path: "components/ui/skeleton.tsx",
    purpose: "Loading state",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

// Loading placeholder — size it with w-*/h-* classes in place of the content.
function Skeleton({ className, ...props }: ViewProps) {
  return <View className={cn("animate-pulse rounded-xl bg-muted", className)} {...props} />;
}

export { Skeleton };
`,
  },

  {
    path: "components/ui/icon.tsx",
    purpose: "Icon wrapper",
    contents: `// Portions derived from react-native-reusables (MIT) — https://github.com/founded-labs/react-native-reusables
import type { LucideIcon, LucideProps } from "lucide-react-native";
import { cssInterop } from "nativewind";
import * as React from "react";
import { cn } from "@/lib/utils";

type IconProps = LucideProps & { as: LucideIcon; className?: string };

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />;
}

cssInterop(IconImpl, {
  className: {
    target: "style",
    nativeStyleToProp: { color: true, opacity: true },
  },
});

// Color via text-* classes: <Icon as={House} className="text-primary" />.
// (Navigator props that need raw values use colors.* from theme/tokens.)
function Icon({ as: IconComponent, className, size = 20, ...props }: IconProps) {
  return (
    <IconImpl
      as={IconComponent}
      className={cn("text-foreground", className)}
      size={size}
      {...props}
    />
  );
}

export { Icon };
`,
  },

  {
    path: "components/ui/list-row.tsx",
    purpose: "List row",
    contents: `import { ChevronRight, type LucideIcon } from "lucide-react-native";
import * as React from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Standard list item: leading icon square, title + caption column, chevron.
export function ListRow({
  icon,
  title,
  caption,
  onPress,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  caption?: string;
  onPress?: () => void;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn("min-h-11 flex-row items-center gap-3 py-2 active:opacity-60", className)}
    >
      {icon ? (
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-accent">
          <Icon as={icon} size={20} className="text-accent-foreground" />
        </View>
      ) : null}
      <View className="flex-1">
        <Text variant="headline">{title}</Text>
        {caption ? (
          <Text variant="caption" className="text-muted-foreground">
            {caption}
          </Text>
        ) : null}
      </View>
      <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}
`,
  },

  {
    path: "components/ui/section-header.tsx",
    purpose: "Section header",
    contents: `import * as React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

// Section rhythm: mt-6 above, mb-3 below, optional trailing action.
export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={cn("mb-3 mt-6 flex-row items-center justify-between", className)}>
      <Text variant="headline">{title}</Text>
      {action}
    </View>
  );
}
`,
  },

  {
    path: "components/ui/empty-state.tsx",
    purpose: "Empty state",
    contents: `import type { LucideIcon } from "lucide-react-native";
import * as React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

// Render for every empty list/feed: icon circle + title + body + optional CTA.
export function EmptyState({
  icon,
  title,
  message,
  ctaLabel,
  onCta,
}: {
  icon?: LucideIcon;
  title: string;
  message?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <View className="items-center gap-3 py-12">
      {icon ? (
        <View className="mb-2 h-20 w-20 items-center justify-center rounded-full bg-accent">
          <Icon as={icon} size={32} className="text-accent-foreground" />
        </View>
      ) : null}
      <Text variant="title" className="text-center">
        {title}
      </Text>
      {message ? (
        <Text variant="body" className="px-6 text-center text-muted-foreground">
          {message}
        </Text>
      ) : null}
      {ctaLabel ? (
        <View className="mt-2">
          <Button onPress={onCta}>
            <Text>{ctaLabel}</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
`,
  },
];
