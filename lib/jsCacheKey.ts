/**
 * Pure helper: cache key for a rewritten JS bundle, incorporating
 * the `previewAt` timestamp (unix ms as a string) so a re-provisioned
 * sandbox busts the old cached bundle and serves the new one.
 *
 * Kept in lib/ so it can be imported by both the Next.js route and
 * the pure node:test suite without pulling in Next.js types.
 */
export function buildJsCacheKey(target: string, previewAt: string | null): string {
  return previewAt ? `${target}?pa=${previewAt}` : target;
}
