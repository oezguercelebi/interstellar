/**
 * Shared Convex CLI client for the QA harness.
 *
 * `npx convex run` mixes deploy logs + ESM warnings into stdout, which makes it
 * painful for an agent to parse. This wraps ConvexHttpClient so every call
 * returns a clean JS value (and the CLI wrapper prints pure JSON to stdout).
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import fs from "fs";

/** Read NEXT_PUBLIC_CONVEX_URL from .env.local or the environment (no dotenv dep needed). */
export function convexUrl() {
  try {
    const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const m = env.match(/NEXT_PUBLIC_CONVEX_URL=(\S+)/) || env.match(/CONVEX_URL=(\S+)/);
    if (m) return m[1].trim();
  } catch {
    // no .env.local — fall through to the real environment
  }
  const fromEnv = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
  if (fromEnv) return fromEnv;
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL not set — create .env.local from .env.example (run `npx convex dev --once --configure`).",
  );
}

let _client;
export function client() {
  if (!_client) _client = new ConvexHttpClient(convexUrl());
  return _client;
}

/** Resolve a "module:fn" string to the anyApi reference (e.g. "projects:inspect"). */
export function fnRef(name) {
  const [mod, fn] = name.split(":");
  if (!mod || !fn) throw new Error(`Expected "module:fn", got "${name}"`);
  // Support nested modules like "lib/foo:bar" → anyApi.lib.foo.bar
  const ref = mod.split("/").reduce((acc, seg) => acc[seg], anyApi);
  return ref[fn];
}

export const runQuery = (name, args = {}) => client().query(fnRef(name), args);
export const runMutation = (name, args = {}) => client().mutation(fnRef(name), args);
export const runAction = (name, args = {}) => client().action(fnRef(name), args);
