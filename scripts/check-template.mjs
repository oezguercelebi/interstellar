#!/usr/bin/env node
// Pre-bake NativeWind template verification (plan §7.1) — manual + pre-bake
// gate. Needs network + a few minutes; NOT part of test:pure.
//
// Builds a throwaway Expo app in tmp/template-check (gitignored) mirroring the
// `interstellar-studio-nw1` snapshot bake byte-for-byte where it matters:
//   - same dep pins (scripts/lib/nativewindConfig.mjs — shared with the bake)
//   - same five ROOT config files, written via the same b64 write command
//   - same app.json / tsconfig.json patches and root-layout normalization
// then materializes STARTER_KITS.nativewind.files (the REAL seeded kit, read
// straight out of convex/agents/starterKit.ts) plus fixture screens that
// import EVERY kit component, and proves:
//   1. `tsc --noEmit` — nativewind className typings (incl. ScrollView
//      contentContainerClassName), vars() signature, the *.css module
//      declaration, @/ path alias, and all kit code against real SDK deps.
//   2. `tailwindcss` compile — every semantic class in the template compiles
//      against the baked config (catches tokens <-> tailwind.config drift).
//
// Usage: node scripts/check-template.mjs [--export]
//   --export  also run `npx expo export -p web` (full Metro+NativeWind
//             pipeline; several extra minutes).

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  APP_JSON_PATCH_JS,
  NATIVEWIND_CONFIG_FILES,
  NATIVEWIND_EXACT_DEPS,
  NATIVEWIND_EXACT_DEV_DEPS,
  NATIVEWIND_EXPO_DEPS,
  TSCONFIG_PATCH_JS,
  b64WriteCommand,
} from "./lib/nativewindConfig.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = path.join(ROOT, "tmp", "template-check");
const DEEP_EXPORT = process.argv.includes("--export");

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const ENV = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" };
const sh = (cmd, cwd = DIR) => execSync(cmd, { cwd, stdio: "inherit", env: ENV });

// ---------------------------------------------------------------------------
// Fixture screens — check-template only, NEVER seeded. app/_layout.tsx in the
// kit declares "index" + "explore" tabs, so these two files complete the app.
// index.tsx imports every kit component and exercises representative classes
// from the semantic dialect (plus the bg-primary/50 opacity modifier, which
// only works because the baked color map uses <alpha-value> HSL channels).
// ---------------------------------------------------------------------------

const FIXTURE_INDEX = `// FIXTURE — scripts/check-template.mjs only, never seeded into real apps.
import { Inbox, Plus, Search, Settings, Star } from "lucide-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Screen } from "@/components/Screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/section-header";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Text, TextClassContext, textVariants } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { colors, theme } from "@/theme/tokens";

export default function Index() {
  const [query, setQuery] = React.useState("");
  const loading = query.length > 3;
  return (
    <Screen>
      <Text variant="caption" className="text-muted-foreground">
        FIXTURE
      </Text>
      <Text variant="largeTitle">Template check</Text>
      <Text variant="body" className="mt-1 text-muted-foreground">
        Every kit component, semantic classes only.
      </Text>

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search"
        className="mt-4"
      />

      <SectionHeader
        title="Stats"
        action={
          <Button variant="ghost" size="sm">
            <Text>All</Text>
          </Button>
        }
      />
      <View className="flex-row gap-3">
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>128</CardTitle>
            <CardDescription>Done</CardDescription>
          </CardHeader>
        </Card>
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>7</CardTitle>
            <CardDescription>Open</CardDescription>
          </CardHeader>
        </Card>
      </View>

      <SectionHeader title="Featured" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3"
      >
        <Card className="w-44">
          <CardHeader>
            <Icon as={Star} size={20} className="text-primary" />
            <CardTitle>Alpha</CardTitle>
            <CardDescription>First card</CardDescription>
          </CardHeader>
          <CardContent>
            <View className="h-2 w-full rounded-full bg-secondary">
              <View className="h-2 w-8 rounded-full bg-primary/50" />
            </View>
          </CardContent>
          <CardFooter>
            <Badge variant="success">
              <Text>Live</Text>
            </Badge>
            <Badge variant="warning">
              <Text>Beta</Text>
            </Badge>
          </CardFooter>
        </Card>
        <Card className="w-44">
          <CardHeader>
            <CardTitle>Bravo</CardTitle>
            <CardDescription>Second card</CardDescription>
          </CardHeader>
        </Card>
      </ScrollView>

      <SectionHeader title="Rows" />
      <ListRow icon={Inbox} title="Inbox" caption="3 unread" onPress={() => {}} />
      <Separator />
      <ListRow icon={Settings} title="Settings" onPress={() => {}} />

      <SectionHeader title="States" />
      {loading ? (
        <View className="gap-3">
          <Skeleton className={cn("h-20 w-full")} />
          <Skeleton className="h-4 w-48" />
        </View>
      ) : (
        <EmptyState
          icon={Search}
          title="Nothing here"
          message="Type more than three characters to see skeletons."
          ctaLabel="Add item"
          onCta={() => {}}
        />
      )}

      <View className="mt-6 flex-row items-center gap-3">
        <Button onPress={() => {}}>
          <Icon as={Plus} size={20} color={colors["primary-foreground"]} />
          <Text>Primary</Text>
        </Button>
        <Button variant="outline" disabled>
          <Text>Outline</Text>
        </Button>
        <Button variant="destructive" size="icon" onPress={() => {}}>
          <Icon as={Plus} size={20} className="text-destructive-foreground" />
        </Button>
      </View>

      <TextClassContext.Provider value={textVariants({ variant: "subhead" })}>
        <Text className="mt-4 text-muted-foreground">Context-styled footer</Text>
      </TextClassContext.Provider>
      <View className="mt-2 rounded-lg border border-border bg-card p-4" style={theme}>
        <Text variant="subhead">vars() re-scoped block</Text>
      </View>
    </Screen>
  );
}
`;

