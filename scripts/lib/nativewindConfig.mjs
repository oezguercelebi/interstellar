/**
 * Shared NativeWind config artifacts (plan G5) — the single source of truth
 * for the five ROOT config files baked into the `interstellar-studio-nw1`
 * snapshot, the dep pin lists, and the app.json/tsconfig patch snippets.
 *
 * Consumed by BOTH:
 *   - scripts/bake-snapshot.mjs   (writes these into the snapshot image)
 *   - scripts/check-template.mjs  (writes the SAME bytes into a local
 *     throwaway Expo app for tsc + tailwind verification)
 * so the local pre-bake check exercises byte-identical config to production.
 *
 * Plain node module — never import convex/ code here.
 *
 * Root config files survive the per-preview `rm -rf app components store
 * theme lib src` in convex/lib/sandbox/daytona.ts; generated apps NEVER see,
 * edit, or upload any of them (global.css included — fully forbidden infra).
 */

// Version pins (plan §0, re-verified against npm 2026-06-10):
//  - nativewind 4.2.5 EXACT — never ^4 (4.1→4.2 changed the babel story) and
//    never v5 (officially not for production use).
//  - tailwindcss 3.4.17 EXACT dev dep — never v4.
export const NATIVEWIND_PIN = "nativewind@4.2.5";
export const TAILWIND_PIN = "tailwindcss@3.4.17";

/** Installed via `npx expo install …` so Expo pins the SDK-matched version. */
export const NATIVEWIND_EXPO_DEPS = ["react-native-svg"];

/** Installed via `npm i -E …` (exact-pinned; record resolved versions in the bake log). */
export const NATIVEWIND_EXACT_DEPS = [
  NATIVEWIND_PIN,
  "lucide-react-native",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "@rn-primitives/slot",
  "@rn-primitives/separator",
];

/** Installed via `npm i -DE …`. */
export const NATIVEWIND_EXACT_DEV_DEPS = [TAILWIND_PIN];

// ---------------------------------------------------------------------------
// The five ROOT config files.
// ---------------------------------------------------------------------------

// theme.colors is REPLACED, not extended (plan G3): raw palette classes
// (bg-blue-500, text-white, bg-black) cease to compile, so the validator's
// semantic-only rule is enforced by the compiler too. Keep transparent/
// current/inherit. Slot names mirror theme/tokens.ts in the seeded kit —
// the two must stay in lockstep with the :root triplets below.
// darkMode "class": the host OS prefers-color-scheme must not pierce the
// preview iframe; one theme per app, mode lives in the tokens triplets.
const TAILWIND_CONFIG_JS = `/** Baked at snapshot time — generated apps never edit this file. */
module.exports = {
  darkMode: "class",
  presets: [require("nativewind/preset")],
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      background: "hsl(var(--background) / <alpha-value>)",
      foreground: "hsl(var(--foreground) / <alpha-value>)",
      card: "hsl(var(--card) / <alpha-value>)",
      "card-foreground": "hsl(var(--card-foreground) / <alpha-value>)",
      primary: "hsl(var(--primary) / <alpha-value>)",
      "primary-foreground": "hsl(var(--primary-foreground) / <alpha-value>)",
      secondary: "hsl(var(--secondary) / <alpha-value>)",
      "secondary-foreground": "hsl(var(--secondary-foreground) / <alpha-value>)",
      muted: "hsl(var(--muted) / <alpha-value>)",
      "muted-foreground": "hsl(var(--muted-foreground) / <alpha-value>)",
      accent: "hsl(var(--accent) / <alpha-value>)",
      "accent-foreground": "hsl(var(--accent-foreground) / <alpha-value>)",
      destructive: "hsl(var(--destructive) / <alpha-value>)",
      "destructive-foreground": "hsl(var(--destructive-foreground) / <alpha-value>)",
      success: "hsl(var(--success) / <alpha-value>)",
      warning: "hsl(var(--warning) / <alpha-value>)",
      border: "hsl(var(--border) / <alpha-value>)",
      input: "hsl(var(--input) / <alpha-value>)",
      ring: "hsl(var(--ring) / <alpha-value>)",
    },
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
    },
  },
  plugins: [],
};
`;

// :root carries the default light shadcn triplets matching the seeded
// theme/tokens.ts defaults — a pre-vars() fallback, and what keeps classic /
// StyleSheet-only apps building on the superset snapshot. --radius is baked
// here (0.75rem) and never seeded: radius personality comes from classes.
const GLOBAL_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 4%;
    --card: 240 5% 98%;
    --card-foreground: 240 10% 4%;
    --primary: 231 99% 62%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 5% 96%;
    --secondary-foreground: 240 6% 10%;
    --muted: 240 5% 96%;
    --muted-foreground: 240 4% 46%;
    --accent: 231 100% 95%;
    --accent-foreground: 231 80% 40%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --success: 142 71% 45%;
    --warning: 38 92% 50%;
    --border: 240 6% 90%;
    --input: 240 6% 90%;
    --ring: 231 99% 62%;
    --radius: 0.75rem;
  }
}
`;

const BABEL_CONFIG_JS = `module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
`;

const METRO_CONFIG_JS = `const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

module.exports = withNativeWind(getDefaultConfig(__dirname), {
  input: "./global.css",
});
`;

// MUST be named nativewind-env.d.ts (NOT nativewind.d.ts — that name shadows
// the package's own types and breaks them). Without this file the sandbox
// tsc-repair loop drowns in className / css-import errors.
const NATIVEWIND_ENV_DTS = `/// <reference types="nativewind/types" />
declare module "*.css";
`;

/** The five root config files, in write order. */
export const NATIVEWIND_CONFIG_FILES = [
  { path: "tailwind.config.js", contents: TAILWIND_CONFIG_JS },
  { path: "global.css", contents: GLOBAL_CSS },
  { path: "babel.config.js", contents: BABEL_CONFIG_JS },
  { path: "metro.config.js", contents: METRO_CONFIG_JS },
  { path: "nativewind-env.d.ts", contents: NATIVEWIND_ENV_DTS },
];

// ---------------------------------------------------------------------------
// Patch snippets — `node -e` bodies for the two JSON patches applied by BOTH
// scripts/bake-snapshot.mjs and scripts/check-template.mjs.
// Single-quoted JS only, so they stay shell-safe inside double quotes.
// ---------------------------------------------------------------------------

/** app.json: typedRoutes off; metro bundler + static single-page web output. */
export const APP_JSON_PATCH_JS =
  "const f='app.json';const j=JSON.parse(require('fs').readFileSync(f));j.expo.experiments={typedRoutes:false};j.expo.web=Object.assign({bundler:'metro',output:'single'},j.expo.web||{});require('fs').writeFileSync(f,JSON.stringify(j,null,2))";

/** tsconfig.json: @/* → ./* path alias (kit code imports via @/…). */
export const TSCONFIG_PATCH_JS =
  "const f='tsconfig.json';const j=JSON.parse(require('fs').readFileSync(f));j.compilerOptions=j.compilerOptions||{};j.compilerOptions.paths={'@/*':['./*']};require('fs').writeFileSync(f,JSON.stringify(j,null,2))";

/**
 * Shell command writing `contents` to `filePath` via base64 — immune to
 * shell-quoting damage (backticks, $, quotes) in the config bodies.
 */
export function b64WriteCommand(filePath, contents) {
  const b64 = Buffer.from(contents, "utf8").toString("base64");
  return `node -e "require('fs').writeFileSync('${filePath}', Buffer.from('${b64}','base64'))"`;
}
