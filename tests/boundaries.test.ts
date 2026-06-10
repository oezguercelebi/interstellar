/**
 * Boundary guardrails — the executable spec of the module seams.
 *
 * Pure node:test + node:fs scan of convex/, app/, components/, lib/ (skipping
 * _generated). Imports NO project code; everything here is fs + regex, so it
 * runs in ~0.3s under `npm run test:pure`.
 *
 * The freeze lists below are the law: changing a module surface is allowed,
 * but the surface change and the freeze-table update must land in the SAME
 * commit — the table diff is the review artifact.
 *
 * What this encodes (see .tm/research/modularization-plan.md):
 *  - C1 zero-regeneration: convex/_generated is committed + load-bearing and
 *    `npx convex codegen` is broken locally. Entry files keep exact paths;
 *    registered functions exist only in entry files; the api.d.ts typeof-pins
 *    must keep resolving.
 *  - C5 string-ref surface: scripts/*.mjs call convex functions by untyped
 *    strings ("projects:inspect", "testHelpers:seedFixture", anyApi.…) and the
 *    workflow journal pins internal.codegenWorkflow.generateApp — none of it
 *    visible to tsc. The registered-export snapshot turns renames into a fast
 *    red test instead of a runtime "function not found".
 *  - C6 node isolation: "use node" only in convex/preview.ts; @daytonaio/sdk
 *    reachable only via preview.ts → lib/sandbox/**.
 *  - C3 strip-types closure: files the pure tests import must stay free of
 *    _generated / convex npm imports and use .ts-extensioned relative imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively list .ts/.tsx files (repo-relative, posix, sorted), skipping _generated. */
function walk(relDir: string): string[] {
  const out: string[] = [];
  const stack = [relDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "_generated" || entry.name === "node_modules") continue;
        stack.push(rel);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(rel);
      }
    }
  }
  return out.sort();
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Import/export-from statements in a file. Line-anchored + lazily bounded so
 * it stays conservative; specifiers that don't resolve to a real file are
 * dropped by callers (starterKit.ts/minimalExpoApp.ts embed Expo app source in
 * template literals whose `import … from "../theme/tokens"` lines would
 * otherwise count as edges).
 */
function importStatements(content: string): { typeOnly: boolean; spec: string }[] {
  const re = /(?:^|\r?\n)[ \t]*(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g;
  const out: { typeOnly: boolean; spec: string }[] = [];
  for (const m of content.matchAll(re)) {
    out.push({ typeOnly: Boolean(m[1]), spec: m[2] ?? "" });
  }
  return out;
}

/** Resolve a relative specifier to an existing repo-relative .ts/.tsx file, or undefined. */
function resolveRelative(fromRel: string, spec: string): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  for (const cand of candidates) {
    if (!/\.tsx?$/.test(cand)) continue;
    if (fs.existsSync(path.join(ROOT, cand))) return cand;
  }
  return undefined;
}

const convexFiles = walk("convex");
const appFiles = walk("app");
const componentFiles = walk("components");
const libFiles = walk("lib");

/** The 10 convex entry files (C1/C2 frozen paths — never move or rename). */
const ENTRY_FILES = [
  "convex/codegen.ts",
  "convex/codegenWorkflow.ts",
  "convex/convex.config.ts",
  "convex/files.ts",
  "convex/preview.ts",
  "convex/projects.ts",
  "convex/schema.ts",
  "convex/studio.ts",
  "convex/testHelpers.ts",
  "convex/versions.ts",
];

// ---------------------------------------------------------------------------
// Scanner self-checks — a silently broken fs-walk must fail loudly, not let
// every other assertion pass vacuously. Update these counts when files are
// deliberately added/removed (same commit as the change).
// ---------------------------------------------------------------------------
test("scanner self-check: minimum file counts per scanned directory", () => {
  assert.ok(convexFiles.length >= 22, `convex/ scan found ${convexFiles.length} files, expected >= 22`);
  assert.ok(appFiles.length >= 5, `app/ scan found ${appFiles.length} files, expected >= 5`);
  assert.ok(componentFiles.length >= 22, `components/ scan found ${componentFiles.length} files, expected >= 22`);
  assert.ok(libFiles.length >= 5, `lib/ scan found ${libFiles.length} files, expected >= 5`);
});

