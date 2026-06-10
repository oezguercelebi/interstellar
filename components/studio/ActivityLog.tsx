"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Component, FileCode2, LayoutGrid, Palette, Sparkles } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

function fileIcon(path: string) {
  if (path.includes("theme/")) return Palette;
  if (path.includes("_layout")) return LayoutGrid;
  if (path.includes("components/")) return Component;
  return FileCode2;
}

export function ActivityLog({
  files,
  status,
  styleName,
}: {
  files: Doc<"files">[];
  status: string;
  styleName?: string;
}) {
  if (files.length === 0 && status !== "generating" && status !== "pending") return null;

  const ordered = [...files].sort((a, b) => a.updatedAt - b.updatedAt);
  const building = status === "generating" || status === "pending";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        {building ? (
          <span className="flex gap-1" aria-hidden>
            <Dot delay={0} /> <Dot delay={0.15} /> <Dot delay={0.3} />
          </span>
        ) : (
          <Sparkles className="h-4 w-4 text-stellar" />
        )}
        <span className="text-sm font-medium">
          {building
            ? `Building ${styleName ?? "your app"}…`
            : `Built ${styleName ?? "your app"}`}
        </span>
        {ordered.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground/60">
            {ordered.length} file{ordered.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <AnimatePresence initial={false}>
          {ordered.map((f) => {
            const Icon = fileIcon(f.path);
            return (
              <motion.div
                key={f._id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm"
              >
                <Icon className="h-4 w-4 shrink-0 text-foreground/50" />
                <span className="shrink-0 font-medium text-foreground/90">{f.purpose}</span>
                <code className="truncate font-mono text-xs text-muted-foreground/60">
                  {f.path}
                </code>
                <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ios-green/15">
                  <Check className="h-3 w-3 text-ios-green" strokeWidth={3} />
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <motion.span
      className={cn("inline-block h-1.5 w-1.5 rounded-full bg-stellar")}
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ duration: 1.2, repeat: Infinity, delay }}
    />
  );
}
