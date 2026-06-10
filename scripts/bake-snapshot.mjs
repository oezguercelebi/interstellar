// Bake the `interstellar-studio` Daytona snapshot: an Expo Router project with all
// allowed deps pre-installed AND enough memory (4GB) that `expo export -p web`
// won't get OOM-killed. Snapshot resources can ONLY be set when creating from an
// Image (not when creating a sandbox from a snapshot), so resources live here.
import { Daytona, Image } from "@daytonaio/sdk";
import fs from "fs";

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
const NAME = "interstellar-studio";

const DEPS = [
  "react-dom", "react-native-web", "@expo/metro-runtime",
  "expo-linear-gradient", "expo-haptics", "expo-blur", "expo-image",
  "expo-font", "expo-constants", "expo-system-ui", "expo-status-bar",
  "@expo/vector-icons", "react-native-reanimated", "react-native-worklets",
  "react-native-safe-area-context", "react-native-screens",
  "react-native-gesture-handler", "@react-navigation/native",
  "@react-navigation/bottom-tabs",
].join(" ");

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
    "cd /home/daytona/expo-app && rm -rf src app components constants hooks scripts theme store app-example && mkdir -p app",
    // Minimal runnable placeholder.
    `cd /home/daytona/expo-app && printf 'import { Stack } from \"expo-router\";\\nexport default function L(){return <Stack screenOptions={{headerShown:false}}/>;}\\n' > app/_layout.tsx`,
    `cd /home/daytona/expo-app && printf 'import { View, Text } from \"react-native\";\\nexport default function I(){return <View style={{flex:1,alignItems:\"center\",justifyContent:\"center\"}}><Text>Interstellar ready</Text></View>;}\\n' > app/index.tsx`,
    // Static single-page web output; drop reactCompiler; @/* -> ./*.
    `cd /home/daytona/expo-app && node -e "const f='app.json';const j=JSON.parse(require('fs').readFileSync(f));j.expo.experiments={typedRoutes:false};j.expo.web=Object.assign({bundler:'metro',output:'single'},j.expo.web||{});require('fs').writeFileSync(f,JSON.stringify(j,null,2))"`,
    `cd /home/daytona/expo-app && node -e "const f='tsconfig.json';const j=JSON.parse(require('fs').readFileSync(f));j.compilerOptions=j.compilerOptions||{};j.compilerOptions.paths={'@/*':['./*']};require('fs').writeFileSync(f,JSON.stringify(j,null,2))"`,
    `cd /home/daytona/expo-app && npx expo install ${DEPS}`,
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
