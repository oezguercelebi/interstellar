# Interstellar — Coding Agent · Design Brief

> A designer's studio that emits a real native app. Describe an idea; an AI agent
> builds a beautiful, runnable **Expo** app file-by-file, live inside an iPhone
> frame you can interact with. Preview is the emotional center; code is the escape hatch.

## The 5 sparkles
1. **The living iPhone** — photoreal iOS device frame as the hero canvas, with a green "● live" pulse.
2. **The agent shows its work** — streaming activity timeline of file-write chips, each labeled in plain English.
3. **Generate-3-variations** — one prompt fans out to 3 parallel design directions, each filling its own iPhone.
4. **Checkpoint time-travel** — every prompt auto-creates a named version you can revisit live, never destructive.
5. **Open on your phone** — every build gets a share link + QR. The "it's real" moment.

## Stack
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind v3.4 + Radix primitives.
- **Backend:** Convex + `@convex-dev/agent` (the agent) + `@convex-dev/workflow` (durable generation pipeline).
- **LLM:** Anthropic `claude-opus-4-8` (hero quality), `claude-sonnet-4-6` (fast variants), via `@ai-sdk/anthropic`.
- **Sandbox:** **Daytona** (`@daytonaio/sdk`, `getPreviewLink(port)`).

## Design language
Deep-space glass-on-dark DNA warmed by a stellar amber accent (`#D4892D` / warm `#C8813B`).
Studio = dark glass; landing = light starlight cream. Elevation = amber/gold glow, never dark shadow.
Emphasis via weight, not size. Calm entrance motion, reduced-motion honored.

## Architecture
```
app/
  layout.tsx                     # ConvexClientProvider, Inter, theme
  page.tsx                       # Landing / empty state (light)
  studio/[projectId]/page.tsx    # Studio (dark) — chat + preview split
convex/
  convex.config.ts               # registers agent + workflow components
  schema.ts                      # projects / versions / files / checkpoints
  agents/codegen.ts              # THE agent: model, tools, system prompt, house design system
  codegenWorkflow.ts             # durable generate pipeline (fan-out variants)
  projects.ts versions.ts files.ts  # CRUD + reactive queries
components/
  DeviceFrame · InterstellarMark · ModelPicker · ThemePicker
  studio/: ChatRail · ActivityLog · PreviewStage · CodeView · VersionTabs · QRDialog
```

### Data model
- `projects { userId, title, prompt, createdAt }`
- `versions { projectId, index, label, directive, status, model, threadId, workflowId, summary, previewUrl?, sandboxId? }`
- `files { versionId, path, contents, purpose, updatedAt }` — keyed `(versionId, path)`, **source of truth** (resumable).

### Generation pipeline (Convex Workflow, durable)
1. createThread + record version (mutation step)
2. fan-out `Promise.all` over N variant actions (parallel generation)
3. each variant: agent generates → tools upsert `files` → manifest
4. materialize: push files to Daytona
5. finalizeVersion: status ready + previewUrl
6. onComplete: flip state / handle failure cleanly

### Codegen contract
Code exits **only** through tools — never prose:
`writeFile({path, contents, purpose})`, `deleteFile({path})`, `finalize({summary, entryScreens})`.
Each `writeFile` → upsert + a live UI chip. This buys reliability + live UI + durability + resumability.
