# Contributing to Interstellar

Thanks for your interest! This doc covers local setup, the test harness, and the
non-obvious gotchas that will save you hours.

## Local setup

Follow the [README](README.md#running-locally) — short version:

```bash
npm install                          # .npmrc sets legacy-peer-deps (see below)
npx convex dev --once --configure    # create/select a Convex cloud project
cp .env.example .env.local           # fill in your keys
node scripts/bake-snapshot.mjs       # one-time: bake the Daytona Expo snapshot
npm run dev:all                      # Convex + Next.js together
```

You need your own accounts for: [Anthropic](https://console.anthropic.com/)
(the coding agent), [Daytona](https://app.daytona.io/) (preview sandboxes), and
[Convex](https://convex.dev/) (backend — free tier is fine).

Remember to mirror the env vars into Convex (`npx convex env set KEY value`) —
the agent and sandbox provisioning run server-side in Convex actions.

## Testing

Cheapest first — see [docs/QA.md](docs/QA.md) for the full harness guide.

```bash
npm run test:pure                    # pure-static unit tests, ~0.2s — run on every change
npm run typecheck                    # tsc --noEmit
npm run qa:e2e -- --fixture good     # real Daytona sandbox E2E (no model call, ~30s)
```

## Gotchas (hard-won — don't repeat them)

- **`.npmrc` has `legacy-peer-deps=true`** — `@convex-dev/agent@0.6` declares a strict
  peer on `ai@^6.0.35` that ERESOLVEs against the rest of the tree. The pinned versions
  work; the flag just lets npm install them.
- **`@convex-dev/agent@0.6` needs AI SDK v6** (`ai@6`, `@ai-sdk/anthropic@3`), not v5.
  Its `createTool` API is `{ inputSchema, execute }` — `args`/`handler` are typed
  error-sentinels that fail tsc.
- **Agent step limit** is `stopWhen: stepCountIs(n)` on the Agent constructor, not `maxSteps`.
- **Streaming**: use the object form `saveStreamDeltas: { chunking: "word", throttleMs: 100 }`
  (the boolean form crashes) and always `await result.consumeStream()`.
- **Node v23+ breaks the *local* Convex backend** for `"use node"` actions — use a
  Convex *cloud* dev deployment (the default `npx convex dev` flow).
- **Daytona snapshots**: sandbox resources can only be set when creating the snapshot
  *from an image* — that's why `scripts/bake-snapshot.mjs` bakes `cpu:4, memory:4, disk:10`
  in. Default 1 GB sandboxes get OOM-killed by Metro.
- **Daytona free tier** ≈ 30 GiB disk total (~3 concurrent sandboxes). If previews fail
  with "disk limit exceeded", delete stale sandboxes:
  `curl -X DELETE "$DAYTONA_API_URL/sandbox/$ID?force=true" -H "Authorization: Bearer $DAYTONA_API_KEY"`
- **`next build` clobbers `.next`** under a running `next dev` — restart dev after a build.
- **Convex API reference**: [docs/convex-api-notes.md](docs/convex-api-notes.md) documents
  the exact agent/workflow APIs verified against the pinned versions.

## Code conventions

- TypeScript everywhere; `npm run typecheck` must pass with 0 errors.
- The `files` table is the source of truth for generated apps — the agent only emits
  code through tools (`writeFile`/`deleteFile`/`finalize`), never prose. Keep it that way.
- UI follows the deep-space glass design language (see `app/globals.css` and
  `tailwind.config.ts`) — amber/gold accents, elevation via glow, emphasis via weight.
- Validation lives in pure modules (`convex/lib/*.ts`) so the test harness can import
  them without a Convex runtime.

## Pull requests

- Run `npm run test:pure && npm run typecheck` before pushing.
- Keep PRs focused; describe *why*, not just *what*.
