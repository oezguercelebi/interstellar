"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, Cpu, Clock, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { modelName } from "@/lib/models";
import { timeAgo, cn } from "@/lib/utils";

/**
 * Build history gallery — every past project as a card you can click to resume.
 *
 * We deliberately do NOT embed the live sandbox in the thumbnail: sandboxes are
 * ephemeral (they auto-stop when idle and are later deleted), so an embedded
 * iframe would show Daytona's warning page or a 404 for older builds. Instead we
 * render a branded gradient tile (deterministic per title) — instant, always
 * clean — and the studio re-opens the real preview on click.
 */

// Flat mission-panel tiles; pick deterministically from the title. No gradients.
const TILES = [
  "bg-[#16181B]",
  "bg-[#1C2A3A]",
  "bg-[#2A3B2E]",
  "bg-[#3D2B25]",
  "bg-[#2E3440]",
  "bg-[#4A4334]",
];
function tileFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length];
}

export function BuildHistory() {
  const projects = useQuery(api.projects.list, {});
  if (projects === undefined || projects.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.5 }}
      className="mx-auto mt-20 w-full max-w-5xl px-6 pb-24"
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 className="telemetry text-muted-foreground">Your builds</h2>
        <span className="font-mono text-[11px] text-muted-foreground/60">{projects.length} total</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {projects.map((p) => {
          const building = p.status === "generating" || p.status === "pending";
          const failed = p.status === "failed";
          return (
            <Link
              key={p._id}
              href={`/studio/${p._id}`}
              className="group relative block overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-stellar/50 hover:shadow-lg"
            >
              {/* Full phone-aspect preview: the screenshot fills the card (no crop),
                  with the title + meta overlaid on a frosted bar at the bottom. */}
              <div className="relative aspect-[390/844] w-full overflow-hidden bg-white">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail}
                    alt={p.title}
                    className="absolute inset-0 h-full w-full object-cover object-top"
                  />
                ) : (
                  <>
                    <div className={cn("absolute inset-0", tileFor(p.title))} />
                    <div className="absolute inset-0 bg-grid opacity-30" />
                    <div className="absolute left-1/2 top-[38%] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06]">
                      {building ? (
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      ) : failed ? (
                        <AlertCircle className="h-7 w-7 text-white/90" />
                      ) : (
                        <span className="font-serif text-3xl text-white/90">
                          {(p.title.trim()[0] || "I").toUpperCase()}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* status / hover chips */}
                <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/25 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                  <ArrowUpRight className="h-3.5 w-3.5 text-white" />
                </span>
                {building && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    building…
                  </span>
                )}
                {failed && (
                  <span className="absolute left-2 top-2 rounded-full bg-ios-red/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    failed
                  </span>
                )}

                {/* overlaid metadata bar */}
                <div className="absolute inset-x-0 bottom-0 border-t border-black/5 bg-white/85 px-3 py-2.5 backdrop-blur-md">
                  <p className="truncate text-[13px] font-semibold text-foreground">{p.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
                    <span className="inline-flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      {modelName(p.model)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeAgo(p.createdAt)}
                    </span>
                    {p.versionCount > 1 && <span>· v{p.versionCount}</span>}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </motion.section>
  );
}
