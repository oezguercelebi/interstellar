// Unit tests for the pure helpers in convex/lib/typecheckRepair.ts.
// Tests cover tsc output parsing, implicated-file selection, repair-prompt
// construction, and the truncation helper.
// No Convex runtime or live Daytona sandbox needed — all pure functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTscOutput,
  selectImplicatedFiles,
  buildRepairPrompt,
  truncateErrorOutput,
  FORBIDDEN_PATHS,
  MAX_ERROR_LINES,
  MAX_IMPLICATED_FILES,
  type TscError,
} from "../convex/lib/typecheckRepair.ts";

// ── parseTscOutput ────────────────────────────────────────────────────────────

test("parseTscOutput: parses a single diagnostic line", () => {
  const out = `app/index.tsx(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;
  const errors = parseTscOutput(out);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].filePath, "app/index.tsx");
  assert.equal(errors[0].line, 12);
  assert.equal(errors[0].col, 5);
  assert.equal(errors[0].code, "TS2345");
  assert.match(errors[0].message, /Argument of type/);
});

test("parseTscOutput: handles multiple files and lines", () => {
  const out = [
    `app/index.tsx(1,1): error TS2345: foo`,
    `app/index.tsx(2,3): error TS2322: bar`,
    `components/Card.tsx(10,2): error TS2304: baz`,
    `some noise line without parens`,
    ``,
  ].join("\n");
  const errors = parseTscOutput(out);
  assert.equal(errors.length, 3);
  assert.equal(errors[2].filePath, "components/Card.tsx");
});

test("parseTscOutput: returns empty array for clean output", () => {
  assert.deepEqual(parseTscOutput(""), []);
  assert.deepEqual(parseTscOutput("Found 0 errors.\n"), []);
});

test("parseTscOutput: handles leading ./ in paths", () => {
  const out = `./app/index.tsx(5,3): error TS2345: Argument`;
  const errors = parseTscOutput(out);
  // parseTscOutput preserves the raw path; selectImplicatedFiles normalises it
  assert.equal(errors.length, 1);
  assert.equal(errors[0].filePath, "./app/index.tsx");
});

// ── selectImplicatedFiles ─────────────────────────────────────────────────────

test("selectImplicatedFiles: deduplicates paths across errors", () => {
  const errors: TscError[] = [
    { filePath: "app/index.tsx", line: 1, col: 1, code: "TS2345", message: "x" },
    { filePath: "app/index.tsx", line: 5, col: 2, code: "TS2322", message: "y" },
    { filePath: "components/Card.tsx", line: 3, col: 1, code: "TS2304", message: "z" },
  ];
  const paths = selectImplicatedFiles(errors);
  assert.deepEqual(paths, ["app/index.tsx", "components/Card.tsx"]);
});

test("selectImplicatedFiles: normalises leading ./", () => {
  const errors: TscError[] = [
    { filePath: "./app/index.tsx", line: 1, col: 1, code: "TS2345", message: "x" },
  ];
  const paths = selectImplicatedFiles(errors);
  assert.deepEqual(paths, ["app/index.tsx"]);
});

test("selectImplicatedFiles: excludes forbidden paths", () => {
  const errors: TscError[] = [
    { filePath: "app/index.tsx", line: 1, col: 1, code: "TS2345", message: "x" },
    { filePath: "package.json", line: 2, col: 1, code: "TS2345", message: "y" },
    { filePath: "tsconfig.json", line: 3, col: 1, code: "TS2345", message: "z" },
    { filePath: "babel.config.js", line: 4, col: 1, code: "TS2345", message: "w" },
  ];
  const paths = selectImplicatedFiles(errors);
  assert.deepEqual(paths, ["app/index.tsx"]);
});

test(`selectImplicatedFiles: caps at MAX_IMPLICATED_FILES (${MAX_IMPLICATED_FILES})`, () => {
  const errors: TscError[] = Array.from({ length: MAX_IMPLICATED_FILES + 5 }, (_, i) => ({
    filePath: `app/file${i}.tsx`,
    line: 1,
    col: 1,
    code: "TS2345",
    message: "x",
  }));
  const paths = selectImplicatedFiles(errors);
  assert.equal(paths.length, MAX_IMPLICATED_FILES);
});

// ── buildRepairPrompt ─────────────────────────────────────────────────────────

test("buildRepairPrompt: includes error block and file contents", () => {
  const errorBlock = "app/index.tsx(1,1): error TS2345: foo";
  const files = [
    { path: "app/index.tsx", contents: "const x: number = 'hello';\n" },
  ];
  const prompt = buildRepairPrompt(errorBlock, files);
  assert.match(prompt, /TS2345/);
  assert.match(prompt, /app\/index\.tsx/);
  assert.match(prompt, /const x: number/);
  // Should mention the forbidden files
  assert.match(prompt, /package\.json/);
  assert.match(prompt, /tsconfig\.json/);
});

test("buildRepairPrompt: includes all files in the file block", () => {
  const files = [
    { path: "app/a.tsx", contents: "// file a\n" },
    { path: "components/b.tsx", contents: "// file b\n" },
  ];
  const prompt = buildRepairPrompt("errors", files);
  assert.match(prompt, /=== app\/a\.tsx ===/);
  assert.match(prompt, /=== components\/b\.tsx ===/);
  assert.match(prompt, /\/\/ file a/);
  assert.match(prompt, /\/\/ file b/);
});

// ── truncateErrorOutput ───────────────────────────────────────────────────────

test(`truncateErrorOutput: passes through output with ≤${MAX_ERROR_LINES} lines`, () => {
  const lines = Array.from({ length: MAX_ERROR_LINES }, (_, i) => `line ${i}`);
  const input = lines.join("\n");
  const result = truncateErrorOutput(input);
  assert.equal(result, input);
});

test("truncateErrorOutput: truncates and appends a note when over the limit", () => {
  const lines = Array.from({ length: MAX_ERROR_LINES + 10 }, (_, i) => `line ${i}`);
  const result = truncateErrorOutput(lines.join("\n"));
  const resultLines = result.split("\n");
  // Should have MAX_ERROR_LINES content lines + 1 truncation note
  assert.equal(resultLines.length, MAX_ERROR_LINES + 1);
  assert.match(resultLines[MAX_ERROR_LINES], /10 more errors truncated/);
});

test("truncateErrorOutput: respects custom maxLines", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const result = truncateErrorOutput(lines.join("\n"), 5);
  const resultLines = result.split("\n");
  assert.equal(resultLines.length, 6); // 5 content + 1 note
  assert.match(resultLines[5], /15 more errors truncated/);
});

test("truncateErrorOutput: ignores blank lines in count", () => {
  // Lines with only whitespace are filtered out
  const input = "line 1\n\n\nline 2\n";
  const result = truncateErrorOutput(input, 10);
  assert.equal(result, "line 1\nline 2");
});

// ── FORBIDDEN_PATHS coverage ──────────────────────────────────────────────────

test("FORBIDDEN_PATHS contains all expected infra files", () => {
  for (const p of [
    "package.json",
    "app.json",
    "tsconfig.json",
    "babel.config.js",
    "metro.config.js",
  ]) {
    assert.ok(FORBIDDEN_PATHS.has(p), `expected FORBIDDEN_PATHS to include ${p}`);
  }
});
