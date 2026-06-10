"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ArrowLeft, Cpu } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { modelName } from "@/lib/models";
import { InterstellarWordmark } from "@/components/InterstellarMark";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChatRail } from "./ChatRail";
import { PreviewStage } from "./PreviewStage";
import { VersionTabs } from "./VersionTabs";

export function StudioShell({ projectId }: { projectId: Id<"projects"> }) {
  const data = useQuery(api.projects.get, { projectId });
  const [selectedId, setSelectedId] = useState<Id<"versions"> | null>(null);

  const versions: Doc<"versions">[] = data?.versions ?? [];
  const activeId =
    data?.project.activeVersionId ?? versions[versions.length - 1]?._id ?? null;

  const selected = useMemo(
    () => versions.find((v) => v._id === (selectedId ?? activeId)) ?? versions[0] ?? null,
    [versions, selectedId, activeId],
  );

  useEffect(() => {
    if (!selectedId && activeId) setSelectedId(activeId);
  }, [activeId, selectedId]);

  if (data === undefined) return <StudioSkeleton />;
  if (data === null) return <NotFound />;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <Link href="/" aria-label="Home" className="shrink-0">
          <InterstellarWordmark />
        </Link>
        <div className="h-5 w-px bg-white/10" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
          {data.project.title}
        </p>
        {selected && (
          <span
            className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-foreground/60 sm:inline-flex"
            title="Model locked for this build (change per build from the home composer)"
          >
            <Cpu className="h-3 w-3 text-stellar" />
            {modelName(selected.model)}
            {selected.effort ? ` · ${selected.effort}` : ""}
          </span>
        )}
        <VersionTabs
          versions={versions}
          selectedId={selected?._id ?? null}
          onSelect={setSelectedId}
        />
      </header>

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <Panel defaultSize={38} minSize={28} className="flex min-w-0 flex-col">
          {selected && <ChatRail version={selected} projectId={projectId} />}
        </Panel>
        <PanelResizeHandle className="w-px bg-white/10 outline-none transition-colors hover:bg-stellar/40 data-[resize-handle-state=drag]:bg-stellar/60" />
        <Panel defaultSize={62} minSize={40} className="flex min-w-0 flex-col bg-[#0c0c0c]">
          {selected && <PreviewStage version={selected} />}
        </Panel>
      </PanelGroup>
    </div>
  );
}

function StudioSkeleton() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
        <InterstellarWordmark />
      </header>
      <div className="flex flex-1">
        <div className="w-[38%] space-y-4 border-r border-white/10 p-6">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-10 w-2/3 rounded-xl" />
          <Skeleton className="h-10 w-1/2 rounded-xl" />
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#0c0c0c]">
          <Skeleton className="h-[640px] w-[300px] rounded-[3rem]" />
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="text-lg font-medium">This project doesn&apos;t exist.</p>
      <Button asChild variant="glass">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> Back to Interstellar
        </Link>
      </Button>
    </div>
  );
}
