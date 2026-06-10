# CLAUDE.md — module map & hard seam rules

Read this before changing anything. `tests/boundaries.test.ts` is the executable version
of these rules. Gate after every change: `npm run typecheck && npm run test:pure`.

## Module map

| Module | Contains | Interface |
|---|---|---|
| **convex-core** | `convex/{schema,convex.config,projects,files,versions,studio,testHelpers,codegenWorkflow}.ts`, `convex/lib/__fixtures__/minimalExpoApp.ts` | `api.projects.*`, `api.files.listByVersion`, `api.studio.listMessages`, `api.testHelpers.seedFixture`, `internal.files.*`, `internal.versions.patch`, `internal.codegenWorkflow.generateApp` (durable workflow identity — never rename) |
| **pipeline-kernel** | `convex/lib/{styles,validate,webcompat,palette}.ts` | model registry (`MODELS`, `DEFAULT_MODEL`, …), theme registry (`THEMES`, `pickVariants`, …), `validateManifest`, `repairFiles`. Pure: no `_generated`, no npm — test-enforced |
| **codegen** | `convex/codegen.ts`, `convex/agents/{codegen,prompt,designSystem,starterKit,starterKitNativewind}.ts` | `internal.codegen.runVariant` (sole runtime entry), `STARTER_KITS` (+ classic alias `STARTER_FILES`); prompt helpers are test-only |
| **preview** | `convex/preview.ts` + `convex/lib/sandbox/{index,daytona}.ts` (the three `"use node"` files), `convex/lib/sandbox/{types,typecheckRepair}.ts`, `app/api/preview/[id]/[[...path]]/route.ts` | `internal.preview.provisionPreview`, `GET /api/preview/:sandboxId/*`, `SandboxProvider` + `getSandboxProvider()` (the Modal/E2B/Fly swap point), `SANDBOX_APP_ROOT` |
| **studio-ui** | `app/`, `components/`, `lib/` (named contracts: `lib/previewContract.ts`, `components/studio/agentMessage.ts`) | routes `/` and `/studio/[projectId]`; imports from `convex/` ONLY via `convex/_generated/` |
| **qa-ops** | `tests/`, `scripts/`, `docs/`, `README.md`, `CONTRIBUTING.md`, config files | `npm run typecheck / test:pure / build / qa:e2e / qa:preview`; the frozen string-ref surface |

## Rule 1 — ZERO-REGENERATION

`convex/_generated/` is **committed and load-bearing** for `next build` (CI/Vercel run no
codegen step). `npx convex codegen` works locally again since the sandbox module got its
`"use node"` directives (it was broken before that — see Rule 4); regenerate CONSCIOUSLY
and commit the diff, never let it drift. Therefore:

- Never move/rename a convex entry file (the 10: schema, convex.config, projects, files,
  versions, studio, testHelpers, codegen, codegenWorkflow, preview).
- Registered functions (`query`/`mutation`/`internal*`/workflow defs) live ONLY in entry files.
- `git diff convex/_generated` stays empty in every commit.
- **These 7 api.d.ts-pinned helper paths are frozen** (typeof-imported by
  `convex/_generated/api.d.ts`; moving any breaks tsc unfixably): `convex/agents/codegen.ts`,
  `convex/agents/designSystem.ts`, `convex/agents/prompt.ts`, `convex/lib/styles.ts`,
  `convex/lib/validate.ts`, `convex/lib/webcompat.ts`, `convex/lib/__fixtures__/minimalExpoApp.ts`.
- Regen-diff note: if a future `npx convex dev` regen ever succeeds, it will **ADD** typeof
  entries for currently-absent modules (`lib/sandbox/*` incl. `typecheckRepair`,
  `agents/starterKit`) — that diff must be consciously reviewed and committed, not reverted reflexively.
- Adding a new **plain-function** file under `convex/` (no registered exports) is regen-safe.
  Don't let "never add convex files" ossify — the boundary test, not file count, is the law.

## Rule 2 — frozen string-ref surface

`scripts/*.mjs` call convex by untyped strings (`"projects:inspect"`, `"testHelpers:seedFixture"`,
`anyApi.projects.get`, `anyApi.files.listByVersion`) — invisible to tsc. The entire registered
surface is frozen as a snapshot table in `tests/boundaries.test.ts`; renames fail in 0.3s.

## Rule 3 — pure test closure

`test:pure` = `node --test --experimental-strip-types tests/*.test.ts` (flat glob). Anything
tests value-import must use relative `.ts`-extensioned imports — no `@/` aliases, no
`_generated`. The closure includes `lib/{models,themes,previewContract}.ts`,
`convex/lib/{styles,validate,webcompat,palette}.ts`, `convex/lib/sandbox/typecheckRepair.ts`, and
`convex/agents/{prompt,designSystem,starterKit,starterKitNativewind}.ts` — enforced by C3 in
`tests/boundaries.test.ts`: no `_generated`, no `convex`-package imports, and relative
value-imports must carry the `.ts` extension.

## Rule 4 — node/Daytona reachability

`"use node"` sits in directive position (line 1) of exactly three files: `convex/preview.ts`,
`convex/lib/sandbox/index.ts`, `convex/lib/sandbox/daytona.ts`. Convex analyzes every
`convex/` file in the isolate runtime unless the file ITSELF carries the directive — a
node-API file riding on its importer's directive breaks `convex dev`/`codegen` bundling
(this happened: @daytonaio/sdk → dotenv → node builtins). `@daytonaio/sdk` is reachable
only via `preview.ts → convex/lib/sandbox/**` (BFS-enforced).

## Rule 5 — mirror contract

`lib/models.ts` + `lib/themes.ts` are deliberate client mirrors of `convex/lib/styles.ts`
(no import — Next bundling must not couple to the convex dir). `tests/mirrors.test.ts`
keeps the values in sync.

## Dependencies & prompt cache

- `@convex-dev/workpool` + `convex-helpers` are REQUIRED PEERS of `@convex-dev/workflow` —
  exempt from any unused-dependency cleanup (C4).
- `convex/agents/prompt.ts` + `convex/agents/designSystem.ts` are byte-stable prompt-cache
  anchors: formatting-only edits have a real dollar cost.

## Change recipes

- **Add a model**: registry in `convex/lib/styles.ts` + mirror in `lib/models.ts`; `tests/mirrors.test.ts` enforces the sync.
- **Add a theme**: `THEMES` in `convex/lib/styles.ts` + `THEME_OPTIONS` in `lib/themes.ts`; same mirrors test.
- **Add a sandbox provider**: sibling file in `convex/lib/sandbox/` implementing `SandboxProvider`, registered in the `index.ts` env-gate — the UI needs nothing.

## Known debt (named, not hidden)

- Triplicated variant-arg shape (`codegenWorkflow.ts:8`, `codegen.ts:109`, `projects.ts:89`)
  and triplicated version-row construction (`projects.ts`, `testHelpers.ts`). Sanctioned
  future fix: a `variantArgFields` plain-object export in `convex/agents/` (regen-safe per
  Rule 1) once a real third consumer or auth lands.
- `buildInstructions` compat shim (`convex/agents/prompt.ts:309`) + its tests — deletable
  only in a deliberate test-suite-touching change.
- Dead `checkpoints` table (`convex/schema.ts:69`) + write-only `versions.plan` field —
  schema changes are founder-gated and need a deploy window.
- Overloaded `versions.sandboxProvider` vocabulary mixing provider identity with lifecycle
  state (`"daytona" | "provisioning" | "none" | "error"`).

---

**`tests/boundaries.test.ts` is the executable spec of these seams; change a surface and
its freeze list in the same commit.**