const FIXTURE_EXPLORE = `// FIXTURE — scripts/check-template.mjs only, never seeded into real apps.
import { Compass } from "lucide-react-native";
import * as React from "react";
import { Screen } from "@/components/Screen";
import { EmptyState } from "@/components/ui/empty-state";
import { Text } from "@/components/ui/text";

export default function Explore() {
  return (
    <Screen scroll={false}>
      <Text variant="title">Explore</Text>
      <EmptyState icon={Compass} title="Nothing to explore yet" />
    </Screen>
  );
}
`;

// Selectors that MUST appear in the compiled CSS — one per load-bearing
// mechanism: semantic bg/text/border slots, the <alpha-value> opacity
// modifier, the 44px touch-target scale class, the radius extension.
const EXPECTED_SELECTORS = [
  ".bg-background",
  ".bg-card",
  ".text-muted-foreground",
  ".text-accent-foreground",
  ".border-border",
  ".bg-primary\\/50",
  ".min-h-11",
  ".rounded-2xl",
];

let current = "";
const step = (name, fn) => {
  current = name;
  log("▶", name);
  fn();
};

try {
  step("fresh throwaway Expo app (tmp/template-check)", () => {
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(DIR), { recursive: true });
    sh(
      `npx --yes create-expo-app@latest ${JSON.stringify(DIR)} --template default --yes`,
      ROOT,
    );
  });

  step("normalize to ROOT app/ layout (mirrors bake)", () => {
    // Same list as scripts/bake-snapshot.mjs — template example code must not
    // leak into the typecheck.
    sh("rm -rf src app components constants hooks scripts theme store app-example && mkdir -p app");
  });

  step("apply app.json + tsconfig patches (shared snippets)", () => {
    execFileSync(process.execPath, ["-e", APP_JSON_PATCH_JS], { cwd: DIR, env: ENV });
    execFileSync(process.execPath, ["-e", TSCONFIG_PATCH_JS], { cwd: DIR, env: ENV });
  });

  step("install NativeWind dep set (exact bake pins)", () => {
    sh(`npx expo install ${NATIVEWIND_EXPO_DEPS.join(" ")}`);
    sh(`npm i -E ${NATIVEWIND_EXACT_DEPS.join(" ")}`);
    sh(`npm i -DE ${NATIVEWIND_EXACT_DEV_DEPS.join(" ")}`);
  });

  step("write the five ROOT config files (same b64 command as the bake)", () => {
    for (const f of NATIVEWIND_CONFIG_FILES) sh(b64WriteCommand(f.path, f.contents));
  });

  let kitFiles = [];
  step("materialize STARTER_KITS.nativewind.files from convex/agents/starterKit.ts", () => {
    const json = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--input-type=module",
        "-e",
        "const m = await import(process.argv[1]); process.stdout.write(JSON.stringify(m.STARTER_KITS.nativewind.files));",
        pathToFileURL(path.join(ROOT, "convex", "agents", "starterKit.ts")).href,
      ],
      { cwd: ROOT, env: ENV },
    ).toString();
    kitFiles = JSON.parse(json);
    const required = ["app/_layout.tsx", "theme/tokens.ts", "components/Screen.tsx"];
    const missing = required.filter((p) => !kitFiles.some((f) => f.path === p));
    if (missing.length) throw new Error(`kit is missing required files: ${missing.join(", ")}`);
    if (kitFiles.length < 15) throw new Error(`expected >= 15 kit files, got ${kitFiles.length}`);
    for (const f of kitFiles) {
      const dest = path.join(DIR, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.contents);
    }
    log(`  materialized ${kitFiles.length} kit files`);
  });

  step("write fixture screens (import EVERY kit component)", () => {
    fs.writeFileSync(path.join(DIR, "app", "index.tsx"), FIXTURE_INDEX);
    fs.writeFileSync(path.join(DIR, "app", "explore.tsx"), FIXTURE_EXPLORE);
  });

  step("tsc --noEmit", () => {
    sh("npx tsc --noEmit");
  });

  step("tailwind compile + selector assertions", () => {
    const out = ".tw-check.css";
    sh(
      `npx tailwindcss -c tailwind.config.js -i global.css -o ${out} --content "app/**/*.tsx,components/**/*.tsx"`,
    );
    const css = fs.readFileSync(path.join(DIR, out), "utf8");
    const missing = EXPECTED_SELECTORS.filter((s) => !css.includes(s));
    if (missing.length) {
      throw new Error(
        `compiled CSS is missing expected selectors: ${missing.join(", ")} — tokens <-> tailwind.config drift?`,
      );
    }
    if (!css.includes("--background")) {
      throw new Error("compiled CSS lost the :root token fallback from global.css");
    }
    fs.rmSync(path.join(DIR, out), { force: true });
    log(`  all ${EXPECTED_SELECTORS.length} expected selectors present`);
  });

  if (DEEP_EXPORT) {
    step("OPTIONAL deep check: expo export -p web", () => {
      sh("npx expo export -p web");
      fs.rmSync(path.join(DIR, "dist"), { recursive: true, force: true });
    });
  }

  log("✅ ALL CHECKS PASSED — nativewind template is tsc-clean and tailwind-clean");
} catch (e) {
  console.error(`\n✗ FAILED at step: ${current}`);
  console.error(e?.message ?? e);
  process.exit(1);
}
