// Bake the `interstellar-studio-nw1` Daytona snapshot: an Expo Router project
// with all allowed deps pre-installed — the classic StyleSheet set PLUS the
// NativeWind toolchain, so ONE superset snapshot runs BOTH starter kits — and
// enough memory (4GB) that `expo export -p web` won't get OOM-killed (the bake
// runs that export once itself, as a smoke test + Metro cache warm). Snapshot
// resources can ONLY be set when creating from an Image (not when creating a
// sandbox from a snapshot), so resources live here.
import { Daytona, Image } from "@daytonaio/sdk";
import fs from "fs";

import {
  APP_JSON_PATCH_JS,
  NATIVEWIND_CONFIG_FILES,
  NATIVEWIND_EXACT_DEPS,
  NATIVEWIND_EXACT_DEV_DEPS,
  NATIVEWIND_EXPO_DEPS,
  TSCONFIG_PATCH_JS,
  b64WriteCommand,
} from "./lib/nativewindConfig.mjs";

let envFile = "";
try {
  envFile = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
} catch {
  // no .env.local — fall back to the real environment below
}
const g = (k) =>
  (envFile.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim() || process.env[k];
const daytona = new Daytona({ apiKey: g("DAYTONA_API_KEY"), apiUrl: g("DAYTONA_API_URL") });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
// NEVER rebake over the live snapshot name — bump the suffix instead, then flip
// DAYTONA_SNAPSHOT (rollout order in README). Automated sandbox cleanup
// (scripts/lib/sandboxLifecycle.mjs) scopes to DAYTONA_SNAPSHOT, so a rename
// needs one manual sweep of old-named sandboxes after cutover.
const NAME = "interstellar-studio-nw1";

const DEPS = [
  "react-dom", "react-native-web", "@expo/metro-runtime",
  "expo-linear-gradient", "expo-haptics", "expo-blur", "expo-image",
  "expo-font", "expo-constants", "expo-system-ui", "expo-status-bar",
  "@expo/vector-icons", "react-native-reanimated", "react-native-worklets",
  "react-native-safe-area-context", "react-native-screens",
  "react-native-gesture-handler", "@react-navigation/native",
  "@react-navigation/bottom-tabs",
].join(" ");

const APP = "cd /home/daytona/expo-app";

// Placeholder app — exercises the FULL NativeWind pipeline (global.css import +
// className) so a broken babel/metro/tailwind config fails at bake time, not at
// the first paid preview. Every preview replaces it (`rm -rf app …` + upload).
const PLACEHOLDER_LAYOUT = `import "../global.css";
import { Stack } from "expo-router";
export default function L() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
`;
const PLACEHOLDER_INDEX = `import { Text, View } from "react-native";
export default function I() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-foreground">Interstellar ready</Text>
    </View>
  );
}
`;

// Build the image. Project lives at /home/daytona/expo-app with a ROOT app/ dir
// (generated apps use relative imports, so a root layout resolves cleanly).
// That path is mirrored as SANDBOX_APP_ROOT in convex/lib/sandbox/types.ts — keep them in sync.
const image = Image.base("node:20-bookworm")
  .runCommands(
    "useradd -m -s /bin/bash daytona || true",
    "apt-get update -y && apt-get install -y libnspr4 libnss3 libasound2 git curl && rm -rf /var/lib/apt/lists/*",
    "mkdir -p /home/daytona && chown -R daytona:daytona /home/daytona",
  )
  .workdir("/home/daytona")
  .runCommands(
    "cd /home/daytona && npx --yes create-expo-app@latest expo-app --template default --yes",
    // Normalize to a clean ROOT app/ layout.
    `${APP} && rm -rf src app components constants hooks scripts theme store app-example && mkdir -p app`,
    // Minimal runnable placeholder (base64-written — immune to shell quoting).
    `${APP} && ${b64WriteCommand("app/_layout.tsx", PLACEHOLDER_LAYOUT)}`,
    `${APP} && ${b64WriteCommand("app/index.tsx", PLACEHOLDER_INDEX)}`,
    // Static single-page web output; drop reactCompiler; @/* -> ./*.
    // Shared patch snippets — byte-identical to scripts/check-template.mjs.
    `${APP} && node -e "${APP_JSON_PATCH_JS}"`,
    `${APP} && node -e "${TSCONFIG_PATCH_JS}"`,
    // Classic dep set (Expo pins SDK-matched versions) …
    `${APP} && npx expo install ${DEPS}`,
    // … plus the NativeWind universe: SDK-pinned svg via expo install, the rest
    // exact-pinned (-E). nativewind@4.2.5 EXACT (never ^4 / v5); tailwindcss
    // 3.4.17 EXACT dev dep (never v4). Pins live in scripts/lib/nativewindConfig.mjs.
    `${APP} && npx expo install ${NATIVEWIND_EXPO_DEPS.join(" ")}`,
    `${APP} && npm i -E ${NATIVEWIND_EXACT_DEPS.join(" ")}`,
    `${APP} && npm i -DE ${NATIVEWIND_EXACT_DEV_DEPS.join(" ")}`,
    // Record the resolved nativewind-universe versions in the bake log.
    `${APP} && (npm ls --depth=0 nativewind tailwindcss react-native-svg lucide-react-native clsx tailwind-merge class-variance-authority @rn-primitives/slot @rn-primitives/separator || true)`,
    // The five ROOT config files (shared bodies — same bytes check-template.mjs
    // verifies locally). Root files survive the per-preview
    // `rm -rf app components store theme lib src` in convex/lib/sandbox/daytona.ts;
    // generated apps never see or edit them (global.css included).
    ...NATIVEWIND_CONFIG_FILES.map((f) => `${APP} && ${b64WriteCommand(f.path, f.contents)}`),
    // Smoke test + cache warm: one full Metro+NativeWind web export at bake
    // time. A broken babel/metro/tailwind pipeline fails HERE, not in a paid run.
    `${APP} && CI=1 EXPO_NO_TELEMETRY=1 npx expo export -p web && rm -rf dist`,
    "npm i -g serve@14 || npm i -g serve",
    "chown -R daytona:daytona /home/daytona",
  )
  .workdir("/home/daytona/expo-app");

log("creating snapshot", NAME, "with cpu:4 memory:4 disk:10 …");
try {
  await daytona.snapshot.create(
    { name: NAME, image, resources: { cpu: 4, memory: 4, disk: 10 } },
    { onLogs: (l) => process.stdout.write(l) },
  );
} catch (e) {
  log("create threw (may still be building):", String(e).slice(0, 200));
}

// Poll until active.
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    const s = await daytona.snapshot.get(NAME);
    log("state:", s.state ?? s.status);
    if ((s.state ?? s.status) === "active") { log("✅ snapshot active"); break; }
  } catch (e) { log("poll:", String(e).slice(0, 80)); }
}
fs.writeFileSync("/tmp/bake.txt", "done\n");
