/**
 * Unit tests for lib/previewContract.ts — pure functions, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isPreviewStale,
  sandboxIdOf,
  proxyUrlOf,
  THUMBNAIL_MAX_BYTES,
  type PreviewVersion,
} from "../lib/previewContract.ts";

const STALE_MS = 28 * 60 * 1000; // mirrors the module constant

// ── isPreviewStale ────────────────────────────────────────────────────────────

test("isPreviewStale: non-daytona provider → false", () => {
  const v: PreviewVersion = { sandboxProvider: "e2b", previewAt: Date.now() - STALE_MS * 2 };
  assert.ok(!isPreviewStale(v));
});

test("isPreviewStale: daytona with no previewAt → true (pre-timestamp era)", () => {
  const v: PreviewVersion = { sandboxProvider: "daytona" };
  assert.ok(isPreviewStale(v));
});

test("isPreviewStale: daytona with previewAt=0 → true", () => {
  const v: PreviewVersion = { sandboxProvider: "daytona", previewAt: 0 };
  assert.ok(isPreviewStale(v, Date.now()));
});

test("isPreviewStale: daytona with previewAt 0ms ago → false", () => {
  const now = Date.now();
  const v: PreviewVersion = { sandboxProvider: "daytona", previewAt: now };
  assert.ok(!isPreviewStale(v, now));
});

test("isPreviewStale: daytona at STALE_MS-1ms → false", () => {
  const now = 1_000_000_000;
  const v: PreviewVersion = { sandboxProvider: "daytona", previewAt: now - (STALE_MS - 1) };
  assert.ok(!isPreviewStale(v, now));
});

test("isPreviewStale: daytona at exactly STALE_MS → true", () => {
  const now = 1_000_000_000;
  const v: PreviewVersion = { sandboxProvider: "daytona", previewAt: now - STALE_MS };
  assert.ok(isPreviewStale(v, now));
});

test("isPreviewStale: daytona with provider=none → false", () => {
  const v: PreviewVersion = { sandboxProvider: "none" };
  assert.ok(!isPreviewStale(v));
});

test("isPreviewStale: no sandboxProvider → false", () => {
  const v: PreviewVersion = {};
  assert.ok(!isPreviewStale(v));
});

// ── sandboxIdOf ───────────────────────────────────────────────────────────────

test("sandboxIdOf: version with sandboxId → returns it directly", () => {
  const v: PreviewVersion = { sandboxId: "abc123def456" };
  assert.equal(sandboxIdOf(v), "abc123def456");
});

test("sandboxIdOf: version with previewUrl containing 8081-<uuid> → parses uuid", () => {
  const v: PreviewVersion = {
    previewUrl: "https://8081-abc123def456.preview.example.com/",
  };
  assert.equal(sandboxIdOf(v), "abc123def456");
});

test("sandboxIdOf: version with both sandboxId and previewUrl → prefers sandboxId", () => {
  const v: PreviewVersion = {
    sandboxId: "direct-id",
    previewUrl: "https://8081-url-id.preview.example.com/",
  };
  assert.equal(sandboxIdOf(v), "direct-id");
});

test("sandboxIdOf: version with neither → undefined", () => {
  const v: PreviewVersion = {};
  assert.equal(sandboxIdOf(v), undefined);
});

test("sandboxIdOf: previewUrl without 8081- prefix → undefined", () => {
  const v: PreviewVersion = {
    previewUrl: "https://abc123def456.preview.example.com/",
  };
  assert.equal(sandboxIdOf(v), undefined);
});

test("sandboxIdOf: previewUrl with a full uuid-like id", () => {
  const v: PreviewVersion = {
    previewUrl: "https://8081-a1b2c3d4e5f6a1b2.preview.daytona.io/",
  };
  assert.equal(sandboxIdOf(v), "a1b2c3d4e5f6a1b2");
});

// ── proxyUrlOf ────────────────────────────────────────────────────────────────

test("proxyUrlOf: daytona + valid sandboxId → /api/preview/<id>/", () => {
  const v: PreviewVersion = { sandboxProvider: "daytona", sandboxId: "myid123" };
  assert.equal(proxyUrlOf(v), "/api/preview/myid123/");
});

test("proxyUrlOf: daytona + previewUrl-derived id → /api/preview/<id>/", () => {
  const v: PreviewVersion = {
    sandboxProvider: "daytona",
    previewUrl: "https://8081-abc123def456.preview.example.com/",
  };
  assert.equal(proxyUrlOf(v), "/api/preview/abc123def456/");
});

test("proxyUrlOf: e2b provider → undefined", () => {
  const v: PreviewVersion = { sandboxProvider: "e2b", sandboxId: "myid" };
  assert.equal(proxyUrlOf(v), undefined);
});

test("proxyUrlOf: daytona + no parseable id → undefined", () => {
  const v: PreviewVersion = { sandboxProvider: "daytona" };
  assert.equal(proxyUrlOf(v), undefined);
});

test("proxyUrlOf: sandboxProvider=none → undefined", () => {
  const v: PreviewVersion = { sandboxProvider: "none", sandboxId: "myid" };
  assert.equal(proxyUrlOf(v), undefined);
});

test("proxyUrlOf: no provider → undefined", () => {
  const v: PreviewVersion = {};
  assert.equal(proxyUrlOf(v), undefined);
});

// ── THUMBNAIL_MAX_BYTES ───────────────────────────────────────────────────────

test("THUMBNAIL_MAX_BYTES is well under 1 MiB Convex limit", () => {
  assert.ok(THUMBNAIL_MAX_BYTES < 1_000_000);
  assert.ok(THUMBNAIL_MAX_BYTES > 0);
});
