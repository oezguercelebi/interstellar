"use client";

import { use } from "react";
import { StudioShell } from "@/components/studio/StudioShell";
import type { Id } from "@/convex/_generated/dataModel";

export default function StudioPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return <StudioShell projectId={projectId as Id<"projects">} />;
}
