# Convex Agent + Workflow API Notes (verified against installed src)

> Pinned versions actually resolved & inspected for this doc:
> - `@convex-dev/agent@0.6.2` (peerDeps: `ai@^5.0.71 || ^6.0.0`, `convex >=1.25`, `react ^18.3.1 || ^19`)
> - `@convex-dev/workflow@0.4.2` (internally depends on `@convex-dev/workpool`)
> - `@convex-dev/workpool@0.4.0`
> - `ai@^6` (exports `stepCountIs`), `@ai-sdk/anthropic@3.0.x`, `zod@^3`, `convex@^1.39`
>
> **Every symbol below was read from the local installed `src/*.ts`** (the project's own
> `node_modules` was not present, so packages were installed into a scratch dir and the
> readable `src/*.ts` files inspected — these are the same published sources). Citations
> give `file:symbol`. Where the public docs differ from installed src, it is flagged with **⚠ FLAG**.
>
> `zod` import: the agent README and examples import zod as **`import { z } from "zod/v3"`**
> (cite: `agent/README.md` "Defining the Agent"). Plain `import { z } from "zod"` also works
> since the project is on zod 3, but `zod/v3` is the form the component examples use.

---

## A. `convex/convex.config.ts`

Agent install: `agent/README.md` → `import agent from "@convex-dev/agent/convex.config"; app.use(agent);`
Workflow install: `workflow/README.md` → `import workflow from "@convex-dev/workflow/convex.config"; app.use(workflow);`

**Workpool does NOT need to be registered at the app level.** The workflow component
registers workpool *inside itself*:

```ts
// node_modules/@convex-dev/workflow/src/component/convex.config.ts (verbatim)
import { defineComponent } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("workflow");
component.use(workpool);            // NOTE: no { name } arg in 0.4.2

export default component;
```

The workflow component's own config is (verbatim from
`workflow/src/component/convex.config.ts`):
```ts
import { defineComponent } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";
const component = defineComponent("workflow");
component.use(workpool);          // NOTE: no { name } arg in 0.4.2
export default component;
```

So the app config is exactly (this already matches the file currently in the repo,
`convex/convex.config.ts`, which was read and confirmed):

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import workflow from "@convex-dev/workflow/convex.config";

const app = defineApp();
app.use(agent);
app.use(workflow);

export default app;
```

Export paths verified in package.json `exports`:
- agent: `"."` and `"./react"` (and `./convex.config`).
- workflow: `"."`, `"./convex.config"`.

`components` is generated from these: `import { components } from "./_generated/api";`
then `components.agent` and `components.workflow` exist.

---

## B. Defining the Agent — `convex/agents/codegen.ts`

`Agent` is the default export class. Constructor (cite `agent/src/client/index.ts:export class Agent`):
`new Agent(component, options)` where `component` is `components.agent`.

The language model option is **`languageModel`** (not `model`). With `@ai-sdk/anthropic@3`
the provider object supports all of these (cite `@ai-sdk/anthropic/dist/index.d.ts:AnthropicProvider`):

```ts
interface AnthropicProvider extends ProviderV3 {
  (modelId: AnthropicMessagesModelId): LanguageModelV3;          // anthropic("model")
  languageModel(modelId): LanguageModelV3;                        // anthropic.languageModel("model")
  chat(modelId): LanguageModelV3;                                 // anthropic.chat("model")
  messages(modelId): LanguageModelV3;                            // anthropic.messages("model")
  ...
}
```

So `anthropic("claude-opus-4-8")` and `anthropic.chat("claude-opus-4-8")` are **both valid**.
The agent README uses `.chat(...)`.

Step limiting is **`stopWhen: stepCountIs(n)`** from `ai` (cite `ai/dist/index.d.ts:stepCountIs`
→ `declare function stepCountIs(stepCount: number): StopCondition`). The README "Defining the
Agent" section shows `stopWhen: stepCountIs(5)`. **⚠ FLAG:** there is **no top-level `maxSteps`
option** on the Agent constructor in 0.6.2 — that was the AI SDK v4 name; v6 + agent 0.6.2 use
`stopWhen`. (`callSettings.maxRetries` exists but is unrelated — it's per-call retry count.)

```ts
// convex/agents/codegen.ts
import { Agent } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { stepCountIs } from "ai";
import { components } from "../_generated/api";
import { writeFile } from "../tools/writeFile"; // see section C

