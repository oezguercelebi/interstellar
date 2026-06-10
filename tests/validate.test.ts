// L1 pure-static tests for the generated-app validator (the hard gate the model
// must pass). Imports the real source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, type ValidatableFile } from "../convex/lib/validate.ts";

/** A minimal valid generated app: required files + one screen + allowed imports. */
function goodApp(): ValidatableFile[] {
  return [
    { path: "theme/tokens.ts", contents: `export const palette = { accent: "#fff" };\n` },
    {
      path: "app/_layout.tsx",
      contents: `import { Stack } from "expo-router";\nexport default function L(){ return <Stack/>; }\n`,
    },
    {
      path: "components/Screen.tsx",
      contents:
        `import React from "react";\n` +
        `import { View } from "react-native";\n` +
        `import { useSafeAreaInsets } from "react-native-safe-area-context";\n` +
        `export function Screen({ children }: { children: React.ReactNode }) {\n` +
        `  const insets = useSafeAreaInsets();\n` +
        `  return <View style={{ paddingTop: insets.top }}>{children}</View>;\n` +
        `}\n`,
    },
    {
      path: "app/index.tsx",
      contents:
        `import { View, Text } from "react-native";\n` +
        `import { useSafeAreaInsets } from "react-native-safe-area-context";\n` +
        `import { LinearGradient } from "expo-linear-gradient";\n` +
        `export default function Home(){ return <View><Text>hi</Text></View>; }\n`,
    },
  ];
}

test("a well-formed app passes with no problems", () => {
  const r = validateManifest(goodApp());
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.problems.length, 0);
});

test("missing required files are flagged", () => {
  const r = validateManifest([
    { path: "app/index.tsx", contents: `export default function H(){return null;}\n` },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("theme/tokens.ts")));
  assert.ok(r.problems.some((p) => p.includes("app/_layout.tsx")));
});

test("no screen under app/ is flagged", () => {
  const r = validateManifest([
    { path: "theme/tokens.ts", contents: `export const x=1;\n` },
    { path: "app/_layout.tsx", contents: `export default function L(){return null;}\n` },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("No screen")));
});

test("disallowed dependency import is flagged", () => {
  const files = goodApp();
  files[2].contents += `import axios from "axios";\n`;
  const r = validateManifest(files);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("axios")));
});

test("safe-area imported from react-native is flagged (web crash)", () => {
  const files = goodApp();
  files[2].contents = `import { View, useSafeAreaInsets } from "react-native";\nexport default function H(){return null;}\n`;
  const r = validateManifest(files);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /react-native-safe-area-context/.test(p)));
});

test("default import of a named-only expo pkg is flagged", () => {
  const files = goodApp();
  files[2].contents = `import LinearGradient from "expo-linear-gradient";\nexport default function H(){return null;}\n`;
  const r = validateManifest(files);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /expo-linear-gradient/.test(p)));
});

