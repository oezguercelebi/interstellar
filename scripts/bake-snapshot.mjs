// Bake Daytona snapshots for the interstellar-studio project.
//
// Usage:
//   node scripts/bake-snapshot.mjs           # bakes nw1 (default)
//   node scripts/bake-snapshot.mjs --nw2     # bakes nw2 (agent-runner + SDK)
//   SNAPSHOT_NAME=my-name node scripts/bake-snapshot.mjs --nw2  # override name
//
// nw1 recipe: Expo Router project with the full NativeWind toolchain pre-installed
//   and an `expo export -p web` smoke test for cache warm.
//
// nw2 recipe: STRICT SUPERSET of nw1 PLUS:
//   1. /home/daytona/agent-runner/ — sibling dir with its own package.json
//      pinning @anthropic-ai/claude-agent-sdk@<exact> + run.mjs uploaded there.
//      NEVER inside /home/daytona/expo-app (Metro resolution + per-provision rm).
//   2. git init + git commit of the scaffold at image time (retry checkpoint).
//   3. Bake-time smokes: expo export -p web  +  node run.mjs --self-test
//      +  SDK dynamic-import check.
//   Same resources as nw1 (cpu:4 mem:4 disk:10).
//
// NEVER overwrite/delete nw1 — the nw1 snapshot is the live production snapshot
// until DAYTONA_SNAPSHOT is flipped. See plan §4 step 6.
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

// ── CLI / env ────────────────────────────────────────────────────────────────
const IS_NW2 = process.argv.includes("--nw2");

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
const NW1_NAME = "interstellar-studio-nw1";
const NW2_DEFAULT_NAME = "interstellar-studio-nw2";

const NAME = IS_NW2
  ? (process.env.SNAPSHOT_NAME || NW2_DEFAULT_NAME)
  : NW1_NAME;

if (!IS_NW2 && NAME !== NW1_NAME) {
  // safety: nw1 path should never resolve a different name
  throw new Error(`nw1 path resolved unexpected name: ${NAME}`);
}
if (IS_NW2 && NAME === NW1_NAME) {
  throw new Error("Refusing to bake nw2 over the live nw1 name. Unset SNAPSHOT_NAME or choose a different value.");
}

// ── Dep lists ────────────────────────────────────────────────────────────────
const DEPS = [
  "react-dom", "react-native-web", "@expo/metro-runtime",
  "expo-linear-gradient", "expo-haptics", "expo-blur", "expo-image",
  "expo-font", "expo-constants", "expo-system-ui", "expo-status-bar",
  "@expo/vector-icons", "react-native-reanimated", "react-native-worklets",
  "react-native-safe-area-context", "react-native-screens",
  "react-native-gesture-handler", "@react-navigation/native",
  "@react-navigation/bottom-tabs",
].join(" ");

// @anthropic-ai/claude-agent-sdk exact pin — resolved from npm 2026-06-11.
// Rebake required per SDK upgrade (plan §9.5 — default: baked + pinned).
const AGENT_SDK_VERSION = "0.3.173";
const AGENT_SDK_PIN = `@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}`;

const APP = "cd /home/daytona/expo-app";
const RUNNER = "cd /home/daytona/agent-runner";

// ── Placeholder app ──────────────────────────────────────────────────────────
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

// ── agent-runner package.json ─────────────────────────────────────────────────
// Minimal standalone package for the agent-runner sibling dir.
// Must NOT appear in expo-app — Metro would try to resolve it.
const AGENT_RUNNER_PACKAGE_JSON = JSON.stringify({
  name: "agent-runner",
  version: "1.0.0",
  type: "module",
  private: true,
  description: "Interstellar agent runner — Claude Agent SDK wrapper",
  dependencies: {
    "@anthropic-ai/claude-agent-sdk": AGENT_SDK_VERSION,
  },
}, null, 2);

// ── NW1 shared steps (used by both recipes) ──────────────────────────────────
const NW1_STEPS = [
  "useradd -m -s /bin/bash daytona || true",
  "apt-get update -y && apt-get install -y libnspr4 libnss3 libasound2 git curl && rm -rf /var/lib/apt/lists/*",
  "mkdir -p /home/daytona && chown -R daytona:daytona /home/daytona",
];

const NW1_APP_STEPS = [
  "cd /home/daytona && npx --yes create-expo-app@latest expo-app --template default --yes",
  // Normalize to a clean ROOT app/ layout.
  `${APP} && rm -rf src app components constants hooks scripts theme store app-example && mkdir -p app`,
  // Minimal runnable placeholder (base64-written — immune to shell quoting).
  `${APP} && ${b64WriteCommand("app/_layout.tsx", PLACEHOLDER_LAYOUT)}`,
  `${APP} && ${b64WriteCommand("app/index.tsx", PLACEHOLDER_INDEX)}`,
  // Static single-page web output; drop reactCompiler; @/* -> ./**.
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
];

