"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProvider } from "convex/react";

// In live mode this is set by `npx convex dev`. The placeholder keeps the
// provider valid during `next build` / demo so the UI always renders.
const url = process.env.NEXT_PUBLIC_CONVEX_URL || "https://placeholder.convex.cloud";

if (!process.env.NEXT_PUBLIC_CONVEX_URL && typeof window !== "undefined") {
  console.warn(
    "[interstellar] NEXT_PUBLIC_CONVEX_URL is not set — run `npx convex dev` to connect the backend.",
  );
}

const convex = new ConvexReactClient(url);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