test("deleted files are ignored by validation", () => {
  const files = goodApp();
  files.push({ path: "app/bad.tsx", contents: `import axios from "axios";\n`, deleted: true });
  const r = validateManifest(files);
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("relative + scoped allowed imports do not trip the dep check", () => {
  const files = goodApp();
  files[2].contents =
    `import { Ionicons } from "@expo/vector-icons";\n` +
    `import { palette } from "../theme/tokens";\n` +
    `import { View } from "react-native";\nexport default function H(){return <View/>;}\n`;
  const r = validateManifest(files);
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("problems are deduped and capped at 12", () => {
  const files = goodApp();
  // Inject many distinct disallowed imports.
  files[2].contents = Array.from({ length: 20 }, (_, i) => `import x${i} from "pkg${i}";`).join("\n");
  const r = validateManifest(files);
  assert.ok(r.problems.length <= 12);
});

// ─────────────────────────────────────────────────────────────────────────────
// NativeWind kit ("nativewind") — per-kit gate, className rules, G4/G6.
// The classic suite above is untouched: kit defaults to "classic".
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal valid nativewind-kit app: required files + one screen, shadcn dialect. */
function nwGoodApp(): ValidatableFile[] {
  return [
    {
      path: "theme/tokens.ts",
      contents:
        `import { vars } from "nativewind";\n` +
        `const c = { background: "0 0% 100%", primary: "231 99% 62%" } as const;\n` +
        "export const theme = vars(Object.fromEntries(Object.entries(c).map(([k, v]) => [`--${k}`, v])));\n" +
        "export const colors = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, `hsl(${v})`])) as Record<keyof typeof c, string>;\n",
    },
    {
      path: "app/_layout.tsx",
      contents:
        `import "../global.css";\n` +
        `import { Tabs } from "expo-router";\n` +
        `import { View } from "react-native";\n` +
        `import { House } from "lucide-react-native";\n` +
        `import { theme, colors } from "@/theme/tokens";\n` +
        `export default function L(){ return <View style={theme} className="flex-1 bg-background"><Tabs screenOptions={{ tabBarActiveTintColor: colors.primary }} /></View>; }\n`,
    },
    {
      path: "components/Screen.tsx",
      contents:
        `import * as React from "react";\n` +
        `import { ScrollView, View } from "react-native";\n` +
        `import { useSafeAreaInsets } from "react-native-safe-area-context";\n` +
        `export function Screen({ children }: { children: React.ReactNode }) {\n` +
        `  const insets = useSafeAreaInsets();\n` +
        `  return <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top }}>{children}</View>;\n` +
        `}\n`,
    },
    {
      path: "app/index.tsx",
      contents:
        `import { View } from "react-native";\n` +
        `import { Screen } from "@/components/Screen";\n` +
        `import { Text } from "@/components/ui/text";\n` +
        `import { cn } from "@/lib/utils";\n` +
        `export default function Home(){\n` +
        `  const active = true;\n` +
        `  return <Screen><View className={cn("gap-3 rounded-2xl bg-card p-4", active && "border border-border")}><Text variant="headline" className="text-muted-foreground">hi</Text></View></Screen>;\n` +
        `}\n`,
    },
  ];
}

test("nativewind: a well-formed className-bearing app passes", () => {
  const r = validateManifest(nwGoodApp(), "nativewind");
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.problems.length, 0);
});

test("explicit 'classic' kit yields byte-identical results to the default", () => {
  assert.equal(
    JSON.stringify(validateManifest(goodApp(), "classic")),
    JSON.stringify(validateManifest(goodApp())),
  );
  const broken = goodApp();
  broken[2].contents += `import axios from "axios";\n`;
  broken.splice(1, 1); // drop app/_layout.tsx
  assert.equal(
    JSON.stringify(validateManifest(broken, "classic")),
    JSON.stringify(validateManifest(broken)),
  );
});

test("G6: expo-symbols is no longer an allowed dependency in either kit", () => {
  const classic = goodApp();
  classic[2].contents += `import { SymbolView } from "expo-symbols";\n`;
  const rc = validateManifest(classic);
  assert.equal(rc.ok, false);
  assert.ok(rc.problems.some((p) => p.includes("expo-symbols")));

  const nw = nwGoodApp();
  nw[2].contents += `import { SymbolView } from "expo-symbols";\n`;
  const rn = validateManifest(nw, "nativewind");
  assert.equal(rn.ok, false);
  assert.ok(rn.problems.some((p) => p.includes("expo-symbols")));
});

test("@/ path-alias imports pass in both kits (baked tsconfig @/* -> ./*)", () => {
  const classic = goodApp();
  classic[3].contents += `import { palette } from "@/theme/tokens";\n`;
  const r = validateManifest(classic);
  assert.equal(r.ok, true, r.problems.join("; "));
  // nativewind coverage: nwGoodApp() is @/-alias-heavy and passes (test above).
});

test("nativewind deps (lucide, clsx, rn-primitives, …) are allowed only in the nativewind kit", () => {
  const r = validateManifest(nwGoodApp(), "nativewind");
  assert.equal(r.ok, true, r.problems.join("; "));
  // Same files under the classic kit: nativewind/lucide imports are flagged.
  const rc = validateManifest(nwGoodApp());
  assert.equal(rc.ok, false);
  assert.ok(rc.problems.some((p) => p.includes(`"nativewind"`)));
  assert.ok(rc.problems.some((p) => p.includes(`"lucide-react-native"`)));
});

test("nativewind: arbitrary Tailwind values are flagged", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents: `import { View } from "react-native";\nexport function Promo(){ return <View className="p-[13px] w-[37%]" />; }\n`,
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /arbitrary/.test(p) && p.includes("components/Promo.tsx")));
});