// ---------------------------------------------------------------------------
// C1 — entry files keep exact paths.
// ---------------------------------------------------------------------------
test("C1: all 10 convex entry files exist at their frozen paths", () => {
  for (const f of ENTRY_FILES) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `entry file ${f} is missing — entry paths are frozen (C1)`);
  }
});

// ---------------------------------------------------------------------------
// C1 ratchet — registered-function builders are importable only in entry
// files. (Subset, not equality: an entry may legitimately stop importing.)
// ---------------------------------------------------------------------------
test("C1: only entry files import _generated/server", () => {
  const importers = convexFiles.filter((f) => /from\s*["'][^"']*_generated\/server["']/.test(read(f)));
  for (const f of importers) {
    assert.ok(
      ENTRY_FILES.includes(f),
      `${f} imports _generated/server but is not a convex entry file — registered functions must stay in entry files (C1)`,
    );
  }
  assert.ok(importers.length >= 1, "no _generated/server importers found — scan is broken");
});

test("C1: _generated/api importers inside convex/ are entries + agents/codegen.ts only", () => {
  // convex/agents/codegen.ts is the one verified non-entry exception: its
  // applyFiles tool calls internal.versions.patch.
  const allowed = [...ENTRY_FILES, "convex/agents/codegen.ts"];
  const importers = convexFiles.filter((f) => /from\s*["'][^"']*_generated\/api["']/.test(read(f)));
  for (const f of importers) {
    assert.ok(allowed.includes(f), `${f} imports _generated/api — allowed only in entry files + convex/agents/codegen.ts`);
  }
  assert.ok(importers.length >= 1, "no _generated/api importers found — scan is broken");
});

