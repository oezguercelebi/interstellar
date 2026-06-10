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
const REQUIRED_FILES = ["app/_layout.tsx", "theme/tokens.ts", "components/Screen.tsx"];

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

/** Additional bare modules available in the NativeWind-baked snapshot. */
export const ALLOWED_DEPS_NATIVEWIND = new Set([
  ...ALLOWED_DEPS,
  "nativewind",
  "lucide-react-native",
  "react-native-svg",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "@rn-primitives/slot",
  "@rn-primitives/separator",
]);

function bareModule(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  // "@/…" is the baked tsconfig path alias (@/* -> ./*), not a bare module.
  if (spec.startsWith("@/")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

// ── NativeWind-only className rules (kit "nativewind") ───────────────────────
// Pure-regex checks over extracted class strings, same dedupe/cap mechanism as
// the rest of the validator. Extraction targets: className="…" /
// className={'…'} / className={`…`} attributes (incl. *ClassName props like
// contentContainerClassName) and string args of cn(…)/cva(…) — sound because
// Tailwind mandates complete unbroken class strings in source text.

/** An extracted class-string candidate; `template` marks template literals. */
export interface ClassCandidate {
  value: string;
  template: boolean;
}

/** Extract class-string candidates from a .ts/.tsx source file. */
export function extractClassCandidates(src: string): ClassCandidate[] {
  const out: ClassCandidate[] = [];
  // className="…" | className={'…'} | className={`…`} (suffix-matches *ClassName).
  const attrRe =
    /lassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(src))) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    out.push({ value, template: m[5] !== undefined });
  }
  // Every string literal inside a cn(…)/cva(…) call span (paren-depth walk;
  // covers cva's nested variant maps too).
  const calleeRe = /\b(?:cn|cva)\s*\(/g;
  while ((m = calleeRe.exec(src))) {
    let i = calleeRe.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1;
        let buf = "";
        while (j < src.length && src[j] !== ch) {
          if (src[j] === "\\") {
            buf += src[j] + (src[j + 1] ?? "");
            j += 2;
            continue;
          }
          buf += src[j];
          j += 1;
        }
        out.push({ value: buf, template: ch === "`" });
        i = j;
      }
      i++;
    }
    calleeRe.lastIndex = i;
  }
  return out;
}

/** Tailwind arbitrary values (p-[13px], text-[#fff], w-[37%]). */
const ARBITRARY_VALUE_RE = /(?:^|[\s"'`])[\w-]+-\[[^\]]+\]/;

/** Raw Tailwind palette + direct color classes — do not compile (theme.colors is replaced). */
const RAW_PALETTE_RE =
  /(?:bg|text|border|from|via|to|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?\b/;

/** Hex color literal anywhere in source. */
const HEX_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b/;

/** G4: the load-bearing side-effect import in app/_layout.tsx. */
const GLOBAL_CSS_IMPORT_RE = /import\s+["']\.\.\/global\.css["']/;

function nativewindProblems(files: ValidatableFile[], byPath: Map<string, ValidatableFile>): string[] {
  const problems: string[] = [];

  // G4: without the global.css import the entire app renders unstyled with no
  // crash signal (side-effect imports are invisible to the dep-import regex).
  const layout = byPath.get("app/_layout.tsx");
  if (layout && !GLOBAL_CSS_IMPORT_RE.test(layout.contents)) {
    problems.push(
      'app/_layout.tsx: must keep `import "../global.css"` — without it Tailwind styles never load and the app renders unstyled.',
    );
  }

  for (const f of files) {
    if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;

    // Hex literals live only in theme/tokens.ts (and even there as HSL triplets).
    if (f.path !== "theme/tokens.ts") {
      const hex = HEX_LITERAL_RE.exec(f.contents);
      if (hex) {
        problems.push(
          `${f.path}: hex color literal "${hex[0]}" — colors are defined in theme/tokens.ts and used via semantic classes (or colors.* for navigator props).`,
        );
      }
    }

    for (const cand of extractClassCandidates(f.contents)) {
      if (cand.template && cand.value.includes("${")) {
        problems.push(
          `${f.path}: className must be a complete static string (Tailwind scans source text) — never interpolate class fragments; select whole strings via cn().`,
        );
      }
      const arb = ARBITRARY_VALUE_RE.exec(cand.value);
      if (arb) {
        problems.push(
          `${f.path}: arbitrary Tailwind value "${arb[0].trim()}" — no arbitrary values; use scale classes / semantic colors.`,
        );
      }
      const raw = RAW_PALETTE_RE.exec(cand.value);
      if (raw) {
        problems.push(
          `${f.path}: raw palette class "${raw[0]}" does not compile here — semantic color classes only (bg-background, bg-card, text-muted-foreground, …).`,
        );
      }
      if (cand.value.includes("dark:")) {
        problems.push(
          `${f.path}: no "dark:" variants — one theme per app; mode lives in the theme/tokens.ts triplets.`,
        );
      }
    }
  }
  return problems;
}

export function validateManifest(
  allFiles: ValidatableFile[],
  kit: "classic" | "nativewind" = "classic",
): ValidationResult {
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
  const allowedDeps = kit === "nativewind" ? ALLOWED_DEPS_NATIVEWIND : ALLOWED_DEPS;
  const importRe = /(?:import[^"']*?from\s*|require\(\s*)["']([^"']+)["']/g;
  for (const f of files) {
    if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(f.contents))) {
      const mod = bareModule(m[1]);
      if (mod && !allowedDeps.has(mod)) {
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

  if (kit === "nativewind") {
    problems.push(...nativewindProblems(files, byPath));
  }

  const unique = [...new Set(problems)].slice(0, 12);
  return { ok: unique.length === 0, problems: unique };
}
