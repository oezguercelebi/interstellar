"use client";

import * as React from "react";
import { Signal, Wifi, BatteryFull } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A photoreal iPhone frame — the hero canvas of the studio.
 * Titanium rail, Dynamic Island, auto-contrast status bar (mix-blend), home indicator.
 * The screen area renders any children (live preview iframe, skeleton, boot screen).
 */
export function DeviceFrame({
  children,
  className,
  statusBar = true,
  time = "9:41",
}: {
  children?: React.ReactNode;
  className?: string;
  statusBar?: boolean;
  time?: string;
}) {
  return (
    <div className={cn("relative aspect-[393/852] select-none", className)}>
      {/* side buttons on the titanium rail */}
      <div className="absolute -left-[2.5px] top-[18%] h-7 w-[2.5px] rounded-l bg-zinc-700" />
      <div className="absolute -left-[2.5px] top-[27%] h-12 w-[2.5px] rounded-l bg-zinc-700" />
      <div className="absolute -left-[2.5px] top-[39%] h-12 w-[2.5px] rounded-l bg-zinc-700" />
      <div className="absolute -right-[2.5px] top-[31%] h-16 w-[2.5px] rounded-r bg-zinc-700" />

      {/* titanium rail → black bezel → screen */}
      <div className="h-full w-full rounded-[3.3rem] bg-gradient-to-b from-zinc-500 via-zinc-700 to-zinc-900 p-[2px] shadow-device">
        <div className="h-full w-full rounded-[3.2rem] bg-black p-[9px]">
          <div className="relative h-full w-full overflow-hidden rounded-[2.65rem] bg-black">
            {/* the live app / preview */}
            <div className="absolute inset-0">{children}</div>

            {/* Dynamic Island */}
            <div className="pointer-events-none absolute left-1/2 top-[11px] z-30 flex h-[26px] w-[31%] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
              <div className="h-[7px] w-[7px] rounded-full bg-zinc-800 ring-1 ring-zinc-700" />
            </div>

            {/* status bar — mix-blend keeps it legible on any background */}
            {statusBar && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-[46px] items-center justify-between px-7 text-white mix-blend-difference">
                <span className="text-[13px] font-semibold tracking-tight">{time}</span>
                <div className="flex items-center gap-1.5">
                  <Signal className="h-[14px] w-[14px]" strokeWidth={2.5} />
                  <Wifi className="h-[15px] w-[15px]" strokeWidth={2.5} />
                  <BatteryFull className="h-[20px] w-[20px]" strokeWidth={2} />
                </div>
              </div>
            )}

            {/* home indicator */}
            <div className="pointer-events-none absolute bottom-[8px] left-1/2 z-30 h-[5px] w-[34%] -translate-x-1/2 rounded-full bg-white mix-blend-difference" />
          </div>
        </div>
      </div>
    </div>
  );
}
