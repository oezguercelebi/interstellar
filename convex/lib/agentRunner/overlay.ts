/**
 * Detects Metro bundler error overlays in HTTP response bodies.
 *
 * Metro web (expo start --web, CI=1) serves error pages that still return
 * HTTP 200. We grep the body for known markers to distinguish a working
 * bundle from an error overlay masquerading as a successful response.
 *
 * Tested against: expo-router error boundaries, Metro "Unable to resolve
 * module" pages, React Native Red Box web equivalents.
 */

/**
 * Returns true if the HTML response looks like a Metro bundler error overlay
 * rather than a healthy bundle. Checks only unambiguous error-specific markers
 * that do NOT appear in healthy bundles.
 */
export function looksLikeMetroOverlay(html: string): boolean {
  const markers = [
    // Metro bundler error — appears in "Unable to resolve module" pages
    "Unable to resolve module",
    // Metro compile-time failure
    "Bundling failed",
    // RN app registration failure
    "Application has not been registered",
    // Same failure, alternate phrasing
    "hasn't been registered",
    // React Native LogBox error overlay testid (error state only)
    'data-testid="logbox-overlay"',
    // Metro's own error HTML page title (only rendered on error, not in bundles)
    "<title>Metro Bundler</title>",
  ];
  const lower = html.toLowerCase();
  for (const marker of markers) {
    if (lower.includes(marker.toLowerCase())) return true;
  }
  return false;
}
