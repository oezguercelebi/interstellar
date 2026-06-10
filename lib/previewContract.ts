/**
 * Preview contract — everything the studio client knows about how live
 * previews are served. These values mirror counterparts no shared import can
 * carry (convex runtime + Next route + .mjs scripts):
 *  - app/api/preview/[id]/[[...path]]/route.ts — the same-origin proxy these
 *    URLs point at (and the 8081 upstream port),
 *  - convex/lib/sandbox/daytona.ts — the "daytona" provider literal, the
 *    `8081-<uuid>.` preview hostname shape, and the ~30-min sandbox auto-stop
 *    that the staleness window undercuts,
 *  - scripts/wait-preview-ready.mjs — polls for the same "daytona" provider.
 * tests/boundaries.test.ts pins the literals; change them together.
 *
 * Typed structurally (not via Doc<"versions">) so this file stays free of
 * convex/_generated and importable under `node --test --experimental-strip-types`.
 */

/** The slice of a versions doc that the preview contract reads. */
export type PreviewVersion = {
  sandboxId?: string;
  previewUrl?: string;
  sandboxProvider?: string;
  previewAt?: number;
};

/** The sandbox uuid, from sandboxId or parsed out of the preview URL. */
export function sandboxIdOf(version: PreviewVersion): string | undefined {
  if (version.sandboxId) return version.sandboxId;
  const m = version.previewUrl?.match(/8081-([a-f0-9-]{8,40})\./i);
  return m?.[1];
}

/**
 * The same-origin proxy URL for a live daytona preview. Routing the iframe through
 * /api/preview/<id> strips Daytona's "I Understand" warning (the proxy injects the
 * skip header server-side) and makes the frame same-origin so we can screenshot it.
 */
export function proxyUrlOf(version: PreviewVersion): string | undefined {
  if (version.sandboxProvider !== "daytona") return undefined;
  const id = sandboxIdOf(version);
  return id ? `/api/preview/${id}/` : undefined;
}

// Daytona auto-stops idle sandboxes after ~30 min — past that the stored URL is
// almost certainly dead, so show the asleep state instead of Daytona's warning.
// Builds from before previewAt existed have no timestamp → treat as stale too
// (their sandboxes are long gone), so the user gets the Reopen path, not a 404.
const STALE_MS = 28 * 60 * 1000;

/** True when a stored daytona preview URL is past the 28-minute trust window. */
export function isPreviewStale(version: PreviewVersion, now = Date.now()): boolean {
  return (
    version.sandboxProvider === "daytona" &&
    (!version.previewAt || now - version.previewAt > STALE_MS)
  );
}

/**
 * Max bytes for a stored thumbnail dataURL — Convex caps documents at ~1 MiB,
 * so a base64 dataURL must stay well under it.
 */
export const THUMBNAIL_MAX_BYTES = 950_000;
