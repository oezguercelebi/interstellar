#!/usr/bin/env node
/**
 * scripts/convex-query.mjs — clean JSON CLI wrapper around Convex functions.
 *
 * Replaces `npx convex run` for agent-driven QA: stdout is PURE JSON, exit code
 * 0 on success / 1 on error, and all logs go to stderr.
 *
 * Usage:
 *   node scripts/convex-query.mjs <kind> <module:fn> '<jsonArgs>'
 *     <kind>  = query | mutation | action   (default: query)
 *     args    = a JSON object string         (default: {})
 *
 * Examples:
 *   node scripts/convex-query.mjs query projects:inspect '{"projectId":"jd7..."}'
 *   node scripts/convex-query.mjs mutation projects:reopenPreview '{"versionId":"jh7..."}'
 *   node scripts/convex-query.mjs query projects:list
 *
 * Tip: pipe to jq, e.g.  ... | jq '.active.status'
 */
import { runQuery, runMutation, runAction } from "./lib/convex.mjs";

const log = (...a) => process.stderr.write(`[convex] ${a.join(" ")}\n`);

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help") {
  process.stderr.write(
    "Usage: node scripts/convex-query.mjs <query|mutation|action> <module:fn> '<jsonArgs>'\n",
  );
  process.exit(1);
}

const KINDS = new Set(["query", "mutation", "action"]);
let kind = "query";
let rest = argv;
if (KINDS.has(argv[0])) {
  kind = argv[0];
  rest = argv.slice(1);
}
const name = rest[0];
const argsStr = rest[1] ?? "{}";

if (!name) {
  log("missing module:fn");
  process.exit(1);
}

let args;
try {
  args = JSON.parse(argsStr);
} catch (e) {
  log(`bad JSON args: ${e.message}`);
  process.exit(1);
}

const runners = { query: runQuery, mutation: runMutation, action: runAction };

/** Write to stdout and resolve only once the buffer has fully drained — exiting
 *  synchronously after a large write truncates the output on a pipe. */
function writeOut(str) {
  return new Promise((resolve) => {
    if (process.stdout.write(str)) resolve();
    else process.stdout.once("drain", resolve);
  });
}

try {
  log(`${kind} ${name} ${argsStr}`);
  const result = await runners[kind](name, args);
  await writeOut(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = 0;
} catch (e) {
  // Emit a structured error to stdout too, so agents can parse either stream.
  const msg = (e && e.message) || String(e);
  await writeOut(JSON.stringify({ error: msg }, null, 2) + "\n");
  log(`error: ${msg}`);
  process.exitCode = 1;
}
