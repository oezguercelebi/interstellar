/**
 * The studio client's one piece of knowledge about the @convex-dev/agent 0.6.x
 * UIMessage wire shape: streamed messages carry a `parts[]` array (text
 * segments interleaved with tool-call parts); plain/older shapes fall back to
 * `.text` / `.content`. Keep that knowledge here — render components should
 * consume `messageText()` instead of poking at message internals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function messageText(m: any): string {
  if (Array.isArray(m.parts)) {
    // Each text part is a separate narration segment between tool calls (e.g.
    // "Now the root layout:"). Join with blank lines so they render as distinct
    // paragraphs instead of one run-on blob (…tokens.Now the root layout:…).
    const t = m.parts
      .filter((p: any) => p.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (t) return t;
  }
  return m.text ?? m.content ?? "";
}