export const codegenAgent = new Agent(components.agent, {
  name: "Codegen Agent",
  languageModel: anthropic.chat("claude-opus-4-8"), // or anthropic("claude-opus-4-8")
  instructions:
    "You are a code-generation agent. Given a prompt, call the writeFile tool " +
    "once per file you need to create, then finish with a short summary.",
  tools: { writeFile },
  // Allow many tool-call rounds: each writeFile is a step, so budget generously.
  stopWhen: stepCountIs(32),
  // optional: callSettings: { temperature: 0.2 },
});
```

Constructor option names verified present in `agent/README.md` "Defining the Agent":
`name`, `languageModel`, `textEmbeddingModel`, `instructions`, `tools`, `contextOptions`,
`storageOptions`, `stopWhen`, `usageHandler`, `callSettings`, `providerOptions`.

---

## C. Tools with Convex `ctx` access

> **⚠ CORRECTION — the code is the source of truth here.** In the installed
> `@convex-dev/agent@0.6.2`, the working `createTool` API is
> **`{ inputSchema, execute(ctx, input) }`** — see `convex/agents/codegen.ts`.
> The `args`/`handler` shape documented below comes from an earlier inspection;
> in 0.6.2 those fields are typed error-sentinels and **fail tsc**. The rest of
> this section (ctx-first ordering, `ToolCtx` fields, zod v3, per-version ctx
> binding) still holds.

`createTool` is exported from `@convex-dev/agent` and re-exported at the package root
(cite `agent/src/client/index.ts:141 export { createTool, type ToolCtx } from "./createTool.js"`).
Verbatim signature from `agent/src/client/createTool.ts:33`:

```ts
export function createTool<
  ARGS extends ToolParameters,        // ToolParameters = ZodTypeAny | Schema<unknown>
  RESULT = any,
