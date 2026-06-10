/**
 * The narrow waist between Interstellar and a sandbox platform.
 *
 * A provider's whole job: take the generated source files, boot a machine that
 * serves the Expo app on a public URL, and hand back that URL. Everything else
 * (how machines are created, how files get in, which dev server runs) is the
 * provider's private business — Daytona today; Modal/E2B/Fly are PRs away.
 *
 * Note: the same-origin preview proxy at app/api/preview/[id]/[[...path]] is
 * part of the *Daytona* integration (it strips Daytona's preview-warning
 * interstitial). The studio only routes through it when a version's
 * sandboxProvider is "daytona" — any other provider's previewUrl is embedded
 * directly, so a new provider just needs a URL that renders inside an iframe.
 */

/** A generated source file to materialize into the sandbox. */
export interface AppFile {
  path: string; // repo-relative, e.g. "app/index.tsx"
  contents: string;
}

export interface ProvisionResult {
  sandboxId: string;
  previewUrl: string;
}

/** Result of a sandboxed command execution. */
export interface ExecResult {
  exitCode: number;
  /** Combined stdout (and stderr, depending on the provider). */
  output: string;
}

export interface SandboxProvider {
  /** Stored on versions.sandboxProvider; the UI keys proxy behavior off it. */
  readonly name: string;

  /**
   * Create a sandbox, materialize `files` into an Expo project, start the web
   * dev server, and return the public preview URL. Throw on failure — the
   * caller records the error on the version.
   */
  provision(files: AppFile[]): Promise<ProvisionResult>;

  /**
   * Execute a shell command inside an existing sandbox.
   * Optional — providers that don't implement this return undefined.
   * timeoutSeconds is in seconds (Daytona SDK convention).
   */
  exec?(
    sandboxId: string,
    command: string,
    opts?: { cwd?: string; timeoutSeconds?: number },
  ): Promise<ExecResult>;

  /**
   * Upload (or overwrite) a set of files into an existing sandbox.
   * Optional — providers that don't implement this return undefined.
   */
  uploadFiles?(sandboxId: string, files: AppFile[], projectRoot: string): Promise<void>;
}
