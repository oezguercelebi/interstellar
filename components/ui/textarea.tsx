"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with content up to maxRows. */
  autoResize?: boolean;
  maxRows?: number;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize = true, maxRows = 8, onInput, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const resize = React.useCallback(
      (el: HTMLTextAreaElement) => {
        if (!autoResize) return;
        el.style.height = "auto";
        const lineHeight = parseInt(getComputedStyle(el).lineHeight || "24", 10);
        const max = lineHeight * maxRows;
        el.style.height = `${Math.min(el.scrollHeight, max)}px`;
        el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
      },
      [autoResize, maxRows],
    );

    React.useEffect(() => {
      if (innerRef.current) resize(innerRef.current);
    }, [resize, props.value]);

    return (
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={1}
        onInput={(e) => {
          resize(e.currentTarget);
          onInput?.(e);
        }}
        className={cn(
          "w-full resize-none bg-transparent text-[15px] leading-6 text-foreground placeholder:text-muted-foreground/70 focus:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
