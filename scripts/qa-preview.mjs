#!/usr/bin/env node
/**
 * scripts/qa-preview.mjs
 *
 * Headless-browser QA harness for generated Expo-web apps served through the
 * same-origin proxy at http://localhost:3000/api/preview/<sandboxId>/
 *
 * Usage (agent-invocable, stdout = JSON):
 *   node scripts/qa-preview.mjs <sandboxId> [options]
 *
 *   Options:
 *     --wait <ms>          max time to wait for render (default 30000)
 *     --screenshot         capture a PNG and include the path in output
 *     --fill <selector> <text>   fill an input (may be repeated)
 *     --click <selector>         click an element (may be repeated)
 *     --assert-text <text>       fail if text is absent from body (may be repeated)
 *     --base-url <url>     override proxy base (default http://localhost:3000)
 *
 * Output contract (stdout, JSON):
 *   {
 *     rendered: boolean,          // true iff no crash overlay and no fatal console error
 *     consoleErrors: string[],    // browser console errors/warnings collected
 *     rnCrashSignatures: string[], // RN-web crash patterns found in console
 *     textSnapshot: string,       // document.body.innerText (trimmed, first 4000 chars)
 *     assertions: {               // each assertion the caller asked for
 *       name: string,
 *       passed: boolean,
 *       detail: string,
 *     }[],
 *     screenshotPath: string | null,
 *     durationMs: number,
 *     error: string | null,       // harness-level failure (not render failure)
 *   }
 *
 * All non-JSON progress logging goes to stderr so stdout stays machine-readable.
 *
 * Dependencies: playwright (devDependency — install once with
 *   npm install -D playwright && npx playwright install chromium)
 */

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ─── Argument parsing ────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help") {
  process.stderr.write(
    "Usage: node scripts/qa-preview.mjs <sandboxId> [--wait ms] [--screenshot]\n" +
    "       [--fill <selector> <text>] [--click <selector>]\n" +
    "       [--assert-text <text>] [--base-url <url>]\n"
  );
  process.exit(1);
}

const sandboxId = argv[0];
let waitMs = 30_000;
let takeScreenshot = false;
let baseUrl = "http://localhost:3000";
const fills = [];       // [{selector, text}]
const clicks = [];      // [selector]
const assertTexts = []; // [text]

for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--wait") { waitMs = Number(argv[++i]); }
  else if (a === "--screenshot") { takeScreenshot = true; }
  else if (a === "--base-url") { baseUrl = argv[++i]; }
  else if (a === "--fill") { fills.push({ selector: argv[++i], text: argv[++i] }); }
  else if (a === "--click") { clicks.push(argv[++i]); }
  else if (a === "--assert-text") { assertTexts.push(argv[++i]); }
}

const proxyUrl = `${baseUrl}/api/preview/${sandboxId}/`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(__dirname, "..", "tmp", "qa-screenshots");

// ─── RN-web crash detection ──────────────────────────────────────────────────
// These are the known crash signatures for Expo-web / React-Native-Web failures.
// Pattern priority: console messages → DOM error overlay → textContent.

/**
 * Patterns that, when found in a console message, indicate a render crash.
 * Matched case-insensitively against the full message string.
 */
const CRASH_CONSOLE_PATTERNS = [
  /Element type is invalid/i,
  /useSafeAreaInsets is not a function/i,
  /Cannot read prop.*of undefined/i,
  /Cannot read prop.*of null/i,
  /is not a function/i,              // broad catch for any undefined-callable
  /Objects are not valid as a React child/i,
  /Minified React error/i,
  /The above error occurred in/i,    // React error boundary reporting
  /Invariant Violation/i,
  /ReferenceError/i,
  /TypeError/i,
  /SyntaxError/i,
];

/**
 * DOM selectors that React's error overlay inserts into the page.
 * Expo Router (web) inherits the Metro/React error overlay.
 */
const ERROR_OVERLAY_SELECTORS = [
  // Metro/React DevTools error overlay (Development builds)
  "body > div[style*='z-index: 2147483647']", // Metro's full-screen overlay
  "#expo-error-overlay",
  "[data-testid='expo-error-overlay']",
  // React's own error overlay (create-react-app / Metro alike)
  "iframe[src*='errors']",
  // Generic "something went wrong" text patterns checked via innerText
];

/**
 * Text patterns in the document body that signal a crash (unrendered app).
 */