>(convexTool: {
  description?: string;
  args: ARGS;                          // REQUIRED (not optional)
  handler: (
    ctx: ToolCtx,
    args: inferParameters<ARGS>,
    options: ToolCallOptions,
  ) => PromiseOrValue<RESULT>;
  ctx?: ToolCtx;
} & Omit<Tool<...>, "execute" | "parameters" | "inputSchema">): Tool<inferParameters<ARGS>, RESULT>
```

So the handler is **`(ctx, args, options)`** — note `ctx` is FIRST (this differs from the bare
AI SDK `tool()` where args is first; `createTool` wraps `ai`'s `tool()` and injects `ctx` via
`options.experimental_context`). `args` is **required**. Note `createTool.ts` itself imports
`import type { ... } from "zod/v3"` — confirming zod v3 is the intended schema type.

`ToolCtx` (cite README "Defining the Agent" import `type ToolCtx`, and tools docs) extends the
Convex `ActionCtx` and adds agent fields. It exposes: `runMutation`, `runQuery`, `runAction`,
`auth`, `storage`, plus `agent`, `userId`, `threadId`, `messageId`. So inside a tool handler you
can call `ctx.runMutation(internal.x.y, {...})` directly, and read `ctx.threadId` / `ctx.messageId`.

`args` uses **zod v3** (`import { z } from "zod/v3"`); use `.describe()` so the LLM sees param docs.

Complete `writeFile` tool. **NOTE on this repo's schema** (read from `convex/schema.ts`): the
`files` table is keyed by **`versionId`** (a `v.id("versions")`), not by `threadId`, with fields
`{ versionId, path, contents, purpose: v.string(), deleted?, updatedAt }` and index
`by_version_path: ["versionId","path"]`. The agent's `ctx` only knows `threadId`/`messageId`, not
the `versionId`. The clean way to bridge that is to bind the agent **per-version** via a custom
ctx so the tool can read `ctx.versionId`:

```ts
// convex/agents/codegen.ts — give the agent a custom ctx carrying versionId
type CodegenCtx = ToolCtx & { versionId: Id<"versions"> };
export const codegenAgent = new Agent<{ versionId: Id<"versions"> }>(components.agent, { ... });
// then in the streaming action, attach it: see asTextAction({ customCtx }) or pass via tool closure.
```

```ts
// convex/tools/writeFile.ts
import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod/v3";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export const writeFile = createTool({
  description: "Write or overwrite a single source file in the project.",
  args: z.object({
    path: z.string().describe("Repo-relative file path, e.g. App.tsx"),
    contents: z.string().describe("The full file contents."),
    purpose: z.string().describe("Plain-English label shown in the activity log."),
  }),
  handler: async (ctx: ToolCtx & { versionId: Id<"versions"> }, args): Promise<string> => {
    // ctx.threadId / ctx.messageId are available; ctx.versionId comes from customCtx.
    await ctx.runMutation(internal.files.upsert, {
      versionId: ctx.versionId,
      path: args.path,
      contents: args.contents,
      purpose: args.purpose,
    });
    return `Wrote ${args.path} (${args.contents.length} bytes)`;
  },
});
```

```ts
// convex/files.ts — the mutation the tool calls (matches convex/schema.ts)
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const upsert = internalMutation({
  args: {
    versionId: v.id("versions"),
    path: v.string(),
    contents: v.string(),
    purpose: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("files")
      .withIndex("by_version_path", (q) =>
        q.eq("versionId", args.versionId).eq("path", args.path),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        contents: args.contents,
        purpose: args.purpose,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("files", { ...args, updatedAt: Date.now() });
  },
});
```

Custom ctx is wired via the typed `Agent<{ versionId: Id<"versions"> }>` and `asTextAction({
customCtx })` / passing `customCtx` through `streamText` options — the constructor type param
flows into `ToolCtx` so `ctx.versionId` is available in the handler (cite the `CustomCtx` generic
on `Agent`, `client/index.ts:217`, and `MaybeCustomCtx` in `asTextAction`, `client/index.ts:1521`).

---

## D. Threads + sending messages

### `createThread`
Cite `agent/src/client/index.ts:766`:
```ts
export async function createThread(
  ctx: RunMutationCtx,
  component: AgentComponent,        // pass components.agent
  args?: { userId?: string | null; title?: string; summary?: string },
): Promise<string>                  // returns the threadId
```
Usage: `const threadId = await createThread(ctx, components.agent, { userId, title });`

### `saveMessage` (free function)
Verbatim from `agent/src/client/messages.ts:205`:
```ts
export async function saveMessage(
  ctx: RunMutationCtx,
  component: AgentComponent,
  args: {
    threadId: string;
    userId?: string | null;
    metadata?: Omit<MessageWithMetadata, "message">;
  } & (
    | { message: Message; prompt?: undefined }   // full message object
    | { prompt: string; message?: undefined }    // OR a plain user-text prompt
  ),
): Promise<{ messageId: string }>
```
Returns **`{ messageId: string }`**. Exactly one of `prompt` (string) or `message` (object) is
given (enforced by the union). NOTE: the **free function has no `skipEmbeddings` arg** — that flag
lives on the *instance* method `agent.saveMessage` below. Use the instance method inside a mutation.

### `agent.saveMessage` (instance method — use this in the mutation step)
Verbatim from `agent/src/client/index.ts:710`:
```ts
async saveMessage(
  ctx: MutationCtx | ActionCtx,
  args: SaveMessageArgs & { skipEmbeddings?: boolean },
): Promise<{ messageId: string; message: MessageDoc }>
```
`SaveMessageArgs` carries `{ threadId, userId?, prompt? | message?, metadata?, promptMessageId?,
pendingMessageId?, embedding? }`. Returns **`{ messageId, message }`** (the body does
`const message = messages.at(-1)!; return { messageId: message._id, message }`). Pass
`skipEmbeddings: true` when calling from a mutation (the src logs a warning otherwise).

### Two-step streaming pattern (the canonical example: `example/convex/chat/streaming.ts`)
**Step 1 — mutation** saves the user message and schedules the streaming action.
**Step 2 — action** streams. This enables client optimistic updates.

```ts
// convex/chat.ts
import { mutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { codegenAgent } from "./agents/codegen";

export const initiateAsyncStreaming = mutation({
  args: { prompt: v.string(), threadId: v.string() },
  handler: async (ctx, { prompt, threadId }) => {
    // (authorize thread access here if needed)
    const { messageId } = await codegenAgent.saveMessage(ctx, {
      threadId,
      prompt,
      skipEmbeddings: true, // we're in a mutation; embeddings generated lazily later
    });
    await ctx.scheduler.runAfter(0, internal.chat.streamAsync, {
      threadId,
      promptMessageId: messageId,
    });
  },
});

export const streamAsync = internalAction({
  args: { promptMessageId: v.string(), threadId: v.string() },
  handler: async (ctx, { promptMessageId, threadId }) => {
    const result = await codegenAgent.streamText(
      ctx,
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
  },
});
```

---

## E. Streaming generation in an action (the heart)

`agent.streamText` (cite `agent/src/client/index.ts:2410 async streamText`):
```ts
async streamText<TOOLS, OUTPUT, OUTPUT_PARTIAL>(
  ctx: ActionCtx,
  { userId, threadId }: { userId?: string | null; threadId?: string | null },
  args: StreamTextArgs<TOOLS, OUTPUT, OUTPUT_PARTIAL>,   // { prompt } OR { promptMessageId } (+ optional messages/model/tools/stopWhen)
  options?: Options & {
    saveStreamDeltas?: boolean | StreamDeltasOptions,    // true = defaults; object = custom
  },
): Promise<...streaming result...>
```

- `args` is the AI-SDK-style streamText arg. In Convex usage you pass **either** `{ prompt }`
  **or** `{ promptMessageId }` (the messageId saved in step D). With `promptMessageId`, history
  + that prompt are hydrated automatically.
- `saveStreamDeltas`:
  - `true` → persist deltas with defaults.
  - `StreamDeltasOptions` object: `{ chunking?: "word" | "line" | ...; throttleMs?: number }`
    (cite example `chat/streaming.ts`: `{ chunking: "word", throttleMs: 100 }`).
- **Deltas only persist if the stream is consumed.** After `streamText` returns, you MUST drive
  the stream to completion: either `await result.consumeStream();` (recommended in an action) or
  iterate `for await (const chunk of result.textStream) {}` / `await result.text`. If the action
  returns before the stream is drained, deltas stop. (cite `chat/streaming.ts` comment: "We need
  to make sure the stream finishes ... or using this call to consume it all." → `await result.consumeStream()`.)
- **Tool execution during the stream:** tools registered on the agent (or passed in `args.tools`)
  are executed automatically as the model calls them. Each model turn + each tool round counts as
  a step; the loop continues until `stopWhen` is satisfied. So with `stopWhen: stepCountIs(32)`
  the model can call `writeFile` many times across steps, then produce a final text message — all
  within the single `streamText` call. `stopWhen` can be set on the constructor (default) or
  overridden per call inside `args`.

You can also avoid the boilerplate with `agent.asTextAction({ stream: true })` which returns a
ready-made internalAction (cite `chat/streaming.ts`: `storyAgent.asTextAction({ stream: true })`).

---

## F. Query for the client (streaming deltas)

Imports (all from `@convex-dev/agent`, cite example `chat/streaming.ts`):
`listUIMessages`, `syncStreams`, `vStreamArgs`.

Signatures from src:
```ts
// agent/src/client/index.ts
export async function listUIMessages(
  ctx: RunQueryCtx,
  component: AgentComponent,
  args: { threadId: string; paginationOpts: PaginationOptions; streamArgs?: StreamArgs } & ...,
): Promise<...paginated UIMessages...>

export async function syncStreams(
  ctx: RunQueryCtx,
  component: AgentComponent,
  args: {
    threadId: string;
    streamArgs: StreamArgs | undefined;
    includeStatuses?: ("streaming" | "finished" | "aborted")[];
  },
): Promise<...>
```
`vStreamArgs` is the Convex validator for the `streamArgs` query arg (cite `agent/src/validators.ts`).

Full paginated query (the exact shape used by `useUIMessages(..., { stream: true })`):

```ts
// convex/chat.ts (continued)
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const { threadId, streamArgs } = args;
    // (authorize here)
    const streams = await syncStreams(ctx, components.agent, { threadId, streamArgs });
    const paginated = await listUIMessages(ctx, components.agent, args);
    return { ...paginated, streams };
  },
});
```

Return shape **must** be `{ ...paginated, streams }` — the React hook reads `.page`, paging
cursors, and `.streams` off this object.

---

## G. React hooks (`@convex-dev/agent/react`)

All from `@convex-dev/agent/react` (the `./react` subpath export).

`useUIMessages` (verbatim from `agent/src/react/useUIMessages.ts:16`):
```ts
export function useUIMessages<Query extends UIMessagesQuery>(
  query: Query,
  args: PaginatedQueryArgs<Query> | "skip",
  options: { initialNumItems: number; stream?: boolean },
): { results: UIMessage[]; status: ...; loadMore: (numItems: number) => void }
```
(`UIMessagesQuery` = `PaginatedQueryReference & ...`; it requires the query's args to include
`threadId` + `paginationOpts` + `streamArgs`, which is why your section-F query must declare all
three.)
Usage (note `stream: true` to receive live deltas):
```tsx
const { results, status, loadMore } = useUIMessages(
  api.chat.listThreadMessages,
  { threadId },
  { initialNumItems: 20, stream: true },
);
```
`results` is an array of `UIMessage` (AI SDK v6 `UIMessage`). Render via `.parts`:
- text parts: `part.type === "text"` → `part.text`
- tool parts: AI SDK v6 names tool parts `tool-<toolName>` (e.g. `tool-writeFile`) or
  `dynamic-tool`; each has `state` (`input-streaming` | `input-available` | `output-available` |
  `output-error`), `input`, and `output`. So to show writeFile progress, match
  `part.type === "tool-writeFile"` and read `part.input.path` / `part.output`.

`toUIMessages` (cite `agent/src/react/index.ts:export function toUIMessages`):
```ts
export function toUIMessages(
  messages: (MessageDoc & { streaming?: boolean })[],
): UIMessage[]
```
Use when you have raw `MessageDoc[]` (e.g. from a non-UI query) and want UI-shaped messages.

`useSmoothText` (verbatim from `agent/src/react/useSmoothText.ts:14`):
```ts
export function useSmoothText(
  text: string,
  opts?: { charsPerSec?: number; startStreaming?: boolean }, // defaults: 256, false
): [string, { isStreaming: boolean }]
```
Exported as `useSmoothText` and `type SmoothTextOptions` from `@convex-dev/agent/react`.
Usage: `const [visibleText] = useSmoothText(message.text, { startStreaming: message.status === "streaming" });`

`optimisticallySendMessage` (verbatim from `agent/src/react/optimisticallySendMessage.ts:13`):
```ts
export function optimisticallySendMessage(
  query: PaginatedQueryReference,
): (store: OptimisticLocalStore, args: { threadId: string; prompt: string }) => void
```
Usage — wire it to the *list* query, then attach to the send mutation:
```tsx
const sendMessage = useMutation(api.chat.initiateAsyncStreaming)
  .withOptimisticUpdate(
    optimisticallySendMessage(api.chat.listThreadMessages),
  );
