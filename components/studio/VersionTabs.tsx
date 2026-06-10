"use client";

import { motion } from "framer-motion";
import { Check, Loader2, GitBranch } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

/**
 * Version time-travel strip. Each prompt/edit/variant is a non-destructive
 * checkpoint; tap to view it live in the preview. A small status dot shows
 * whether that version is still building.
 */
export function VersionTabs({
  versions,
  selectedId,
  onSelect,
}: {
  versions: Doc<"versions">[];
  selectedId: Id<"versions"> | null;
  onSelect: (id: Id<"versions">) => void;
}) {
  if (versions.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <GitBranch className="mr-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      {versions.map((v, i) => {
        const active = v._id === selectedId;
        const building = v.status === "generating" || v.status === "pending";
        const failed = v.status === "failed";
        return (
          <Tip key={v._id} label={v.label}>
            <button
              onClick={() => onSelect(v._id)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "text-primary-foreground" : "text-foreground/60 hover:text-foreground/90",
              )}
            >
              {active && (
                <motion.span
                  layoutId="version-tab"
                  className="absolute inset-0 -z-10 rounded-full bg-primary shadow-stellar-sm"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span>v{i + 1}</span>
              {building ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : failed ? (
                <span className="h-1.5 w-1.5 rounded-full bg-ios-red" />
              ) : (
                <Check className="h-3 w-3" strokeWidth={3} />
              )}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
