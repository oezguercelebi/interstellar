"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

/** Animated pill segmented control with a sliding active indicator. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "default",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "default";
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5 backdrop-blur-md",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
              size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-[13px]",
              active ? "text-primary-foreground" : "text-foreground/60 hover:text-foreground/90",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-primary shadow-stellar-sm"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
