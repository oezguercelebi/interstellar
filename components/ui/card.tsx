import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-2xl border border-white/10 bg-card text-card-foreground", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const GlassCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-md",
        className,
      )}
      {...props}
    />
  ),
);
GlassCard.displayName = "GlassCard";

export { Card, GlassCard };
