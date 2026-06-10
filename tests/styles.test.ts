// L1 pure-static tests for model/theme/variant logic. Real source import.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isModelId,
  supportsEffort,
  effortProviderOptions,
  MODEL_OPUS,
  MODEL_SONNET,
  MODEL_HAIKU,
  isThemeKey,
  themeDirective,
  themeName,
  DEFAULT_THEME,
  pickVariants,
  deriveTitle,
} from "../convex/lib/styles.ts";

test("isModelId accepts the three real model ids, rejects junk", () => {
  assert.ok(isModelId(MODEL_OPUS));
  assert.ok(isModelId(MODEL_SONNET));
  assert.ok(isModelId(MODEL_HAIKU));
  assert.equal(isModelId("gpt-4"), false);
  assert.equal(isModelId(""), false);
});

test("effort applies only to Opus", () => {
  assert.equal(supportsEffort(MODEL_OPUS), true);
  assert.equal(supportsEffort(MODEL_SONNET), false);
  assert.equal(supportsEffort(MODEL_HAIKU), false);
});

test("effortProviderOptions returns anthropic effort only for Opus+effort", () => {
  assert.deepEqual(effortProviderOptions(MODEL_OPUS, "high"), { anthropic: { effort: "high" } });
  assert.equal(effortProviderOptions(MODEL_OPUS, undefined), undefined);
  assert.equal(effortProviderOptions(MODEL_SONNET, "high"), undefined);
  assert.equal(effortProviderOptions(MODEL_HAIKU, "low"), undefined);
});

test("isThemeKey knows the presets + auto, rejects junk", () => {
  for (const k of ["auto", "signature", "editorial", "midnight", "playful", "mono"]) {
    assert.ok(isThemeKey(k), `expected ${k} to be a theme`);
  }
  assert.equal(isThemeKey("neon"), false);
});

test("DEFAULT_THEME is auto and names resolve", () => {
  assert.equal(DEFAULT_THEME, "auto");
  assert.equal(themeName("auto"), "Auto");
  assert.equal(themeName("midnight"), "Midnight");
  assert.equal(themeName(undefined), "Auto"); // falls back to default
  assert.equal(themeName("bogus"), "Auto"); // unknown → default theme name
});

test("themeDirective: single variant returns the base directive", () => {
  const d = themeDirective("midnight", { index: 0, count: 1 });
  assert.match(d, /Midnight/i);
  assert.doesNotMatch(d, /variant 1 of/i);
});

test("themeDirective: auto fans 3 variants across distinct lanes", () => {
  const d0 = themeDirective("auto", { index: 0, count: 3 });
  const d1 = themeDirective("auto", { index: 1, count: 3 });
  const d2 = themeDirective("auto", { index: 2, count: 3 });
  assert.match(d0, /Lane 1/);
  assert.match(d1, /Lane 2/);
  assert.match(d2, /Lane 3/);
  assert.notEqual(d0, d1);
});

test("themeDirective: preset multi-variant keeps identity but asks for distinct take", () => {
  const d = themeDirective("midnight", { index: 1, count: 3 });
  assert.match(d, /Midnight/i);
  assert.match(d, /variant 2 of 3/i);
});

test("themeDirective: unknown key falls back to first theme (auto)", () => {
  const d = themeDirective("bogus", { index: 0, count: 1 });
  assert.match(d, /Auto/i);
});

test("pickVariants returns 1 for <3 and 3 for >=3", () => {
  assert.equal(pickVariants(1).length, 1);
  assert.equal(pickVariants(2).length, 1);
  assert.equal(pickVariants(3).length, 3);
  assert.equal(pickVariants(5).length, 3);
});

test("deriveTitle: first clause, capitalized, truncated", () => {
  assert.equal(deriveTitle("create a todo app, with streaks"), "Create a todo app");
  assert.equal(deriveTitle("  spaced   out   prompt  "), "Spaced out prompt");
  const long = deriveTitle("a".repeat(80));
  assert.ok(long.length <= 48);
  assert.ok(long.endsWith("…"));
});