test("nativewind: raw palette classes are flagged", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents: `import { View } from "react-native";\nexport function Promo(){ return <View className="flex-1 bg-blue-500" />; }\n`,
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("bg-blue-500") && /semantic/.test(p)));
});

test("nativewind: direct color classes without a shade (text-white, bg-black) are flagged", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents: `import { View, Text } from "react-native";\nexport function Promo(){ return <View className="bg-black"><Text className="text-white">x</Text></View>; }\n`,
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("bg-black")));
  assert.ok(r.problems.some((p) => p.includes("text-white")));
});

test("nativewind: \\${} interpolation inside className template literals is flagged", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents:
      `import { View } from "react-native";\n` +
      "export function Promo({ size }: { size: number }){ return <View className={`p-${size} bg-card`} />; }\n",
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /complete static string/.test(p)));
});

test("nativewind: static className template literals are NOT flagged", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents:
      `import { View } from "react-native";\n` +
      "export function Promo(){ return <View className={`flex-1 bg-card`} />; }\n",
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("nativewind: string args of cn() and cva() variant maps are scanned", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents:
      `import { View } from "react-native";\n` +
      `import { cva } from "class-variance-authority";\n` +
      `import { cn } from "@/lib/utils";\n` +
      `const promoVariants = cva("rounded-2xl", { variants: { tone: { loud: "bg-red-500" } } });\n` +
      `export function Promo(){ return <View className={cn(promoVariants({ tone: "loud" }), "p-[9px]")} />; }\n`,
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("bg-red-500")), r.problems.join("; "));
  assert.ok(r.problems.some((p) => p.includes("p-[9px]")), r.problems.join("; "));
});

test("nativewind: hex literals are flagged outside theme/tokens.ts, exempt inside it", () => {
  const files = nwGoodApp();
  files[0].contents += `// legacy reference: #3D5AFE\n`; // theme/tokens.ts — exempt
  let r = validateManifest(files, "nativewind");
  assert.equal(r.ok, true, r.problems.join("; "));

  files.push({
    path: "components/Promo.tsx",
    contents: `import { View } from "react-native";\nconst ACCENT = "#ff0000";\nexport function Promo(){ return <View style={{ backgroundColor: ACCENT }} />; }\n`,
  });
  r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("#ff0000") && p.includes("components/Promo.tsx")));
});

test("nativewind: dark: variants are flagged", () => {
  const files = nwGoodApp();
  files.push({
    path: "components/Promo.tsx",
    contents: `import { View } from "react-native";\nexport function Promo(){ return <View className="bg-card dark:bg-background" />; }\n`,
  });
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /dark:/.test(p) && /one theme/.test(p)));
});

test("nativewind G4: app/_layout.tsx must import ../global.css", () => {
  const files = nwGoodApp();
  files[1].contents = files[1].contents.replace(`import "../global.css";\n`, "");
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("global.css")));
  // Single-quote form is accepted.
  const files2 = nwGoodApp();
  files2[1].contents = files2[1].contents.replace(`import "../global.css";`, `import '../global.css';`);
  const r2 = validateManifest(files2, "nativewind");
  assert.equal(r2.ok, true, r2.problems.join("; "));
});

test("classic kit never trips the nativewind className rules", () => {
  const files = goodApp();
  files.push({
    path: "components/Promo.tsx",
    contents:
      `import { View, Text } from "react-native";\n` +
      `export function Promo(){ return <View className="p-[13px] bg-blue-500 dark:bg-black"><Text>#ff0000</Text></View>; }\n`,
  });
  const r = validateManifest(files); // default = classic
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("nativewind problems are deduped and capped at 12", () => {
  const files = nwGoodApp();
  for (let i = 0; i < 20; i++) {
    files.push({
      path: `components/Bad${i}.tsx`,
      contents: `import { View } from "react-native";\nexport function B${i}(){ return <View className="p-[${i}px] bg-blue-${i}00 dark:bg-black" />; }\n`,
    });
  }
  const r = validateManifest(files, "nativewind");
  assert.equal(r.ok, false);
  assert.ok(r.problems.length <= 12);
});