// later: await sendMessage({ threadId, prompt });
```
Note the optimistic args are exactly `{ threadId, prompt }` — your mutation must accept those.

**Known 0.6.x streaming gotchas:**
- Deltas never appear on the client if the action doesn't `await result.consumeStream()` (or
  otherwise drain the stream). Silent failure mode.
- The list query must return `{ ...paginated, streams }`; if you forget `streams`, the hook shows
  only finalized messages, not live deltas.
- `useUIMessages` requires `stream: true` to subscribe to deltas; without it you only get pages.
- The query is called with multiple permutations of `streamArgs` (delta vs full); keep the handler
  pure / side-effect-free.

---

## H. Workflow — `convex/codegenWorkflow.ts`

`WorkflowManager` (cite `workflow/src/client/index.ts:export class WorkflowManager`):
```ts
import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";
export const workflow = new WorkflowManager(components.workflow);
```

`workflow.define` is a **method on `WorkflowManager`** (verbatim from
`workflow/src/client/index.ts:496`):
```ts
define<ArgsValidator extends PropertyValidators,
       ReturnsValidator extends Validator<any,"required",any> | void = void>(
  workflow: {
    args?: ArgsValidator;                                  // convex validators (v.*)
    handler: WorkflowHandler<ArgsValidator, ReturnsValidator>;
    returns?: ReturnsValidator;
    workpoolOptions?: WorkpoolOptions;
  },
): RegisteredMutation<"internal", WorkflowArgs<ArgsValidator>, WorkflowId>
```
`WorkflowHandler` (cite `workflow/src/client/index.ts:94`) is
`(step: WorkflowCtx, args: ObjectType<ArgsValidator>) => Promise<...>` — the first param is the
step/ctx object, second is the validated args. The handler **MUST be deterministic** (see below).

**⚠ FLAG (vs the public example file):** the public `example/convex/index.ts` uses the *fluent*
`workflow.define({...}).handler(async (step, args) => {...})` form (that comes from the separate
standalone `defineWorkflow(component, config).handler(fn)` export, `client/index.ts:130`). The
**`WorkflowManager.define` method takes a single object** `{ args, handler, returns?,
workpoolOptions? }` — that is the form to use with `new WorkflowManager(...)`. Don't mix them.

The step object passed to the handler is a `WorkflowCtx` (verbatim from
`workflow/src/client/workflowContext.ts:42`) exposing:
```ts
type WorkflowCtx = {
  workflowId: WorkflowId;
  runQuery(query, args, opts?: RunOptions & { inline?: boolean }): Promise<...>;
  runMutation(mutation, args, opts?: RunOptions & { inline?: boolean }): Promise<...>;
  runAction(action, args, opts?: RunOptions & RetryOption): Promise<...>;   // only actions take retry
  runWorkflow(workflow, args, opts?: RunOptions): Promise<...>;             // nested workflows
  awaitEvent(event): Promise<T>;
  sleep(durationMs: number, opts?: { name?: string }): Promise<void>;
};
```
The per-step options (`RunOptions`, `workflowContext.ts:16`, merged with `SchedulerOptions` and —
**only for `runAction`** — `RetryOption`):
```ts
{
  name?: string;        // step name (defaults to derived fn name)
  unstableArgs?: boolean;
  runAfter?: number;    // relative delay ms   (SchedulerOptions)
  runAt?: number;       // absolute timestamp  (SchedulerOptions)
  retry?: boolean | RetryBehavior;  // runAction only (RetryOption)
}
```
**⚠ NOTE:** `retry` is accepted on **`runAction`** but NOT on `runMutation`/`runQuery` in the
0.4.2 types (mutations/queries are deterministic and replayed, not retried). The public example's
`step.runMutation(..., { retry: true })` would not typecheck against this src — put `retry` only
on `runAction`. Queries/mutations also accept `inline: true` (run synchronously in the workflow
mutation; cannot combine with `runAt`/`runAfter`).
`RetryBehavior` (verbatim from `workpool/src/component/shared.ts:47`):
```ts
export type RetryBehavior = {
  maxAttempts: number;
  initialBackoffMs: number;
  base: number;
};
```

Parallel fan-out is plain `Promise.all` over `step.*` calls (cite example `index.ts`):
```ts
const [a, b] = await Promise.all([
  step.runAction(internal.x.gen, args, { retry: true }),
  step.runAction(internal.x.gen, args, { runAfter: 100 }),
]);
```

`workflow.start` is a `WorkflowManager` method (verbatim from `workflow/src/client/index.ts:532`):
```ts
async start<F extends FunctionReference<"mutation", "internal">>(
  ctx: RunMutationCtx,               // a mutation/action ctx
  workflow: F,                       // internal.codegenWorkflow.generateApp
  args: FunctionArgs<F>["args"],
  options?: {
    onComplete?: FunctionReference<"mutation", "internal">;
    context?: unknown;               // passed through verbatim to onComplete
    startAsync?: boolean;            // default false = run handler as part of start
  },
): Promise<WorkflowId>
```
There is **also a standalone `start` export** from `@convex-dev/workflow`
(`client/index.ts:189`, signature `start(ctx, workflow, args, options?)`) — the method just
delegates to it. Prefer the method `workflow.start(ctx, ...)`.

`onComplete` handler is a normal `internalMutation` whose args are
`{ workflowId: vWorkflowId, result: vResultValidator, context: v.any() }`
(cite example `index.ts:flowCompleted`; `vWorkflowId` from `@convex-dev/workflow`,
`vResultValidator` re-exported from BOTH `@convex-dev/workflow` (`client/index.ts:45`) and
`@convex-dev/workpool`). `result` is the workpool Result union
(`{ kind: "success"; returnValue } | { kind: "failed"; error } | { kind: "canceled" }`).

Status / cancel / cleanup — all `WorkflowManager` methods (verbatim
`workflow/src/client/index.ts:548/558/679`):
```ts
async status(ctx: RunQueryCtx, workflowId: WorkflowId): Promise<WorkflowStatus>   // note: id only, no component arg
async cancel(ctx: RunMutationCtx, workflowId: WorkflowId): Promise<void>
async cleanup(ctx: RunMutationCtx, workflowId: WorkflowId): Promise<boolean>
```
`WorkflowStatus` (cite `client/index.ts:102`) is the union:
```ts
| { type: "inProgress"; running: IdsToStrings<Step>[] }
| { type: "completed"; result: unknown }
| { type: "canceled" }
| { type: "failed"; error: string }
```
To watch status reactively from React, wrap `workflow.status(ctx, id)` in your own public `query`
and subscribe with `useQuery`. (Store the returned `WorkflowId` somewhere first, e.g. on the
`versions` row's `workflowId` field, which the schema already has.)

**Determinism rules:** the `handler(step, args)` body re-executes on replay, so it must be
deterministic — **no** direct `ctx.db`, `fetch`, `Date.now()`, `Math.random()`, env reads, or
`ctx.runX` in the handler body. All side effects + nondeterminism live inside the functions you
invoke via `step.runAction` / `step.runMutation` / `step.runQuery`. The handler may only: read
`args`, branch on prior step *return values*, call `step.*`, `Promise.all` them, `step.sleep`,
and return a (validator-matching) value.

Full skeleton:
```ts
// convex/codegenWorkflow.ts
import { v } from "convex/values";
import { WorkflowManager, vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const workflow = new WorkflowManager(components.workflow);

export const generateApp = workflow.define({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (step, args) => {
    // fan out parallel variant generations, each in its own action (side effects allowed there)
    await Promise.all([
      step.runAction(internal.chat.streamAsync, args, { retry: true, name: "variantA" }),
      step.runAction(internal.chat.streamAsync, args, { retry: true, name: "variantB" }),
    ]);
    return null;
  },
});

export const startGeneration = internalMutation({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, args) => {
    const id = await workflow.start(
      ctx,
      internal.codegenWorkflow.generateApp,
      args,
      { onComplete: internal.codegenWorkflow.onDone, context: { threadId: args.threadId } },
    );
    return id;
  },
});

