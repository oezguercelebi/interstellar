"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Cpu, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MODEL_OPTIONS,
  EFFORT_OPTIONS,
  supportsEffort,
  modelName,
  type ModelId,
  type Effort,
} from "@/lib/models";
import { Segmented } from "@/components/ui/segmented";

/**
 * Compact model + effort selector for the composer. A popover lists the three
 * tiers with cost cues; the effort row appears only when Opus is selected
 * (it's the only model with adaptive-thinking effort).
 */
export function ModelPicker({
  model,
  effort,
  onModelChange,
  onEffortChange,
  disabled,
}: {
  model: ModelId;
  effort: Effort;
  onModelChange: (m: ModelId) => void;
  onEffortChange: (e: Effort) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = MODEL_OPTIONS.find((m) => m.id === model);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-foreground/80 transition-colors hover:border-stellar/40 hover:text-foreground disabled:opacity-50",
        )}
      >
        <Cpu className="h-3.5 w-3.5 text-stellar" />
        {modelName(model)}
        <span className="text-muted-foreground/70">{current?.cost}</span>
        {supportsEffort(model) && (
          <span className="text-muted-foreground/60">· {effort}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-border bg-card p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.25)]">
          {MODEL_OPTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onModelChange(m.id);
                if (!supportsEffort(m.id)) setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted",
                m.id === model && "bg-muted",
              )}
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {m.id === model && <Check className="h-4 w-4 text-stellar" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">{m.name}</span>
                  <span className="text-xs text-muted-foreground/70">{m.cost}</span>
                </span>
                <span className="block text-xs leading-snug text-muted-foreground">{m.blurb}</span>
              </span>
            </button>
          ))}

          {supportsEffort(model) && (
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-3 pb-1 pt-2.5">
              <span className="text-xs font-medium text-muted-foreground">Thinking effort</span>
              <Segmented
                size="sm"
                value={effort}
                onChange={(e) => onEffortChange(e as Effort)}
                options={EFFORT_OPTIONS.map((e) => ({ value: e.id, label: e.label }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
