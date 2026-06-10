/**
 * Sandbox provider selection. Exactly one implementation ships today.
 *
 * To add another platform (Modal, E2B, Fly, local Docker):
 *   1. Implement SandboxProvider in a sibling file (see types.ts for the contract).
 *   2. Return it from here based on its credential env var.
 * The studio UI needs no changes — any provider whose previewUrl renders in an
 * iframe works out of the box (only Daytona URLs route through the proxy).
 */
import { DaytonaProvider } from "./daytona";
import type { SandboxProvider } from "./types";

export type { AppFile, ProvisionResult, SandboxProvider } from "./types";

/** The configured provider, or null when no sandbox credentials are set. */
export function getSandboxProvider(): SandboxProvider | null {
  if (process.env.DAYTONA_API_KEY) return new DaytonaProvider();
  return null;
}
