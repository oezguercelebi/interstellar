/**
 * Paths the agent runner (and tsc repair loop) must never write, regardless of
 * instructions. These are generated-once infra files whose changes would break
 * the sandbox environment.
 */

export const FORBIDDEN_PATHS = new Set([
  "package.json",
  "package-lock.json",
  "app.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "babel.config.js",
  "babel.config.ts",
  "metro.config.js",
  "metro.config.ts",
  "expo.config.js",
  "expo.config.ts",
  // NativeWind snapshot infra — baked once, never repaired.
  "tailwind.config.js",
  "tailwind.config.ts",
  "global.css",
  "nativewind-env.d.ts",
  "postcss.config.js",
]);

/** Returns true if the given file path is forbidden (must not be written). */
export function isForbiddenPath(filePath: string): boolean {
  const normalized = filePath.replace(/^\.\//, "");
  return FORBIDDEN_PATHS.has(normalized);
}
