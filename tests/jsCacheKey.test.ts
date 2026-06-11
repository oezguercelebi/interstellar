import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildJsCacheKey } from "../lib/jsCacheKey.ts";

test("no previewAt → returns target unchanged", () => {
  assert.equal(buildJsCacheKey("/foo/bar.js", null), "/foo/bar.js");
});

test("with previewAt → appends pa param", () => {
  assert.equal(buildJsCacheKey("/foo/bar.js", "1234567890"), "/foo/bar.js?pa=1234567890");
});

test("empty string previewAt is falsy → returns target unchanged", () => {
  // searchParams.get returns null for missing, but guard against empty string
  assert.equal(buildJsCacheKey("/foo/bar.js", ""), "/foo/bar.js");
});
