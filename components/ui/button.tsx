"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-stellar-sm hover:brightness-110",
        gradient:
          "bg-stellar text-white shadow-stellar-sm hover:bg-stellar-hot",
        glass:
          "border border-white/10 bg-white/[0.06] text-foreground backdrop-blur-md hover:bg-white/[0.10]",
        outline:
          "border border-white/15 bg-transparent text-foreground hover:bg-white/[0.06]",
        ghost: "text-foreground/80 hover:bg-white/[0.06] hover:text-foreground",
        subtle: "bg-secondary text-secondary-foreground hover:brightness-110",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-full px-3.5 text-[13px]",
        default: "h-10 rounded-full px-5 text-sm",
        lg: "h-12 rounded-full px-7 text-[15px]",
        icon: "h-9 w-9 rounded-full",
        "icon-sm": "h-8 w-8 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
