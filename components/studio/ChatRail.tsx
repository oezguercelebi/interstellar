"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useThreadMessages } from "@convex-dev/agent/react";
import { motion } from "framer-motion";
import { ArrowUp, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { InterstellarMark } from "@/components/InterstellarMark";
import { ActivityLog } from "./ActivityLog";
import { Markdown } from "./Markdown";
import { messageText } from "./agentMessage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ChatRail({
  version,
  projectId,
}: {
  version: Doc<"versions">;
  projectId: Id<"projects">;
}) {
  const edit = useMutation(api.projects.edit);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const threadId = version.threadId;
  const thread = useThreadMessages(
    api.studio.listMessages,
    threadId ? { threadId } : "skip",
    { initialNumItems: 50, stream: true },
  );
  // `useThreadMessages({ stream: true })` already yields UI-shaped messages
  // (text + parts), so they render directly — no toUIMessages() conversion.
  const messages = thread.results ?? [];
  const files = useQuery(api.files.listByVersion, { versionId: version._id }) ?? [];

  // Stick to the bottom as content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, files.length, version.status]);

  async function handleSend() {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setDraft("");
    try {
      await edit({ projectId, prompt });
    } catch (err) {
      console.error(err);
      toast.error("Couldn't apply that edit.");
      setDraft(prompt);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef}>
        <div className="space-y-5 p-4">
          {messages.map((m, i) => (
            <MessageBubble key={m.key ?? i} role={m.role} text={messageText(m)} />
          ))}

          <ActivityLog files={files} status={version.status} styleName={version.styleName} />

          {version.status === "failed" && (
            <div className="rounded-xl border border-ios-red/30 bg-ios-red/10 px-3.5 py-2.5 text-sm text-ios-red">
              Generation hit a snag. Try refining your prompt below.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-2 transition-colors focus-within:border-white/20">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Make an edit…  e.g. add a dark mode toggle"
            className="px-3 py-2 text-sm"
            maxRows={5}
          />
          <div className="flex items-center justify-between px-1.5 pb-0.5">
            <span className="text-xs text-muted-foreground/60">⏎ to send · ⇧⏎ for newline</span>
            <Button size="icon-sm" onClick={handleSend} disabled={!draft.trim() || busy} aria-label="Send">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, text }: { role: string; text: string }) {
  if (!text.trim()) return null;
  const isUser = role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2.5", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
          <InterstellarMark className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-white/[0.08] text-foreground"
            : "border border-white/10 bg-white/[0.04] text-foreground/90",
        )}
      >
        {isUser ? text : <Markdown text={text} />}
      </div>
    </motion.div>
  );
}
