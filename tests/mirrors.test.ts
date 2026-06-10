/**
 * Mirror-contract tests — value-level sync of the deliberate client mirrors.
 *
 * lib/models.ts and lib/themes.ts are hand-maintained client copies of the
 * server-side registry in convex/lib/styles.ts (client components must not
 * import convex source, or Next bundling couples to the convex dir). This file
 * makes that invisible hand-sync contract executable: drift either side and
 * test:pure goes red.
 *
 * All three modules are import-free on purpose — importing them here puts them
 * in the strip-types closure (C3), which tests/boundaries.test.ts enforces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_HAIKU as UI_MODEL_HAIKU,
  MODEL_SONNET as UI_MODEL_SONNET,
  MODEL_OPUS as UI_MODEL_OPUS,
  DEFAULT_MODEL as UI_DEFAULT_MODEL,
  MODEL_OPTIONS,
  supportsEffort as uiSupportsEffort,
} from "../lib/models.ts";
import { THEME_OPTIONS, DEFAULT_THEME as UI_DEFAULT_THEME } from "../lib/themes.ts";
import {
  MODEL_HAIKU,
  MODEL_SONNET,
  MODEL_OPUS,
  MODELS,
  DEFAULT_MODEL,
  supportsEffort,
  THEMES,
  DEFAULT_THEME,
} from "../convex/lib/styles.ts";

test("mirror: the three model id strings are identical on both sides", () => {
  assert.equal(UI_MODEL_HAIKU, MODEL_HAIKU);
  assert.equal(UI_MODEL_SONNET, MODEL_SONNET);
  assert.equal(UI_MODEL_OPUS, MODEL_OPUS);
});

test("mirror: DEFAULT_MODEL is identical on both sides", () => {
  assert.equal(UI_DEFAULT_MODEL, DEFAULT_MODEL);
});

test("mirror: MODEL_OPTIONS covers exactly the server model registry", () => {
  assert.deepEqual(
    MODEL_OPTIONS.map((o) => o.id).sort(),
    [...MODELS].sort(),
    "lib/models.ts MODEL_OPTIONS and convex/lib/styles.ts MODELS drifted",
  );
});

test("mirror: supportsEffort agrees for every model id", () => {
  for (const id of MODELS) {
    assert.equal(
      uiSupportsEffort(id),
      supportsEffort(id),
      `supportsEffort("${id}") disagrees between lib/models.ts and convex/lib/styles.ts`,
    );
  }
});

test("mirror: theme ids are set-equal between THEME_OPTIONS and THEMES", () => {
  const uiIds = THEME_OPTIONS.map((o) => o.id).sort();
  const serverKeys = THEMES.map((t) => t.key).sort();
  assert.deepEqual(uiIds, serverKeys, "lib/themes.ts THEME_OPTIONS and convex/lib/styles.ts THEMES drifted");
  assert.ok(uiIds.includes("auto"), "the auto theme must exist on both sides");
});

test('mirror: DEFAULT_THEME is identical on both sides (and is "auto")', () => {
  assert.equal(UI_DEFAULT_THEME, DEFAULT_THEME);
  assert.equal(UI_DEFAULT_THEME, "auto");
});
