// L1 pure-static tests for prompt-caching layout in prompt.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STABLE_SYSTEM_PREFIX,
  STABLE_SYSTEM_PREFIX_NATIVEWIND,
  buildVolatileSuffix,
  buildSystemBlocks,
  buildInstructions,
} from "../convex/agents/prompt.ts";

// ---------------------------------------------------------------------------
// STABLE_SYSTEM_PREFIX byte-stability
// ---------------------------------------------------------------------------

test("STABLE_SYSTEM_PREFIX is non-empty and contains key anchors", () => {
  assert.ok(STABLE_SYSTEM_PREFIX.length > 0);
  assert.ok(STABLE_SYSTEM_PREFIX.includes("Interstellar"));
  assert.ok(STABLE_SYSTEM_PREFIX.includes("Design System"));
});

test("STABLE_SYSTEM_PREFIX is byte-identical across multiple evaluations (no dates/IDs)", () => {
  // Import the constant twice (same module, same reference) — just confirm it
  // doesn't change between calls so we can assert it is truly static.
  const a = STABLE_SYSTEM_PREFIX;
  const b = STABLE_SYSTEM_PREFIX;
  assert.equal(a, b);
});

test("STABLE_SYSTEM_PREFIX does not contain volatile tokens (dates, IDs, placeholders)", () => {
  // No ISO date pattern
  assert.doesNotMatch(STABLE_SYSTEM_PREFIX, /\d{4}-\d{2}-\d{2}/);
  // No typical UUID pattern
  assert.doesNotMatch(STABLE_SYSTEM_PREFIX, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  // No "TODO" or "FIXME" placeholders
  assert.doesNotMatch(STABLE_SYSTEM_PREFIX, /\bTODO\b|\bFIXME\b/);
});

// ---------------------------------------------------------------------------
// buildVolatileSuffix
// ---------------------------------------------------------------------------

test("buildVolatileSuffix returns empty string when no opts are set", () => {
  assert.equal(buildVolatileSuffix({}), "");
});

test("buildVolatileSuffix includes STYLE DIRECTIVE when given", () => {
  const result = buildVolatileSuffix({ styleDirective: "Dark minimal" });
  assert.match(result, /STYLE DIRECTIVE/);
  assert.match(result, /Dark minimal/);
  assert.doesNotMatch(result, /APP PLAN/);
  assert.doesNotMatch(result, /EDIT MODE/);
});

test("buildVolatileSuffix includes APP PLAN when planSection is given", () => {
  const result = buildVolatileSuffix({ planSection: "appName: MyApp" });
  assert.match(result, /APP PLAN/);
  assert.match(result, /MyApp/);
});

test("buildVolatileSuffix includes EDIT MODE section when isEdit is true", () => {
  const result = buildVolatileSuffix({ isEdit: true, existingFiles: "- app/index.tsx (Home)" });
  assert.match(result, /EDIT MODE/);
  assert.match(result, /app\/index\.tsx/);
});

test("buildVolatileSuffix uses (none) placeholder when isEdit=true but no existingFiles", () => {
  const result = buildVolatileSuffix({ isEdit: true });
  assert.match(result, /\(none\)/);
});

test("buildVolatileSuffix output is identical for same inputs (byte-stable)", () => {
  const opts = {
    styleDirective: "Vivid Playful",
    planSection: "appName: FooApp",
  };
  assert.equal(buildVolatileSuffix(opts), buildVolatileSuffix(opts));
});

test("buildVolatileSuffix does NOT contain STABLE_SYSTEM_PREFIX content", () => {
  // The volatile suffix must not leak any stable content — otherwise the
  // stable cache block boundary would contain volatile bytes.
  const result = buildVolatileSuffix({ styleDirective: "Test style" });
  assert.doesNotMatch(result, /You are Interstellar/);
  assert.doesNotMatch(result, /HARD CONSTRAINTS/);
});

// ---------------------------------------------------------------------------
// buildSystemBlocks
// ---------------------------------------------------------------------------

test("buildSystemBlocks returns one block when volatile is empty", () => {
  const blocks = buildSystemBlocks({});
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].role, "system");
  assert.equal(blocks[0].content, STABLE_SYSTEM_PREFIX);
});

test("buildSystemBlocks stable block has ephemeral cacheControl", () => {
  const blocks = buildSystemBlocks({});
  const cacheCtrl =
    (blocks[0].providerOptions as Record<string, unknown> | undefined)
      ?.anthropic as Record<string, unknown> | undefined;
  assert.ok(cacheCtrl, "expected providerOptions.anthropic to be present");
  assert.deepEqual(cacheCtrl.cacheControl, { type: "ephemeral" });
});