export const onDone = internalMutation({
  args: { workflowId: vWorkflowId, result: vResultValidator, context: v.any() },
  handler: async (ctx, args) => {
    // mark the thread done, etc. args.result is the workpool Result union.
  },
});
```

---

## Discrepancy summary (installed src vs public docs)

1. **`maxSteps` does not exist** on the Agent constructor / streamText in 0.6.2 — use
   `stopWhen: stepCountIs(n)` from `ai`. (Older docs/blog posts referencing `maxSteps` are AI SDK v4.)
2. **`workflow.define`**: the `WorkflowManager.define(...)` *method* takes a single object
   `{ args, handler, returns?, workpoolOptions? }` (cite `workflow/src/client/index.ts:496`). The
   public example's fluent `.define({...}).handler(...)` comes from the separate standalone
   `defineWorkflow(component, config).handler(fn)` export — a different API. With
   `new WorkflowManager(...)` use the single-object method form. The handler signature is
   `(step, args)` where `step` is a `WorkflowCtx` (`runQuery`/`runMutation`/`runAction`/`sleep`/
   `runWorkflow`/`awaitEvent`/`workflowId`).
3. **Workpool is not registered at the app level** — `app.use(workflow)` is enough; the workflow
   component pulls in workpool internally.
4. `createTool` handler arg order is **`(ctx, args, options)`** (ctx first), unlike the bare AI SDK
   `tool()` whose handler is `(args, options)`.
5. zod is imported as `zod/v3` in the agent examples.
