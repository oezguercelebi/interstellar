/**
 * Deterministic web-compatibility repair for generated Expo apps. No Convex imports.
 *
 * The preview runs on Expo **web**, where `react-native` is aliased to
 * `react-native-web` and several Expo packages expose components only as named
 * exports. Two model mistakes crash the app at render there:
 *
 *   1. Safe-area APIs (useSafeAreaInsets, SafeAreaView, …) imported from
 *      "react-native" — they live in "react-native-safe-area-context" and don't
 *      exist on react-native-web → `(0, _rnwIndex.useSafeAreaInsets) is not a function`.
 *   2. A default import of a named-only package (e.g. `import LinearGradient from
 *      "expo-linear-gradient"`) resolves to `undefined` → "Element type is invalid
 *      … got: undefined".
 *
 * This codemod fixes both. It runs at generation time (so stored source is
 * correct) and again before the sandbox upload (so older apps heal on reopen).
 * Pure string transform, idempotent, and a no-op when there is nothing to fix.
 */

/** Names that must come from react-native-safe-area-context, never react-native. */
export const SAFE_AREA_NAMES = new Set([
  "SafeAreaView",
  "SafeAreaProvider",
  "SafeAreaInsetsContext",
  "SafeAreaConsumer",
  "SafeAreaFrameContext",
  "useSafeAreaInsets",
  "useSafeAreaFrame",
  "useSafeArea",
  "initialWindowMetrics",
  "initialWindowSafeAreaInsets",
  "withSafeAreaInsets",
]);

const SAC = "react-native-safe-area-context";

/**
 * Expo packages whose component is a NAMED export only (no default). A default
 * import of these resolves to undefined and crashes on web.
 */
export const DEFAULT_TO_NAMED: Record<string, string> = {
  "expo-linear-gradient": "LinearGradient",
  "expo-blur": "BlurView",
  "expo-image": "Image",
  "expo-status-bar": "StatusBar",
};

/** The imported identifier, ignoring any `as alias`. */
function baseName(spec: string): string {
  return spec.split(/\s+as\s+/)[0].trim();
}

/** Move safe-area APIs out of "react-native" into react-native-safe-area-context. */
function fixSafeArea(source: string): string {
  const rnImport =
    /import\s+(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])react-native\3\s*;?/g;
  const moved: string[] = [];
  const movedBases = new Set<string>();

  let out = source.replace(rnImport, (full, dflt, body, q) => {
    const specs = body
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const keep: string[] = [];
    let touched = false;
    for (const s of specs) {
      if (SAFE_AREA_NAMES.has(baseName(s))) {
        touched = true;
        if (!movedBases.has(baseName(s))) {
          movedBases.add(baseName(s));
          moved.push(s);
        }
      } else keep.push(s);
    }
    if (!touched) return full;
    const defaultPart = dflt ? `${dflt}, ` : "";
    if (keep.length === 0 && !dflt) return " RN_DROP ";
    if (keep.length === 0 && dflt) return `import ${dflt} from ${q}react-native${q};`;
    return `import ${defaultPart}{ ${keep.join(", ")} } from ${q}react-native${q};`;
  });

  if (moved.length === 0) return source;

  out = out.replace(/^[ \t]* RN_DROP [ \t]*\n?/gm, "");

  const sacImport = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*(['"])${SAC}\\2\\s*;?`,
  );
  if (sacImport.test(out)) {
    out = out.replace(sacImport, (full, body, q) => {
      const existing = body
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const have = new Set(existing.map(baseName));
      for (const m of moved) if (!have.has(baseName(m))) existing.push(m);
      return `import { ${existing.join(", ")} } from ${q}${SAC}${q};`;
    });
  } else {
    const newImport = `import { ${moved.join(", ")} } from "${SAC}";`;
    const rnLine = /^(import\b[^\n]*from\s*['"]react-native['"];?[ \t]*)$/m;
    if (rnLine.test(out)) out = out.replace(rnLine, `$1\n${newImport}`);
    else if (/^import\b[^\n]*\n/m.test(out))
      out = out.replace(/^(import\b[^\n]*\n)/m, `$1${newImport}\n`);
    else out = `${newImport}\n${out}`;
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

/** Rewrite default imports of named-only Expo packages to named imports. */
function fixDefaultImports(source: string): string {
  let out = source;
  for (const [pkg, canonical] of Object.entries(DEFAULT_TO_NAMED)) {
    // import <Local> from "<pkg>";  — a pure default import (no braces, no `* as`)
    const re = new RegExp(`import\\s+([\\w$]+)\\s+from\\s+(['"])${pkg}\\2\\s*;?`, "g");
    out = out.replace(re, (full, local, q) => {
      const spec = local === canonical ? canonical : `${canonical} as ${local}`;
      return `import { ${spec} } from ${q}${pkg}${q};`;
    });
  }
  return out;
}

/** Returns the source unchanged when there is nothing to fix. Idempotent. */
export function repairWebCompat(source: string): string {
  return fixDefaultImports(fixSafeArea(source));
}

export interface RepairableFile {
  path: string;
  contents: string;
  purpose?: string;
  deleted?: boolean;
}

/** Repair a batch; returns only the files whose contents actually changed. */
export function repairFiles<T extends RepairableFile>(files: T[]): T[] {
  const changed: T[] = [];
  for (const f of files) {
    if (f.deleted) continue;
    if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;
    const fixed = repairWebCompat(f.contents);
    if (fixed !== f.contents) changed.push({ ...f, contents: fixed });
  }
  return changed;
}
