import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildJsCacheKey } from "../lib/jsCacheKey.ts";

test("no previewAt (null) → returns target unchanged", () => {
  assert.equal(buildJsCacheKey("https://8081-abc.example.com/index.bundle", null), "https://8081-abc.example.com/index.bundle");
});

test("no previewAt (undefined) → returns target unchanged", () => {
  assert.equal(buildJsCacheKey("https://8081-abc.example.com/index.bundle", undefined), "https://8081-abc.example.com/index.bundle");
});

test("empty string previewAt is falsy → returns target unchanged", () => {
  assert.equal(buildJsCacheKey("https://8081-abc.example.com/index.bundle", ""), "https://8081-abc.example.com/index.bundle");
});

test("target has no query string → appends ?pa=<previewAt>", () => {
  assert.equal(
    buildJsCacheKey("https://8081-abc.example.com/index.bundle", "1234567890"),
    "https://8081-abc.example.com/index.bundle?pa=1234567890",
  );
});

test("target already has query string → appends &pa=<previewAt> (no double-?)", () => {
  // Real Metro bundle URL shape: /index.bundle?platform=web&dev=true…
  assert.equal(
    buildJsCacheKey("https://8081-abc.example.com/index.bundle?platform=web", "1234567890"),
    "https://8081-abc.example.com/index.bundle?platform=web&pa=1234567890",
  );
});

test("real Metro bundle URL with multiple params → correct separator", () => {
  const target = "https://8081-abc.example.com/node_modules/expo-router/entry.bundle?platform=web&dev=true&hot=true";
  const key = buildJsCacheKey(target, "9999999999");
  assert.equal(key, `${target}&pa=9999999999`);
  // Must contain exactly one '?' (no double-append)
  assert.equal((key.match(/\?/g) ?? []).length, 1);
});
