/**
 * Mirror test (G1): scripts/agent-runner/run.mjs must be byte-identical to the
 * output produced by the template generator in scripts/lib/agentRunnerTemplate.mjs.
 *
 * Also validates the artifact itself:
 *   - `node --check` must parse it without errors
 *   - `node run.mjs --self-test` must exit 0
 *
 * If the byte-identity test fails, regenerate:
 *   node scripts/lib/agentRunnerTemplate.mjs > scripts/agent-runner/run.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_MJS = path.join(ROOT, "scripts/agent-runner/run.mjs");

// Dynamically import the template generator so we can call generate() in-process.
// The template is plain .mjs — node --test can import it directly.
const templateUrl = new URL(
  "file://" + path.join(ROOT, "scripts/lib/agentRunnerTemplate.mjs"),
);

test("run.mjs is byte-identical to the template generator output", async () => {
  const { generate } = await import(templateUrl.href);
  const generated: string = generate(ROOT);
  const committed = fs.readFileSync(RUN_MJS, "utf8");
  assert.equal(
    generated,
    committed,
    [
      "scripts/agent-runner/run.mjs is out of sync with the template.",
      "Regenerate with:",
      "  node scripts/lib/agentRunnerTemplate.mjs > scripts/agent-runner/run.mjs",
    ].join("\n"),
  );
});

test("run.mjs passes node --check (valid JavaScript syntax)", () => {
  // execFileSync throws if node --check exits non-zero.
  execFileSync(process.execPath, ["--check", RUN_MJS], {
    stdio: "pipe",
    timeout: 10_000,
  });
});

test("run.mjs --self-test exits 0 (pure-logic smoke check)", () => {
  const result = execFileSync(process.execPath, [RUN_MJS, "--self-test"], {
    stdio: "pipe",
    timeout: 15_000,
  });
  // Output should mention "passed"
  assert.match(result.toString(), /Self-test:.*passed/);
});
