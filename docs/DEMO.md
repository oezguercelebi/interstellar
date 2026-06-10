# Interstellar — Demo walkthrough

A ~3-minute script that hits every wow moment. Run `npm run dev:all`, open
`http://localhost:3000`, and follow along.

## 0. Before you record (30s)
- `npm run dev:all` is running; the studio loads with no console errors.
- Have one project pre-generated so you can show a *finished* live preview immediately if you
  don't want to wait for a cold generation on camera.

## 1. The pitch (15s)
> "This is Interstellar — you describe an app, and an AI agent designs and builds a real, native Expo
> app, live, on an iPhone. Not a website in a phone — a real app."

Show the landing page: the orbital mark, the hero "Make your ideas **orbit**", the composer, the
suggested prompts.

## 2. Generate (45s)
- Type: **"Create a todo app with a daily streak and satisfying check animations."**
- Toggle **3 variations** to show the parallel-generation story (or keep 1 design for speed).
- Hit **Build** → routes into the studio.
- Narrate the **activity log streaming in**: "the agent is writing the app file by file —
  theme tokens, the navigator, the home screen, components — each one lands live." Point out the
  assistant's prose streaming token-by-token.

## 3. The living preview (45s)
- The **iPhone frame** boots ("Designing your app…" → the real app appears) with the green
  **● live** pulse.
- Interact with the app *inside the frame* — tap, scroll. "This is the real app running in a
  cloud sandbox via Expo + Metro."
- Click **QR** → "Open on your phone" — scan it to open the same live app on a real device.

## 4. Code is the escape hatch (20s)
- Flip the **Preview / Code** toggle. Browse the file tree — `theme/tokens.ts`, `app/_layout.tsx`,
  screens, components. "Real, readable, idiomatic Expo Router code — every hex and spacing value
  comes from one token file."

## 5. Edit / time-travel (30s)
- In the chat, type a follow-up: **"add a dark mode toggle in the header."**
- Watch a new **version** appear in the tabs and build. Switch between versions — "non-destructive
  checkpoints; tap any past version to interact with it live."

## 6. Under the hood (20s — optional)
> "The agent only emits code through a `writeFile` tool that upserts into a Convex table — so the
> file table, not the model's context, is the source of truth. That makes generation streamable,
> resumable after a crash, and lets a server-side validator gate every build. The whole thing is a
> durable Convex **workflow** that fans out N variants in parallel, each its own Claude agent."

## Talking points
- **Convex Agent** gives streaming + threads + tool-calling for free (no SSE plumbing).
- **Convex Workflow** makes multi-variant generation durable + retried + parallel.
- **Daytona** runs the generated Expo app; a pre-baked snapshot keeps previews fast.
- **Design as a system**: the house design system injected into the agent is why output looks good on the first try.
