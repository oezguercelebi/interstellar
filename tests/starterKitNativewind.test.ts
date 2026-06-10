// L1 pure self-validation of the seeded NativeWind starter kit: the kit's own
// files (plus a representative fixture screen) must pass the nativewind
// validator, and every color-bearing class in the seeded contents must come
// from the semantic slot set (G3 audit, mechanically enforced). Zero network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_KITS } from "../convex/agents/starterKit.ts";
import {
  validateManifest,
  extractClassCandidates,
  type ValidatableFile,
} from "../convex/lib/validate.ts";

const KIT_FILES: ValidatableFile[] = STARTER_KITS.nativewind.files.map((f) => ({
  path: f.path,
  contents: f.contents,
}));

/** A representative generated screen: imports EVERY kit component via the @/ alias. */
const FIXTURE_SCREEN: ValidatableFile = {
  path: "app/index.tsx",
  contents: `import { ScrollView, View } from "react-native";
import { Inbox, Plus, Sparkles } from "lucide-react-native";
import { Screen } from "@/components/Screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/section-header";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export default function Home() {
  const loading = false;
  const items: { id: string; title: string; caption: string }[] = [];
  return (
    <Screen>
      <Text variant="caption" className="text-muted-foreground">
        Today
      </Text>
      <Text variant="largeTitle">Home</Text>
      <Input placeholder="Search" className="mt-4" />
      <SectionHeader title="Highlights" action={<Icon as={Sparkles} className="text-primary" />} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Card className="w-48">
          <CardHeader>
            <CardTitle>Streak</CardTitle>
            <CardDescription>Keep it going</CardDescription>
          </CardHeader>
          <CardContent className="flex-row items-center gap-2">
            <Text variant="title">12</Text>
            <Badge variant="success">
              <Text>On track</Text>
            </Badge>
          </CardContent>
        </Card>
      </ScrollView>
      <SectionHeader title="Inbox" />
      <Separator />
      {loading ? (
        <View className={cn("gap-3", "mt-3")}>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing yet"
          message="Items you add will show up here."
          ctaLabel="Add one"
          onCta={() => {}}
        />
      ) : (
        items.map((it) => <ListRow key={it.id} icon={Inbox} title={it.title} caption={it.caption} />)
      )}
      <Button className="mt-6">
        <Icon as={Plus} size={20} className="text-primary-foreground" />
        <Text>New item</Text>
      </Button>
    </Screen>
  );
}
`,
};

// ── Kit shape ─────────────────────────────────────────────────────────────────

test("nativewind kit seeds the 15 contracted files (required paths included)", () => {
  const paths = KIT_FILES.map((f) => f.path);
  assert.equal(paths.length, 15);
  assert.equal(new Set(paths).size, 15, "kit paths must be unique");
  for (const req of ["app/_layout.tsx", "theme/tokens.ts", "components/Screen.tsx", "lib/utils.ts"]) {
    assert.ok(paths.includes(req), `kit must seed ${req}`);
  }
});

// ── Self-validation ───────────────────────────────────────────────────────────

test("seeded kit + a representative screen passes validateManifest(…, 'nativewind')", () => {
  const r = validateManifest([...KIT_FILES, FIXTURE_SCREEN], "nativewind");
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

// ── G3 color audit, mechanically enforced ─────────────────────────────────────

/** The semantic slot set (matches theme/tokens.ts and the baked tailwind.config.js). */
const SEMANTIC_SLOTS = new Set([
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
  // Kept in the replaced theme.colors map:
  "transparent",
  "current",
  "inherit",
]);

/** Utilities that share a color prefix but are not colors. */
const NON_COLOR_UTILITIES = new Set([
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  "text-2xl",
  "text-3xl",
  "text-4xl",
  "text-center",
  "text-left",
  "text-right",
]);

const COLOR_PREFIX_RE = /^(?:bg|text|border|from|via|to|fill|stroke)-(.+)$/;

function classTokens(contents: string): string[] {
  return extractClassCandidates(contents)
    .flatMap((c) => c.value.split(/\s+/))
    .filter(Boolean)
    .map((t) => t.split(":").pop() as string) // strip variant prefixes (active:, focus:, …)
    .map((t) => t.split("/")[0]); // strip opacity modifiers (bg-primary/50)
}

test("every color-bearing class in the seeded kit (and fixture) is semantic", () => {
  for (const f of [...KIT_FILES, FIXTURE_SCREEN]) {
    for (const token of classTokens(f.contents)) {
      if (NON_COLOR_UTILITIES.has(token)) continue;
      const m = COLOR_PREFIX_RE.exec(token);
      if (!m) continue;
      assert.ok(
        SEMANTIC_SLOTS.has(m[1]),
        `${f.path}: class "${token}" is color-prefixed but "${m[1]}" is not a semantic slot (or add it to NON_COLOR_UTILITIES if it is not a color)`,
      );
    }
  }
});

test("seeded kit class strings contain zero arbitrary values, interpolation, or dark: variants", () => {
  const arbitrary = /(?:^|[\s"'`])[\w-]+-\[[^\]]+\]/;
  for (const f of [...KIT_FILES, FIXTURE_SCREEN]) {
    for (const cand of extractClassCandidates(f.contents)) {
      assert.ok(!arbitrary.test(cand.value), `${f.path}: arbitrary value in "${cand.value}"`);
      assert.ok(
        !(cand.template && cand.value.includes("${")),
        `${f.path}: interpolated className "${cand.value}"`,
      );
      assert.ok(!cand.value.includes("dark:"), `${f.path}: dark: variant in "${cand.value}"`);
    }
  }
});

test("seeded kit files carry no hex literals outside theme/tokens.ts", () => {
  const hex = /#[0-9a-fA-F]{3,8}\b/;
  for (const f of KIT_FILES) {
    if (f.path === "theme/tokens.ts") continue;
    assert.ok(!hex.test(f.contents), `${f.path}: hex literal found`);
  }
});

test("seeded app/_layout.tsx carries the load-bearing global.css import (G4)", () => {
  const layout = KIT_FILES.find((f) => f.path === "app/_layout.tsx");
  assert.ok(layout);
  assert.match(layout.contents, /import\s+["']\.\.\/global\.css["']/);
});