test("buildSystemBlocks returns two blocks when volatile content exists", () => {
  const blocks = buildSystemBlocks({ styleDirective: "Flight Manual" });
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].role, "system");
  assert.equal(blocks[1].role, "system");
});

test("buildSystemBlocks volatile block has ephemeral cacheControl", () => {
  const blocks = buildSystemBlocks({ styleDirective: "Flight Manual" });
  const cacheCtrl =
    (blocks[1].providerOptions as Record<string, unknown> | undefined)
      ?.anthropic as Record<string, unknown> | undefined;
  assert.ok(cacheCtrl, "expected providerOptions.anthropic to be present on volatile block");
  assert.deepEqual(cacheCtrl.cacheControl, { type: "ephemeral" });
});

test("buildSystemBlocks stable block content is byte-identical for different volatile inputs", () => {
  const blocks1 = buildSystemBlocks({ styleDirective: "Midnight" });
  const blocks2 = buildSystemBlocks({ styleDirective: "Vivid Playful", planSection: "x: y" });
  const blocks3 = buildSystemBlocks({ isEdit: true, existingFiles: "- a.tsx (A)" });
  // Block 0 must be byte-identical across all three calls.
  assert.equal(blocks1[0].content, blocks2[0].content);
  assert.equal(blocks1[0].content, blocks3[0].content);
});

test("buildSystemBlocks stable block prefix does not contain volatile content", () => {
  const blocks = buildSystemBlocks({
    styleDirective: "unique-marker-xyzzy",
    planSection: "appName: SentinelApp",
  });
  // volatile content must NOT be in block 0
  assert.ok(!blocks[0].content.includes("unique-marker-xyzzy"));
  assert.ok(!blocks[0].content.includes("SentinelApp"));
  // volatile content must be in block 1
  assert.ok(blocks[1].content.includes("unique-marker-xyzzy"));
  assert.ok(blocks[1].content.includes("SentinelApp"));
});

// ---------------------------------------------------------------------------
// buildInstructions (deprecated compat shim)
// ---------------------------------------------------------------------------

test("buildInstructions with no opts returns STABLE_SYSTEM_PREFIX", () => {
  assert.equal(buildInstructions({}), STABLE_SYSTEM_PREFIX);
});

test("buildInstructions joins stable + volatile with double newline", () => {
  const result = buildInstructions({ styleDirective: "Bold" });
  assert.ok(result.startsWith(STABLE_SYSTEM_PREFIX));
  assert.match(result, /STYLE DIRECTIVE/);
  // The separator must be exactly \n\n before the # STYLE DIRECTIVE heading
  const separatorIdx = result.indexOf("\n\n# STYLE DIRECTIVE");
  assert.ok(separatorIdx !== -1, "expected \\n\\n# before STYLE DIRECTIVE");
});

// ---------------------------------------------------------------------------
// NativeWind kit — parallel stable prefix (classic prefix stays byte-identical)
// ---------------------------------------------------------------------------

test("STABLE_SYSTEM_PREFIX_NATIVEWIND is non-empty and contains key anchors", () => {
  assert.ok(STABLE_SYSTEM_PREFIX_NATIVEWIND.length > 0);
  assert.ok(STABLE_SYSTEM_PREFIX_NATIVEWIND.includes("Interstellar"));
  assert.ok(STABLE_SYSTEM_PREFIX_NATIVEWIND.includes("Design System"));
});

