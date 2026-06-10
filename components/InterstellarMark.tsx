import { cn } from "@/lib/utils";

/**
 * The Interstellar mark — a thin orbit with a craft (solid signal dot) on the
 * path. Flat line-work, currentColor ring, no gradients: an instrument, not an
 * ornament. The ring inherits text color so it sits correctly on paper & void.
 */
export function InterstellarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-6 w-6", className)} aria-hidden>
      {/* orbit path */}
      <circle
        cx="24"
        cy="24"
        r="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.85"
      />
      {/* inner body */}
      <circle cx="24" cy="24" r="4" fill="currentColor" opacity="0.9" />
      {/* the craft, mid-orbit — the one signal */}
      <circle cx="38.5" cy="14.5" r="4.5" fill="#FF4D00" />
    </svg>
  );
}

/** Wordmark: orbit mark + INTERSTELLAR in console type. */
export function InterstellarWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <InterstellarMark className="h-5 w-5" />
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.22em]">
        Interstellar
      </span>
    </span>
  );
}
