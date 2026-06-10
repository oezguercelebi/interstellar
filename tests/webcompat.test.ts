// L1 pure-static tests for the web-compat codemod. Imports the REAL source
// (Node strips TS types), so there's no drifting copy to maintain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repairWebCompat, repairFiles, type RepairableFile } from "../convex/lib/webcompat.ts";

test("safe-area: multiline RN import moves useSafeAreaInsets to safe-area-context", () => {
  const out = repairWebCompat(`import {\n  View,\n  Alert,\n  useSafeAreaInsets,\n} from "react-native";\n`);
  assert.match(out, /import \{ useSafeAreaInsets \} from "react-native-safe-area-context";/);
  assert.match(out, /import \{ View, Alert \} from "react-native";/);
});

test("safe-area: SafeAreaView moves out of the react-native block", () => {
  const out = repairWebCompat(`import {\n  View,\n  SafeAreaView,\n  ScrollView,\n} from "react-native";\n`);
  assert.match(out, /import \{ SafeAreaView \} from "react-native-safe-area-context";/);
  assert.match(out, /import \{ View, ScrollView \} from "react-native";/);
});

test("safe-area: when it's the only named import, the RN import is dropped", () => {
  const out = repairWebCompat(`import { useSafeAreaInsets } from "react-native";\nconst x=1;\n`);
  assert.match(out, /import \{ useSafeAreaInsets \} from "react-native-safe-area-context";/);
  assert.doesNotMatch(out, /from "react-native";/);
  assert.match(out, /const x=1;/);
});

test("safe-area: merges into an existing safe-area-context import", () => {
  const out = repairWebCompat(
    `import { SafeAreaProvider } from "react-native-safe-area-context";\nimport { View, useSafeAreaInsets } from "react-native";\n`,
  );
  assert.match(out, /import \{ SafeAreaProvider, useSafeAreaInsets \} from "react-native-safe-area-context";/);
  assert.match(out, /import \{ View \} from "react-native";/);
});

test("default-import: expo-linear-gradient default becomes named", () => {
  const out = repairWebCompat(`import LinearGradient from "expo-linear-gradient";\n`);
  assert.equal(out.trim(), `import { LinearGradient } from "expo-linear-gradient";`);
});

test("default-import: odd local name is aliased", () => {
  const out = repairWebCompat(`import LG from "expo-linear-gradient";\n`);
  assert.match(out, /import \{ LinearGradient as LG \} from "expo-linear-gradient";/);
});

test("default-import: expo-blur + expo-image become named", () => {
  assert.match(repairWebCompat(`import BlurView from 'expo-blur';\n`), /import \{ BlurView \} from 'expo-blur';/);
  assert.match(repairWebCompat(`import Image from "expo-image";\n`), /import \{ Image \} from "expo-image";/);
});

test("identity: already-correct imports are untouched", () => {
  for (const src of [
    `import { LinearGradient } from "expo-linear-gradient";\n`,
    `import * as Haptics from "expo-haptics";\n`,
    `import Constants from "expo-constants";\n`, // expo-constants HAS a real default
    `import Animated, { FadeInDown } from "react-native-reanimated";\n`,
    `import { View, Text } from "react-native";\nimport { LinearGradient } from "expo-linear-gradient";\n`,
  ]) {
    assert.equal(repairWebCompat(src), src, `should be identity: ${src}`);
  }
});

test("combined safe-area + linear-gradient (real index.tsx shape) fixes both", () => {
  const out = repairWebCompat(
    `import {\n  View,\n  Alert,\n  useSafeAreaInsets,\n} from "react-native";\nimport LinearGradient from "expo-linear-gradient";\n`,
  );
  assert.match(out, /from "react-native-safe-area-context";/);
  assert.match(out, /import \{ LinearGradient \} from "expo-linear-gradient";/);
});

test("idempotent: running twice equals running once", () => {
  const dirty = `import {\n  View,\n  useSafeAreaInsets,\n} from "react-native";\nimport LinearGradient from "expo-linear-gradient";\n`;
  const once = repairWebCompat(dirty);
  assert.equal(repairWebCompat(once), once);
});

test("repairFiles only returns changed .ts/.tsx files, skips deleted + non-source", () => {
  const input: RepairableFile[] = [
    { path: "app/index.tsx", contents: `import { useSafeAreaInsets } from "react-native";\n` },
    { path: "app/clean.tsx", contents: `import { View } from "react-native";\n` },
    { path: "README.md", contents: `import { useSafeAreaInsets } from "react-native";\n` },
    { path: "app/gone.tsx", contents: `import { useSafeAreaInsets } from "react-native";\n`, deleted: true },
  ];
  const changed = repairFiles(input);
  const paths = changed.map((f) => f.path);
  assert.deepEqual(paths, ["app/index.tsx"]);
  assert.match(changed[0].contents, /react-native-safe-area-context/);
});
