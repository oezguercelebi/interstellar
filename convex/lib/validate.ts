/**
 * Pure validation for a generated Expo app. This is the hard gate the model
 * cannot talk past: the `finalize` tool runs it and any problems are fed back
 * into the generation loop for self-healing. No Convex imports.
 *
 * The agent owns the *app code* (screens, theme, components). The sandbox
 * provides the Expo project scaffold (package.json/app.json/tsconfig/babel) via
 * `create-expo-app`, so the agent never has to get pinned native versions right —
 * it just has to import from the allowed set.
 */

import { SAFE_AREA_NAMES, DEFAULT_TO_NAMED } from "./webcompat.ts";

export interface ValidatableFile {
  path: string;
  contents: string;
  deleted?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/** Files every generated app must contain. */
const REQUIRED_FILES = ["app/_layout.tsx", "theme/tokens.ts"];

/** A real screen (not the layout) must exist under app/. */
const SCREEN_RE = /^app\/.*\.tsx$/;

/** Bare modules the sandbox can resolve (installed via `expo install`). */
export const ALLOWED_DEPS = new Set([
  "expo",
  "expo-router",
  "expo-linear-gradient",
  "expo-status-bar",
  "expo-font",
  "expo-haptics",
  "expo-blur",
  "expo-image",
  "expo-constants",
  "expo-system-ui",
  "expo-symbols",
  "react",
  "react-native",
  "react-native-safe-area-context",
  "react-native-screens",
  "react-native-reanimated",
  "react-native-gesture-handler",
  "@expo/vector-icons",
  "@react-navigation/native",
  "@react-navigation/bottom-tabs",
]);

function bareModule(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function validateManifest(allFiles: ValidatableFile[]): ValidationResult {
  const files = allFiles.filter((f) => !f.deleted);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const problems: string[] = [];

  for (const req of REQUIRED_FILES) {
    if (!byPath.has(req)) problems.push(`Missing required file: ${req}`);
  }

  if (!files.some((f) => SCREEN_RE.test(f.path) && f.path !== "app/_layout.tsx")) {
    problems.push("No screen found — add at least one screen under app/ (e.g. app/index.tsx).");
  }

  // Every bare import must be in the allowed dependency set.
  const importRe = /(?:import[^"']*?from\s*|require\(\s*)["']([^"']+)["']/g;
  for (const f of files) {
    if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(f.contents))) {
      const mod = bareModule(m[1]);
      if (mod && !ALLOWED_DEPS.has(mod)) {
        problems.push(`${f.path}: imports "${mod}", which is not in the allowed dependency set.`);
      }
    }
  }

  // Safe-area APIs don't exist on react-native-web; importing them from
  // "react-native" crashes the preview at render. They must come from
  // react-native-safe-area-context. (Match multi-line import blocks too.)
  const rnNamed = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']react-native["']/g;
  for (const f of files) {
    if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;
    let m: RegExpExecArray | null;
    while ((m = rnNamed.exec(f.contents))) {
      const bad = m[1]
        .split(",")
        .map((s) => s.split(/\s+as\s+/)[0].trim())
        .filter((n) => SAFE_AREA_NAMES.has(n));
      if (bad.length) {
        problems.push(
          `${f.path}: import ${bad.join(", ")} from "react-native-safe-area-context", not "react-native" (they don't exist on web).`,
        );
      }
    }
  }

  // Named-only Expo packages must use a named import; a default import resolves
  // to undefined on web ("Element type is invalid … got: undefined").
  for (const f of files) {
    if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;
    for (const [pkg, canonical] of Object.entries(DEFAULT_TO_NAMED)) {
      const re = new RegExp(`import\\s+[\\w$]+\\s+from\\s+["']${pkg}["']`);
      if (re.test(f.contents)) {
        problems.push(
          `${f.path}: import { ${canonical} } from "${pkg}" (named export) — a default import resolves to undefined on web.`,
        );
      }
    }
  }

  const unique = [...new Set(problems)].slice(0, 12);
  return { ok: unique.length === 0, problems: unique };
}