const CRASH_BODY_PATTERNS = [
  /Element type is invalid/i,
  /Unmatched Route/i,                // expo-router 404, not a crash but worth flagging
  /Application error/i,
  /Something went wrong/i,
  /Invariant Violation/i,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const log = (...args) => process.stderr.write(`[qa] ${args.join(" ")}\n`);

/** Emit the result JSON to stdout and exit. */
function emit(result) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

/** Build the base result skeleton. */
function baseResult() {
  return {
    rendered: false,
    consoleErrors: [],
    rnCrashSignatures: [],
    textSnapshot: "",
    assertions: [],
    screenshotPath: null,
    durationMs: 0,
    error: null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const t0 = Date.now();
const result = baseResult();

log(`target: ${proxyUrl}`);
log(`waitMs: ${waitMs}`);

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    // On macOS, Playwright downloads its own Chromium; no system Chrome needed.
    // Pass --no-sandbox only if running inside a container (CI).
    args: process.env.CI
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [],
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 — matches RN-web typical target
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    // Ignore HTTPS errors — preview proxy is HTTP anyway; Daytona upstream is HTTPS.
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // ── Collect console messages ────────────────────────────────────────────────
  const consoleMessages = [];
  page.on("console", (msg) => {
    const level = msg.type(); // "log" | "info" | "warn" | "error"
    const text = msg.text();
    consoleMessages.push({ level, text });
    if (level === "error" || level === "warn") {
      log(`console.${level}: ${text.slice(0, 200)}`);
    }
  });

  // ── Collect page errors (uncaught exceptions) ───────────────────────────────
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    log(`pageerror: ${err.message.slice(0, 200)}`);
  });

  // ── Navigate ────────────────────────────────────────────────────────────────
  log(`navigating…`);
  try {
    await page.goto(proxyUrl, {
      waitUntil: "domcontentloaded",
      timeout: waitMs,
    });
  } catch (navErr) {
    // If navigation itself times out, we still want to inspect whatever loaded.
    log(`navigation warning: ${navErr.message.slice(0, 200)}`);
  }

  // ── Wait for RN-web hydration ───────────────────────────────────────────────
  // RN-web renders into a root div. Wait until either:
  //   (a) the root div has non-empty children  (success path), or
  //   (b) an error overlay appears              (crash path), or
  //   (c) waitMs elapses                        (timeout path).
  log(`waiting for render (up to ${waitMs}ms)…`);
  try {
    await page.waitForFunction(
      () => {
        // RN-web mounts a root View as a direct child of <body> (or a #root div).
        // After hydration the root element has at least one child.
        const body = document.body;
        if (!body) return false;

        // Error overlay present → stop waiting immediately (crash detected).
        const overlay = document.querySelector(
          "body > div[style*='z-index: 2147483647'], #expo-error-overlay, [data-testid='expo-error-overlay']"
        );
        if (overlay) return true;

        // RN-web renders everything inside a root div (often first child of body).
        const root = document.getElementById("root") || body.firstElementChild;
        return root ? root.children.length > 0 : false;
      },
      { timeout: waitMs }
    );
    log(`render wait complete`);
  } catch {
    log(`render wait timed out — proceeding with snapshot`);
  }

  // ── Optional: interact with the app ────────────────────────────────────────
  // Run fill/click interactions AFTER initial render settles.
  // These are best-effort; failures are noted in assertions, not thrown.
  for (const { selector, text } of fills) {
    try {
      log(`fill: ${selector} = "${text}"`);
      await page.fill(selector, text, { timeout: 5000 });
    } catch (e) {
      log(`fill failed for ${selector}: ${e.message.slice(0, 100)}`);
    }
  }
  for (const selector of clicks) {
    try {
      log(`click: ${selector}`);
      await page.click(selector, { timeout: 5000 });
      // Give React state a tick to settle after each click.
      await page.waitForTimeout(500);
    } catch (e) {
      log(`click failed for ${selector}: ${e.message.slice(0, 100)}`);
    }
  }

  // ── Snapshot the DOM ────────────────────────────────────────────────────────
  const [bodyText, hasErrorOverlay] = await page.evaluate(() => {
    const body = document.body;
    const text = (body?.innerText ?? "").trim().slice(0, 4000);

    // Check for RN-web / Metro error overlay presence.
    const overlay = document.querySelector(
      "body > div[style*='z-index: 2147483647'], " +
      "#expo-error-overlay, " +
      "[data-testid='expo-error-overlay']"
    );
    // Also check for a full-screen overlay via computed styles.
    // Metro's overlay is a fixed full-screen div with very high z-index.
    let overlayDetected = !!overlay;
    if (!overlayDetected) {
      const allDivs = document.querySelectorAll("body > div");
      for (const div of allDivs) {
        const s = window.getComputedStyle(div);
        const zi = parseInt(s.zIndex, 10);
        if (zi > 9999 && s.position === "fixed") {
          const t = (div.innerText ?? "").toLowerCase();
          if (
            t.includes("error") ||
            t.includes("element type") ||
            t.includes("invariant") ||
            t.includes("something went wrong")
          ) {
            overlayDetected = true;
            break;
          }
        }
      }
    }
    return [text, overlayDetected];
  });

  result.textSnapshot = bodyText;

  // ── Screenshot (optional) ───────────────────────────────────────────────────
  if (takeScreenshot) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(
      screenshotDir,
      `${sandboxId}-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshotPath = screenshotPath;
    log(`screenshot: ${screenshotPath}`);
  }

  // ── Analyse collected signals ───────────────────────────────────────────────

  // 1. Filter console messages for errors/warnings worth surfacing.
  const surfacedConsole = consoleMessages
    .filter((m) => m.level === "error" || m.level === "warn")
    .map((m) => `[${m.level}] ${m.text}`);

  // Include uncaught page errors as console errors.
  for (const pe of pageErrors) {
    surfacedConsole.push(`[pageerror] ${pe}`);
  }
  result.consoleErrors = surfacedConsole;

  // 2. Identify RN-web crash signatures in console output.
  const allConsoleText = [
    ...consoleMessages.map((m) => m.text),
    ...pageErrors,
  ].join("\n");

  result.rnCrashSignatures = CRASH_CONSOLE_PATTERNS
    .filter((p) => p.test(allConsoleText))
    .map((p) => p.toString());

  // 3. Check body text for crash patterns.
  const bodyCrashPatterns = CRASH_BODY_PATTERNS
    .filter((p) => p.test(bodyText))
    .map((p) => p.toString());

  // 4. Determine overall render success.
  //    "rendered = true" means: no error overlay, no console crash signatures,
  //    no crash text in body, and body is non-empty.
  const hasCrashInConsole = result.rnCrashSignatures.length > 0;
  const hasCrashInBody = bodyCrashPatterns.length > 0;
  const bodyIsEmpty = bodyText.trim().length === 0;

  result.rendered =
    !hasErrorOverlay && !hasCrashInConsole && !hasCrashInBody && !bodyIsEmpty;

  log(
    `rendered=${result.rendered} overlay=${hasErrorOverlay} ` +
    `consoleCrashes=${hasCrashInConsole} bodyCrashes=${hasCrashInBody} ` +
    `bodyEmpty=${bodyIsEmpty}`
  );

  // 5. Run caller-requested text assertions.
  for (const text of assertTexts) {
    const passed = bodyText.includes(text);
    result.assertions.push({
      name: `text-present: "${text}"`,
      passed,
      detail: passed
        ? `Found "${text}" in body text`
        : `"${text}" not found in body text (first 200 chars: ${bodyText.slice(0, 200)})`,
    });
  }

  // 6. Built-in assertions always run.
  result.assertions.push({
    name: "no-error-overlay",
    passed: !hasErrorOverlay,
    detail: hasErrorOverlay
      ? "Error overlay detected in DOM"
      : "No error overlay in DOM",
  });
  result.assertions.push({
    name: "no-rn-crash-in-console",
    passed: !hasCrashInConsole,
    detail: hasCrashInConsole
      ? `RN crash patterns: ${result.rnCrashSignatures.join("; ")}`
      : "No RN-web crash patterns in console",
  });
  result.assertions.push({
    name: "body-not-empty",
    passed: !bodyIsEmpty,
    detail: bodyIsEmpty ? "document.body.innerText is empty" : "Body has text content",
  });
  result.assertions.push({
    name: "no-crash-in-body-text",
    passed: !hasCrashInBody,
    detail: hasCrashInBody
      ? `Body crash patterns: ${bodyCrashPatterns.join("; ")}`
      : "No crash patterns in body text",
  });

  await context.close();
} catch (err) {
  result.error = err.message;
  log(`harness error: ${err.message}`);
} finally {
  if (browser) await browser.close();
  result.durationMs = Date.now() - t0;
  emit(result);
  // Exit with code 1 if rendered=false or any assertion failed, so CI/agents
  // can check $? without parsing JSON.
  const failed =
    !result.rendered ||
    result.assertions.some((a) => !a.passed) ||
    result.error !== null;
  process.exit(failed ? 1 : 0);
}
