# Interstellar QA harness

Agent-driven testing: verify the generate → preview → render loop via
request/response, reading one JSON verdict. Four layers, cheapest first.

## L1 — pure-static (free, ~0.2s)
```
npm run test:pure
```
Runs `tests/*.test.ts` against the REAL `convex/lib/*.ts` source (Node strips TS
types). Covers webcompat repair, validateManifest, theme/model/variant logic.
**Run this on every change** — it catches most regressions instantly.

## CLI introspection (free)
```
node scripts/convex-query.mjs query projects:inspect '{"projectId":"..."}' | jq .
node scripts/convex-query.mjs query  <module:fn> '<jsonArgs>'
node scripts/convex-query.mjs mutation <module:fn> '<jsonArgs>'
```
`projects:inspect` returns a one-call lifecycle snapshot: status, theme,
provider, previewUrl, fileCount, and a live `validateManifest` result. Stdout is
pure JSON; exit 0/1.

## L2+L3 — sandbox fixture + headless render (no model call, ~26s, ~$0)

**Prereqs:** `npm run qa:install` (once), `npm run dev:all` running in another
terminal (the render check drives the same-origin proxy on localhost:3000), and
the Daytona env vars set in your Convex deployment.

```
npm run qa:install            # one-time: playwright install chromium
npm run qa:e2e -- --fixture good     # positive path
npm run qa:e2e -- --fixture broken   # proves repairFiles self-heals at preview time
npm run qa:e2e -- --fixture good --screenshot --keep
```
`qa-e2e.mjs` orchestrates: preclean stale sandboxes → seed a known fixture app
(`convex/lib/__fixtures__/minimalExpoApp.ts`, no Anthropic call) → provision a
live Daytona preview → `wait-preview-ready.mjs` → headless render check through
the proxy (`qa-preview.mjs`) → teardown in a finally block.

Precleaning is **scoped to sandboxes created from this project's
`DAYTONA_SNAPSHOT`** — your other Daytona sandboxes are never touched. Pass
`--preclean-all` to wipe everything in the org (use with care).

**Verdict** (last line of stdout, exit 0 pass / 1 fail):
```json
{ "ok": true, "fixture": "broken", "validateOk": false, "rendered": true,
  "consoleErrors": [], "sandboxId": "...", "previewUrl": "...", "durationMs": 26344 }
```
`rendered:true` means: no error overlay, no RN-web crash console signature, no
crash text in body, body non-empty. A broken fixture has `validateOk:false` but
still `rendered:true` because the preview-time codemod heals the bad imports.

Drive a generated app directly (any live sandbox):
```
node scripts/qa-preview.mjs <sandboxId> --assert-text "Magic Sort" \
  --fill 'textarea' 'milk' --click 'text=Add' --screenshot
```

## L4 — full real-model E2E (costs money, run rarely)
Not wired by default. A `scripts/test-full-haiku.mjs` gated on `TEST_TIER=full`
would run one Haiku build end-to-end. Use only when changing the model/codegen
path; prefer L1+L2 for everything else.

## What still needs a human glance
The harness proves an app renders/behaves — not whether it looks *good*. Design
taste, prompt fidelity, and native-only layout still want eyes. Minimize with
`--screenshot` (PNGs land in `tmp/qa-screenshots/`, gitignored) for one review
per build batch instead of per-screen manual QA.
