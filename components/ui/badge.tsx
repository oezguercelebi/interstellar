import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-white/[0.06] text-foreground/80",
        stellar: "border-stellar/30 bg-stellar/15 text-stellar",
        green: "border-ios-green/30 bg-ios-green/15 text-ios-green",
        blue: "border-ios-blue/30 bg-ios-blue/15 text-ios-blue",
        purple: "border-ios-purple/30 bg-ios-purple/15 text-ios-purple",
        orange: "border-ios-orange/30 bg-ios-orange/15 text-ios-orange",
        red: "border-ios-red/30 bg-ios-red/15 text-ios-red",
        outline: "border-white/15 text-foreground/70",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