// ---------------------------------------------------------------------------
// Frozen registered-export snapshot (C1 + C5).
//
// scripts/*.mjs invoke these by string ("projects:inspect",
// "testHelpers:seedFixture", anyApi.projects.get, anyApi.files.listByVersion)
// and the durable workflow journal pins internal.codegenWorkflow.generateApp —
// none of which tsc can see. Renaming/deleting/adding a registered function
// MUST be done together with this table, in the same commit.
// ---------------------------------------------------------------------------
const REGISTERED_RE = /^export const (\w+) = (query|mutation|internalQuery|internalMutation|internalAction)\(/gm;

const REGISTERED_SURFACE: Record<string, string[]> = {
  "convex/codegen.ts": ["runVariant"],
  "convex/files.ts": ["listByVersion", "snapshot", "upsert", "remove", "seedStarter", "cloneInto"],
  "convex/preview.ts": ["provisionPreview"],
  "convex/projects.ts": [
    "start",
    "get",
    "inspect",
    "reopenPreview",
    "list",
    "setThumbnail",
    "deleteAll",
    "clearThumbnail",
    "needsThumbnail",
    "edit",
  ],
  "convex/studio.ts": ["listMessages"],
  "convex/testHelpers.ts": ["seedFixture"],
  "convex/versions.ts": ["patch"],
};

test("C1/C5: registered-export surface is frozen per convex file", () => {
  const actual: Record<string, string[]> = {};
  for (const f of convexFiles) {
    const names = [...read(f).matchAll(REGISTERED_RE)].map((m) => m[1] ?? "").sort();
    if (names.length > 0) actual[f] = names;
  }
  const expected: Record<string, string[]> = {};
  for (const [f, names] of Object.entries(REGISTERED_SURFACE)) {
    expected[f] = [...names].sort();
  }
  assert.deepEqual(
    actual,
    expected,
    "registered convex function surface changed — update REGISTERED_SURFACE in the same commit (string refs in scripts/ + the workflow journal depend on these names)",
  );
});

test("C1/C5: codegenWorkflow keeps its durable workflow identity", () => {
  const cw = read("convex/codegenWorkflow.ts");
  assert.match(cw, /^export const workflow = new WorkflowManager\(/m, "workflow manager instance must stay in codegenWorkflow.ts");
  assert.match(
    cw,
    /^export const generateApp = workflow\.define\(/m,
    "internal.codegenWorkflow.generateApp is a durable workflow identity — never rename or move it",
  );
  const managers = convexFiles.filter((f) => read(f).includes("new WorkflowManager("));
  assert.deepEqual(managers, ["convex/codegenWorkflow.ts"], "the WorkflowManager instance must live only in convex/codegenWorkflow.ts");
});

// ---------------------------------------------------------------------------
// api.d.ts pin guard — convex/_generated/api.d.ts typeof-imports a fixed set
// of modules. Since `npx convex codegen` is broken locally, moving/renaming
// any pinned module would break tsc UNFIXABLY. Fail fast here instead.
// ---------------------------------------------------------------------------
test("C1: every module pinned by _generated/api.d.ts typeof-imports exists", () => {
  const apiDts = read("convex/_generated/api.d.ts");
  const specs = [...apiDts.matchAll(/^import type \* as \w+ from "\.\.\/(.+?)\.js";$/gm)].map((m) => m[1] ?? "");
  assert.ok(specs.length >= 15, `expected >= 15 typeof-imports in api.d.ts, found ${specs.length}`);
  for (const spec of specs) {
    assert.ok(
      fs.existsSync(path.join(ROOT, "convex", `${spec}.ts`)),
      `convex/${spec}.ts is pinned by _generated/api.d.ts but missing — codegen is broken, this cannot be regenerated (C1)`,
    );
  }
  // The 7 non-entry helpers that must never move:
  const pinnedHelpers = [
    "agents/codegen",
    "agents/designSystem",
    "agents/prompt",
    "lib/__fixtures__/minimalExpoApp",
    "lib/styles",
    "lib/validate",
    "lib/webcompat",
  ];
  for (const h of pinnedHelpers) {
    assert.ok(specs.includes(h), `api.d.ts no longer pins ${h} — _generated must not have been edited (C1)`);
  }
});

// ---------------------------------------------------------------------------
// C6 — node isolation.
// ---------------------------------------------------------------------------
test('C6: "use node" directive (line 1) appears in exactly convex/preview.ts', () => {
  // Directive position only: the string "use node" also legitimately appears in
  // a comment in lib/sandbox/daytona.ts and in _generated docs.
  const useNodeFiles = convexFiles.filter((f) => {
    const firstLine = read(f).split(/\r?\n/, 1)[0] ?? "";
    return /^["']use node["'];?\s*$/.test(firstLine.trim());
  });
  assert.deepEqual(useNodeFiles, ["convex/preview.ts"]);
});

test("C6: @daytonaio/sdk appears in convex/ only inside lib/sandbox/daytona.ts", () => {
  const hits = convexFiles.filter((f) => read(f).includes("@daytonaio/sdk"));
  assert.deepEqual(hits, ["convex/lib/sandbox/daytona.ts"]);
});

test("C6: daytona.ts is reachable only from the preview.ts entry (import-graph BFS)", () => {
  // Static import graph over convex/**/*.ts (minus _generated). Edges only for
  // relative specifiers that resolve to a real file, so the Expo source embedded
  // in template literals (starterKit, fixtures) cannot create phantom edges.
  const edges = new Map<string, string[]>();
  for (const f of convexFiles) {
    const targets: string[] = [];
    for (const stmt of importStatements(read(f))) {
      if (!stmt.spec.startsWith(".")) continue;
      const resolved = resolveRelative(f, stmt.spec);
      if (resolved && resolved.startsWith("convex/")) targets.push(resolved);
    }
    edges.set(f, targets);
  }
  const reaches = (start: string, goal: string): boolean => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === goal) return true;
      for (const next of edges.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  const goal = "convex/lib/sandbox/daytona.ts";
  const reachers = ENTRY_FILES.filter((e) => reaches(e, goal));
  assert.deepEqual(
    reachers,
    ["convex/preview.ts"],
    "the Daytona SDK module must be reachable only via the use-node entry convex/preview.ts (C6)",
  );
});

// ---------------------------------------------------------------------------
// C3 — strip-types closure purity. Everything tests/*.test.ts value-imports
// must run under `node --test --experimental-strip-types`: no _generated, no
// convex npm modules, and .ts-extensioned relative value-imports.
// ---------------------------------------------------------------------------
test("C3: the pure test closure stays _generated-free and .ts-extensioned", () => {
  const closure = [
    "convex/agents/designSystem.ts",
    "convex/agents/prompt.ts",
    "convex/agents/starterKit.ts",
    "convex/lib/sandbox/typecheckRepair.ts",
    "convex/lib/styles.ts",
    "convex/lib/validate.ts",
    "convex/lib/webcompat.ts",
    "lib/models.ts",
    "lib/themes.ts",
  ];
  for (const f of closure) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `pure-closure file ${f} is missing`);
    for (const stmt of importStatements(read(f))) {
      assert.ok(!stmt.spec.includes("_generated"), `${f} imports ${stmt.spec} — the pure test closure must not touch _generated (C3)`);
      assert.ok(
        !(stmt.spec === "convex" || stmt.spec.startsWith("convex/")),
        `${f} imports ${stmt.spec} — the pure test closure must not import the convex npm package (C3)`,
      );
      if (!stmt.spec.startsWith(".") || stmt.typeOnly) continue;
      // Only enforce on specifiers that resolve to a real file — embedded
      // template-literal app code (e.g. "../theme/tokens") resolves to nothing.
      if (resolveRelative(f, stmt.spec) === undefined) continue;
      assert.ok(
        stmt.spec.endsWith(".ts"),
        `${f} value-imports "${stmt.spec}" without a .ts extension — strip-types needs explicit extensions (C3)`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Frontend rule — app/, components/, lib/ may reach the convex DIRECTORY only
// through convex/_generated/{api,dataModel}. (The bare "convex/react" /
// "convex/values" npm package imports are fine — different thing.)
// ---------------------------------------------------------------------------
test("frontend imports from the convex/ directory go only via _generated", () => {
  for (const f of [...appFiles, ...componentFiles, ...libFiles]) {
    for (const m of read(f).matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
      const spec = m[1] ?? "";
      if (spec.startsWith("@/convex/")) {
        assert.ok(
          spec.startsWith("@/convex/_generated/"),
          `${f} imports ${spec} — the frontend may import convex/ only via convex/_generated (use the generated api/dataModel)`,
        );
      } else if (spec.startsWith(".")) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
        assert.ok(
          !(resolved.startsWith("convex/") && !resolved.includes("_generated")),
          `${f} imports ${spec} (→ ${resolved}) — the frontend may import convex/ only via convex/_generated`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-file literal pins — values that several modules must agree on but no
// shared import can carry (convex runtime + Next route + client + .mjs
// scripts). If one of these greps stops matching, the counterpart files have
// drifted: fix them together.
// ---------------------------------------------------------------------------
test("literal pins: 8081 port / 'daytona' provider / /api/preview/ prefix", () => {
  const daytona = read("convex/lib/sandbox/daytona.ts");
  const route = read("app/api/preview/[id]/[[...path]]/route.ts");
  const previewContract = read("lib/previewContract.ts");
  const waitReady = read("scripts/wait-preview-ready.mjs");
  const qaPreview = read("scripts/qa-preview.mjs");

  // Expo web port triple: sandbox preview, same-origin proxy, client URL parsing.
  assert.ok(daytona.includes("8081"), "daytona.ts lost the 8081 preview port");
  assert.ok(route.includes("8081"), "preview proxy route lost the 8081 upstream port");
  assert.ok(previewContract.includes("8081-([a-f0-9-]{8,40})"), "previewContract lost the 8081 sandbox-id regex");

  // Provider literal: provisioning result, client gating, QA polling.
  assert.ok(daytona.includes('"daytona"'), "daytona.ts lost its provider name literal");
  assert.ok(previewContract.includes('"daytona"'), "previewContract lost the daytona provider check");
  assert.ok(waitReady.includes('"daytona"'), "wait-preview-ready.mjs lost the daytona provider check");

  // Same-origin proxy prefix: client iframe URL + QA harness.
  assert.ok(previewContract.includes("/api/preview/"), "previewContract lost the /api/preview/ proxy prefix");
  assert.ok(qaPreview.includes("/api/preview/"), "qa-preview.mjs lost the /api/preview/ proxy prefix");
});
