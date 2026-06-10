"use client";

import { useEffect, useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { FileCode2 } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function langFor(path: string) {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "jsx";
  return "tsx";
}

export function CodeView({ files }: { files: Doc<"files">[] }) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const [active, setActive] = useState<string | null>(null);
  const current = sorted.find((f) => f.path === active) ?? sorted[0];

  useEffect(() => {
    if (!active && sorted.length) setActive(sorted[0].path);
  }, [active, sorted]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
        No files yet.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* file list */}
      <div className="w-56 shrink-0 border-r border-white/10">
        <ScrollArea className="h-full">
          <div className="p-2">
            {sorted.map((f) => (
              <button
                key={f._id}
                onClick={() => setActive(f.path)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  current?.path === f.path
                    ? "bg-white/[0.08] text-foreground"
                    : "text-foreground/60 hover:bg-white/[0.04] hover:text-foreground/90",
                )}
              >
                <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate font-mono">{f.path}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* code */}
      <ScrollArea className="min-w-0 flex-1">
        {current && (
          <Highlight theme={themes.vsDark} code={current.contents} language={langFor(current.path)}>
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={cn(className, "min-h-full !bg-transparent p-4 text-[12.5px] leading-[1.6]")}
                style={{ ...style, background: "transparent" }}
              >
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })} className="table-row">
                    <span className="table-cell select-none pr-4 text-right text-white/20">{i + 1}</span>
                    <span className="table-cell">
                      {line.map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </span>
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        )}
      </ScrollArea>
    </div>
  );
}
