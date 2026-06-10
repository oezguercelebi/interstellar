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