// ── NW1-only smoke + global deps (workdir stays expo-app) ────────────────────
const NW1_SMOKE_STEPS = [
  // Smoke test + cache warm: one full Metro+NativeWind web export at bake
  // time. A broken babel/metro/tailwind pipeline fails HERE, not in a paid run.
  `${APP} && CI=1 EXPO_NO_TELEMETRY=1 npx expo export -p web && rm -rf dist`,
  "npm i -g serve@14 || npm i -g serve",
  "chown -R daytona:daytona /home/daytona",
];

// ── NW2 additional steps ──────────────────────────────────────────────────────
// run.mjs contents read from the local repo at bake-script execution time.
const RUN_MJS_CONTENTS = fs.readFileSync(
  new URL("./agent-runner/run.mjs", import.meta.url),
  "utf8",
);

// Docker rejects Dockerfile lines >65535 bytes; run.mjs base64 exceeds that.
// Chunk the base64 into appended pieces, then decode once at the end.
function b64WriteCommandsChunked(filePath, contents, chunkSize = 40_000) {
  const b64 = Buffer.from(contents, "utf8").toString("base64");
  const tmp = `/tmp/${filePath.replaceAll("/", "_")}.b64`;
  const cmds = [`rm -f ${tmp}`];
  for (let i = 0; i < b64.length; i += chunkSize) {
    cmds.push(`echo '${b64.slice(i, i + chunkSize)}' >> ${tmp}`);
  }
  cmds.push(
    `node -e "const fs=require('fs');fs.writeFileSync('${filePath}', Buffer.from(fs.readFileSync('${tmp}','utf8').replace(/\\n/g,''),'base64'))" && rm -f ${tmp}`,
  );
  return cmds;
}

const NW2_EXTRA_STEPS = [
  // 1. Create agent-runner sibling dir — NEVER inside expo-app.
  "mkdir -p /home/daytona/agent-runner",
  // Write package.json (base64 to avoid quoting issues with JSON).
  `${RUNNER} && ${b64WriteCommand("package.json", AGENT_RUNNER_PACKAGE_JSON)}`,
  // Write run.mjs (read from repo at bake-script execution time; chunked —
  // a single-line base64 write tripped Docker's 64KB Dockerfile-line limit).
  ...b64WriteCommandsChunked("run.mjs", RUN_MJS_CONTENTS).map(
    (c) => `${RUNNER} && ${c}`,
  ),
  // Install the SDK — exact-pinned, offline-available after this point.
  `${RUNNER} && npm install`,
  // Record the installed SDK version in the bake log.
  `${RUNNER} && npm ls --depth=0`,

  // 2. git checkpoint of the expo-app scaffold (enables git-reset retries).
  //    Fixed git identity for deterministic commits across rebuilds.
  `${APP} && git init`,
  `${APP} && git config user.email "bake@interstellar-studio.internal"`,
  `${APP} && git config user.name "Interstellar Bake"`,
  `${APP} && git add -A`,
  `${APP} && git commit -m "chore: baked expo-app scaffold checkpoint"`,

  // Smoke tests + cache warm.
  // 3a. expo export (same as nw1).
  `${APP} && CI=1 EXPO_NO_TELEMETRY=1 npx expo export -p web && rm -rf dist`,
  // 3b. agent-runner --self-test: exercises forbidden/overlay/decision/report/token.
  `${RUNNER} && node run.mjs --self-test`,
  // 3c. Verify SDK dynamic import resolves (the import the runner does at runtime).
  `${RUNNER} && node -e "import('@anthropic-ai/claude-agent-sdk').then(m => { if (!m.query) throw new Error('query export missing'); process.exit(0); })"`,

  "npm i -g serve@14 || npm i -g serve",
  "chown -R daytona:daytona /home/daytona",
];

// ── Build the image ──────────────────────────────────────────────────────────
// Project lives at /home/daytona/expo-app with a ROOT app/ dir
// (generated apps use relative imports, so a root layout resolves cleanly).
// That path is mirrored as SANDBOX_APP_ROOT in convex/lib/sandbox/types.ts — keep them in sync.
const image = Image.base("node:20-bookworm")
  .runCommands(...NW1_STEPS)
  .workdir("/home/daytona")
  .runCommands(
    ...NW1_APP_STEPS,
    ...(IS_NW2 ? NW2_EXTRA_STEPS : NW1_SMOKE_STEPS),
  )
  .workdir("/home/daytona/expo-app");

log(
  IS_NW2 ? "baking nw2 (nw1 + agent-runner + SDK + git checkpoint)" : "baking nw1",
  "→ snapshot:", NAME,
  "with cpu:4 memory:4 disk:10 …",
);
if (IS_NW2) {
  log("SDK pin:", AGENT_SDK_PIN);
}

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