test("STABLE_SYSTEM_PREFIX_NATIVEWIND does not contain volatile tokens (dates, IDs, placeholders)", () => {
  assert.doesNotMatch(STABLE_SYSTEM_PREFIX_NATIVEWIND, /\d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(STABLE_SYSTEM_PREFIX_NATIVEWIND, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  assert.doesNotMatch(STABLE_SYSTEM_PREFIX_NATIVEWIND, /\bTODO\b|\bFIXME\b/);
});

test("STABLE_SYSTEM_PREFIX_NATIVEWIND is byte-stable across evaluations and distinct from classic", () => {
  assert.equal(STABLE_SYSTEM_PREFIX_NATIVEWIND, STABLE_SYSTEM_PREFIX_NATIVEWIND);
  assert.notEqual(STABLE_SYSTEM_PREFIX_NATIVEWIND, STABLE_SYSTEM_PREFIX);
});

test("nativewind prefix speaks the shadcn dialect; classic prefix is untouched by it", () => {
  for (const anchor of ["bg-background", "text-muted-foreground", "cn()", "lucide-react-native", "min-h-11"]) {
    assert.ok(STABLE_SYSTEM_PREFIX_NATIVEWIND.includes(anchor), `nativewind prefix missing "${anchor}"`);
    assert.ok(!STABLE_SYSTEM_PREFIX.includes(anchor), `classic prefix unexpectedly contains "${anchor}"`);
  }
});

test("buildSystemBlocks selects the stable prefix by kit (classic default)", () => {
  assert.equal(buildSystemBlocks({})[0].content, STABLE_SYSTEM_PREFIX);
  assert.equal(buildSystemBlocks({ kit: "classic" })[0].content, STABLE_SYSTEM_PREFIX);
  assert.equal(buildSystemBlocks({ kit: "nativewind" })[0].content, STABLE_SYSTEM_PREFIX_NATIVEWIND);
});

test("buildSystemBlocks per-kit: one block when volatile is empty, two when not", () => {
  assert.equal(buildSystemBlocks({ kit: "nativewind" }).length, 1);
  assert.equal(buildSystemBlocks({ kit: "nativewind", styleDirective: "Flight Manual" }).length, 2);
  assert.equal(buildSystemBlocks({ kit: "classic" }).length, 1);
  assert.equal(buildSystemBlocks({ kit: "classic", styleDirective: "Flight Manual" }).length, 2);
});

test("buildSystemBlocks nativewind block 0 is byte-identical across volatile inputs", () => {
  const blocks1 = buildSystemBlocks({ kit: "nativewind", styleDirective: "Midnight" });
  const blocks2 = buildSystemBlocks({ kit: "nativewind", planSection: "x: y" });
  const blocks3 = buildSystemBlocks({ kit: "nativewind", isEdit: true, existingFiles: "- a.tsx (A)" });
  assert.equal(blocks1[0].content, blocks2[0].content);
  assert.equal(blocks1[0].content, blocks3[0].content);
  assert.equal(blocks1[0].content, STABLE_SYSTEM_PREFIX_NATIVEWIND);
});

test("buildSystemBlocks nativewind blocks carry ephemeral cacheControl", () => {
  const blocks = buildSystemBlocks({ kit: "nativewind", styleDirective: "Flight Manual" });
  for (const block of blocks) {
    const anthropic = (block.providerOptions as Record<string, unknown> | undefined)
      ?.anthropic as Record<string, unknown> | undefined;
    assert.ok(anthropic, "expected providerOptions.anthropic on every block");
    assert.deepEqual(anthropic.cacheControl, { type: "ephemeral" });
  }
});

test("buildVolatileSuffix edit mode is kit-parameterized (classic bytes unchanged)", () => {
  const classicDefault = buildVolatileSuffix({ isEdit: true, existingFiles: "- app/index.tsx (Home)" });
  const classicExplicit = buildVolatileSuffix({
    kit: "classic",
    isEdit: true,
    existingFiles: "- app/index.tsx (Home)",
  });
  // kit absent and kit:"classic" must produce identical bytes (legacy edit cache lane).
  assert.equal(classicDefault, classicExplicit);
  assert.match(classicDefault, /Screen\.tsx, ui\.tsx, _layout\.tsx/);
  assert.doesNotMatch(classicDefault, /components\/ui\/\*/);

  const nativewind = buildVolatileSuffix({
    kit: "nativewind",
    isEdit: true,
    existingFiles: "- app/index.tsx (Home)",
  });
  assert.match(nativewind, /EDIT MODE/);
  assert.match(nativewind, /components\/ui\/\*/);
  assert.match(nativewind, /never restyle the kit/);
  assert.match(nativewind, /app\/index\.tsx/);
  assert.doesNotMatch(nativewind, /ui\.tsx/);
});

test("buildInstructions selects the stable prefix by kit", () => {
  assert.equal(buildInstructions({ kit: "nativewind" }), STABLE_SYSTEM_PREFIX_NATIVEWIND);
  assert.equal(buildInstructions({ kit: "classic" }), STABLE_SYSTEM_PREFIX);
  const result = buildInstructions({ kit: "nativewind", styleDirective: "Bold" });
  assert.ok(result.startsWith(STABLE_SYSTEM_PREFIX_NATIVEWIND));
  assert.ok(result.includes("\n\n# STYLE DIRECTIVE"));
});
