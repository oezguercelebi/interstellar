/**
 * Daytona sandbox lifecycle discipline for QA runs.
 *
 * Why: Daytona enforces a Total-CPU quota across live sandboxes, so concurrent
 * provisions fail with "Total CPU limit exceeded", and idle sandboxes auto-stop
 * (~30min) then get deleted — both have repeatedly broken unattended test loops.
 * These helpers keep tests to ONE sandbox at a time and always tear down.
 *
 * SAFETY: preclean() only deletes sandboxes created from THIS project's snapshot
 * (DAYTONA_SNAPSHOT). Your other Daytona sandboxes are never touched unless you
 * explicitly pass { all: true } (qa-e2e exposes that as --preclean-all).
 *
 * Uses the Daytona REST API directly (GET/DELETE /sandbox): the SDK's list()
 * return shape has been unstable across versions (returns {} when empty), while
 * the REST endpoint is consistent.
 */
import fs from "fs";

function env(key) {
  try {
    const txt = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const fromFile = (txt.match(new RegExp(`^${key}=(.*)$`, "m")) || [])[1]?.trim();
    if (fromFile) return fromFile;
  } catch {
    // no .env.local — fall through to the real environment
  }
  return process.env[key];
}

const API = () => env("DAYTONA_API_URL");
const KEY = () => env("DAYTONA_API_KEY");
const SNAPSHOT = () => env("DAYTONA_SNAPSHOT");
const log = (...a) => process.stderr.write(`[sandbox] ${a.join(" ")}\n`);

/** List live sandboxes via REST (handles array or {items:[]} shapes). */
async function list() {
  try {
    const res = await fetch(`${API()}/sandbox`, {
      headers: { Authorization: `Bearer ${KEY()}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      log(`list HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : data.items || data.sandboxes || [];
  } catch (e) {
    log(`list failed: ${String(e).slice(0, 100)}`);
    return [];
  }
}

/** List live sandbox ids. */
export async function listIds() {
  return (await list()).map((s) => s.id).filter(Boolean);
}

async function del(id) {
  try {
    await fetch(`${API()}/sandbox/${id}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${KEY()}` },
      signal: AbortSignal.timeout(20_000),
    });
    return true;
  } catch (e) {
    log(`delete ${id} failed: ${String(e).slice(0, 80)}`);
    return false;
  }
}

/**
 * Delete stale sandboxes to free CPU quota before a QA run.
 * Default scope: only sandboxes created from this project's DAYTONA_SNAPSHOT.
 * Pass { all: true } to wipe everything in the org (dangerous — opt-in only).
 */
export async function preclean(keep = [], { all = false } = {}) {
  const snapshot = SNAPSHOT();
  const sandboxes = await list();
  const targets = all
    ? sandboxes
    : sandboxes.filter((s) => snapshot && s.snapshot === snapshot);
  let deleted = 0;
  for (const s of targets) {
    if (!s.id || keep.includes(s.id)) continue;
    if (await del(s.id)) deleted++;
  }
  const scope = all ? "ALL" : `snapshot=${snapshot ?? "(unset — nothing matched)"}`;
  log(`preclean [${scope}]: ${deleted}/${sandboxes.length} deleted`);
  return { found: sandboxes.length, deleted };
}

/** Delete one sandbox by id (best-effort, for teardown in a finally block). */
export async function teardown(sandboxId) {
  if (!sandboxId) return;
  if (await del(sandboxId)) log(`teardown: deleted ${sandboxId}`);
}

/** How many sandboxes are currently live (for the single-concurrent gate). */
export async function liveCount() {
  return (await listIds()).length;
}
