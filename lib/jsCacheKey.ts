/**
 * Pure helper: cache key for a rewritten JS bundle, incorporating
 * the `previewAt` timestamp (unix ms as a string) so in-box agent edits
 * bust the old cached bundle and serve the new one.
 *
 * `target` is the upstream URL the proxy fetches — it already includes
 * whatever query string Metro emitted (e.g. `?platform=web`). We append
 * `pa=<previewAt>` with `&` or `?` depending on whether a `?` is already
 * present, so we never produce a double-`?`.
 *
 * Kept in lib/ so it can be imported by both the Next.js route and
 * the pure node:test suite without pulling in Next.js types.
 */
export function buildJsCacheKey(target: string, previewAt: string | null | undefined): string {
  if (!previewAt) return target;
  const sep = target.includes("?") ? "&" : "?";
  return `${target}${sep}pa=${previewAt}`;
}
