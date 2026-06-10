"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS, themeOption } from "@/lib/themes";

/** Swatch dot — a gradient when the theme defines two stops, else a solid. */
function Swatch({ a, b, className }: { a: string; b?: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10", className)}
      style={b ? { backgroundImage: `linear-gradient(135deg, ${a}, ${b})` } : { backgroundColor: a }}
    />
  );
}

/**
 * Compact theme selector for the composer. Mirrors ModelPicker — a popover with
 * the design identities; "Auto" lets the agent invent a palette per concept.
 */
export function ThemePicker({
  theme,
  onThemeChange,
  disabled,
}: {
  theme: string;
  onThemeChange: (t: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = themeOption(theme);

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
        {theme === "auto" ? (
          <Palette className="h-3.5 w-3.5 text-stellar" />
        ) : (
          <Swatch a={current.swatch} b={current.swatch2} />
        )}
        {current.name}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-border bg-card p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.25)]">
          {THEME_OPTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onThemeChange(t.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted",
                t.id === theme && "bg-muted",
              )}
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                {t.id === theme && <Check className="h-4 w-4 text-stellar" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <Swatch a={t.swatch} b={t.swatch2} />
                  <span className="text-sm font-semibold text-foreground">{t.name}</span>
                </span>
                <span className="block text-xs leading-snug text-muted-foreground">{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
