"use node";

/**
 * Daytona implementation of SandboxProvider.
 *
 * Fast path (primary): if DAYTONA_SNAPSHOT is set, create a sandbox from the
 * pre-baked snapshot (e.g. "interstellar-studio-nw1", built by
 * scripts/bake-snapshot.mjs — node_modules already installed), upload the
 * generated source files, start Metro web, and return the preview URL.
 * Expected provision time: ~30-90s.
 *
 * Snapshot layout: SANDBOX_APP_ROOT (returned by getWorkDir()), with a
 * ROOT app/ directory as the Expo Router root — exactly what bake-snapshot.mjs
 * builds. Generated files (app/, components/, store/, theme/, lib/) upload 1:1
 * to the project root, replacing the snapshot's placeholder screens; baked
 * root config files (tailwind.config.js, global.css, babel/metro config,
 * nativewind-env.d.ts) are never touched.
 *
 * Cold fallback: if DAYTONA_SNAPSHOT is not set, scaffold a fresh Expo Router
 * app with create-expo-app (slower, ~3-5 min, risks timeouts). Classic kit
 * only — NativeWind is never retrofitted into the cold path (provision throws
 * immediately instead).
 *
 * NOTE on SDK conventions:
 *   - executeCommand(cmd, cwd, env, timeout) timeout is in SECONDS.
 *   - getPreviewLink() returns { url, token, legacyProxyUrl }; with public:true
 *     the url is reachable without the token.
 *
 * NOTE on file uploads:
 *   The Daytona SDK's uploadFiles() requires the npm `form-data` module which is
 *   not bundled in Convex's Node runtime. We use the Daytona toolbox REST API
 *   directly with native fetch + FormData instead.
 *
 * This module imports the Daytona SDK (Node-only) — import it only from
 * "use node" actions (convex/preview.ts).
 */
import { Daytona } from "@daytonaio/sdk";
import { SANDBOX_APP_ROOT } from "./types";
import type { AppFile, ExecResult, ProvisionOpts, ProvisionResult, SandboxProvider } from "./types";

const PREVIEW_PORT = 8081;

// ── Shared upload helper ─────────────────────────────────────────────────────

/**
 * Upload files into a running Daytona sandbox via the toolbox REST API using
 * the base64-sidecar strategy (see module-level comment for why).
 * `toolboxBase` is `<toolboxProxyUrl>/<sandboxId>`.
 */
async function uploadFilesViaToolbox(
  sandbox: { process: { executeCommand: (cmd: string, cwd?: string, env?: Record<string, string>, timeout?: number) => Promise<unknown> } },
  toolboxBase: string,
  authHeader: string,
  proj: string,
  files: AppFile[],
): Promise<void> {
  for (const f of files) {
    const destPath = `${proj}/${f.path}`;
    const b64 = Buffer.from(f.contents, "utf8").toString("base64");
    const form = new FormData();
    form.append("file", new Blob([b64], { type: "text/plain" }), `${f.path}.b64`);
    const uploadUrl = `${toolboxBase}/files/upload?path=${encodeURIComponent(`${destPath}.b64`)}`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: authHeader },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`File upload failed for ${f.path}: ${res.status} ${await res.text()}`);
    }
  }

  // Decode every *.b64 back to its real file, then remove sidecars.
  await (sandbox.process.executeCommand as (cmd: string, cwd?: string, env?: Record<string, string>, timeout?: number) => Promise<unknown>)(
    `cd ${proj} && find . -name '*.b64' -print0 | while IFS= read -r -d '' b; do base64 --decode "$b" > "${"${b%.b64}"}" && rm -f "$b"; done ; echo decoded`,
    proj,
    undefined,
    60,
  );
}

export class DaytonaProvider implements SandboxProvider {
  readonly name = "daytona";

  async provision(files: AppFile[], opts?: ProvisionOpts): Promise<ProvisionResult> {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) throw new Error("DAYTONA_API_KEY is not set");
    const snapshotName = process.env.DAYTONA_SNAPSHOT;
    const target = process.env.DAYTONA_TARGET; // e.g. "eu" — required for custom snapshots
    const kit = opts?.kit ?? "classic";

    // NativeWind apps require the pre-baked snapshot (babel/metro/tailwind
    // config + node_modules are baked, never retrofitted into the cold path).
    // Throw before creating anything so the caller records an actionable error
    // instead of a 3-minute scaffold followed by a Metro resolve failure.
    if (kit === "nativewind" && !snapshotName) {
      throw new Error(
        "NativeWind starter requires the pre-baked snapshot; set DAYTONA_SNAPSHOT or unset STARTER_KIT",
      );
    }

    const daytona = new Daytona({ apiKey, apiUrl: process.env.DAYTONA_API_URL });

    // ── CREATE SANDBOX ──────────────────────────────────────────────────────
    // Fast path: from the pre-baked snapshot (node_modules already present).
    // Cold fallback: default snapshot (has node/npm, but needs create-expo-app).
    // Pass target when set — required for custom snapshots to hit the right runner pool.
    const createParams = snapshotName
      ? { snapshot: snapshotName, public: true, autoStopInterval: 30, ...(target ? { target } : {}) }
      : { public: true, autoStopInterval: 30, ...(target ? { target } : {}) };

    const sandbox = await daytona.create(createParams, { timeout: 120 });

    // ── RESOLVE PROJECT PATH ─────────────────────────────────────────────────
    // getWorkDir() returns the Expo project root (e.g. SANDBOX_APP_ROOT).
    // getUserRootDir() may return /root (connected as root) which is WRONG for
    // this snapshot where the actual user is `daytona` and the project lives at
    // SANDBOX_APP_ROOT.
    const proj = (await sandbox.getWorkDir()) ?? SANDBOX_APP_ROOT;

    // ── KIT/SNAPSHOT FAIL-FAST GUARD ─────────────────────────────────────────
    // A nativewind app on a snapshot without nativewind serves an HTTP-200
    // Metro error overlay that waitForReady cannot distinguish from a healthy
    // app (then burns a tsc-repair pass on unfixable config errors). Fail here,
    // BEFORE upload/Metro, with an actionable message instead.
    if (kit === "nativewind") {
      const probe = await sandbox.process.executeCommand(
        "test -d node_modules/nativewind && echo present || echo absent",
        proj,
        undefined,
        10,
      );
      const out = probe.result ?? probe.artifacts?.stdout ?? "";
      if (!String(out).includes("present")) {
        throw new Error(
          "snapshot lacks nativewind — re-bake (interstellar-studio-nw1) or unset STARTER_KIT",
        );
      }
    }

    // ── SCAFFOLD (cold path only) ───────────────────────────────────────────
    if (!snapshotName) {
      // No pre-baked snapshot: run create-expo-app inline.
      // Warning: this takes ~3-5 minutes and may hit Convex action limits.
      const parent = proj.substring(0, proj.lastIndexOf("/"));
      const dirName = proj.substring(proj.lastIndexOf("/") + 1);
      const extraPackages = [
        "expo-linear-gradient",
        "expo-haptics",
        "expo-blur",
        "expo-image",
        "expo-font",
        "expo-constants",
        "expo-system-ui",
        "@expo/vector-icons",
        "react-native-reanimated",
      ].join(" ");

      await sandbox.process.executeCommand(
        `npx --yes create-expo-app@latest ${dirName} --template default`,
        parent,
        undefined,
        300, // 5 min in seconds
      );
      await sandbox.process.executeCommand(
        `npx expo install react-dom react-native-web @expo/metro-runtime ${extraPackages}`,
        proj,
        undefined,
        300, // 5 min in seconds
      );
      await sandbox.process.executeCommand(
        `rm -rf app components constants hooks scripts`,
        proj,
        undefined,
        30,
      );
    } else {
      // Snapshot path: the baked snapshot uses a ROOT app/ Expo Router layout
      // (see scripts/bake-snapshot.mjs). Remove the placeholder screens and any
      // previously generated source dirs (app/ components/ store/ theme/ lib/)
      // — including a legacy src/ tree — keeping node_modules, assets, and
      // root project config files (incl. the baked NativeWind config) intact.
      await sandbox.process.executeCommand(
        `rm -rf app components store theme lib src`,
        proj,
        undefined,
        30,
      );
    }

    // ── UPLOAD GENERATED FILES ───────────────────────────────────────────────
    // Endpoint: POST <toolboxProxyUrl>/<sandboxId>/files/upload?path=<destination>
    //
    // Generated paths map 1:1 onto the project root (the snapshot's Expo Router
    // root is ./app, matching what bake-snapshot.mjs builds).
    const toolboxBase = `${(sandbox as unknown as { toolboxProxyUrl: string }).toolboxProxyUrl}/${sandbox.id}`;
    const authHeader = `Bearer ${apiKey}`;

    // We upload each file's contents as BASE64 (pure 7-bit ASCII) to a sibling
    // `<path>.b64` file, then decode it byte-exact inside the sandbox with
    // `base64 -d`. Uploading raw UTF-8 through the multipart endpoint mangles
    // multibyte characters (emoji, middle-dots) into mojibake; base64 is immune
    // to any charset/locale handling along the way, so emoji survive intact.
    await uploadFilesViaToolbox(sandbox, toolboxBase, authHeader, proj, files);

    // ── START METRO (detached) ───────────────────────────────────────────────
    // Run Metro (Expo web dev server) in a background subshell; it keeps hot
    // reload working. We use the local expo binary (already installed in the
    // snapshot's node_modules) so there's no npx download delay. The outer
    // command sleeps 5s (so Metro can bind its port) then exits, letting
    // executeCommand return while Metro keeps running.
    await sandbox.process.executeCommand(
      `(CI=1 EXPO_NO_TELEMETRY=1 nohup ./node_modules/.bin/expo start --web --port ${PREVIEW_PORT} < /dev/null > /tmp/expo.log 2>&1 &) ; sleep 5 ; echo metro-launched`,
      proj,
      undefined,
      60, // 60s for the launch + sleep 5
    );

    // ── GET PREVIEW URL ──────────────────────────────────────────────────────
    const preview = await sandbox.getPreviewLink(PREVIEW_PORT);
    const url = typeof preview === "string" ? preview : preview.url;

    return { sandboxId: sandbox.id, previewUrl: url };
  }

  /**
   * Execute a shell command in an existing Daytona sandbox.
   * Reattaches to the sandbox by ID via `daytona.get(sandboxId)`.
   * timeoutSeconds is forwarded to executeCommand (Daytona SDK uses seconds).
   */
  async exec(
    sandboxId: string,
    command: string,
    opts?: { cwd?: string; timeoutSeconds?: number },
  ): Promise<ExecResult> {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) throw new Error("DAYTONA_API_KEY is not set");
    const daytona = new Daytona({ apiKey, apiUrl: process.env.DAYTONA_API_URL });
    const sandbox = await daytona.get(sandboxId);
    const resp = await sandbox.process.executeCommand(
      command,
      opts?.cwd,
      undefined,
      opts?.timeoutSeconds,
    );
    return {
      exitCode: resp.exitCode,
      output: resp.result ?? resp.artifacts?.stdout ?? "",
    };
  }

  /**
   * Upload files into an existing Daytona sandbox, decoding them in-place.
   * Uses the same base64-sidecar strategy as provision().
   */
  async uploadFiles(sandboxId: string, files: AppFile[], projectRoot: string): Promise<void> {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) throw new Error("DAYTONA_API_KEY is not set");
    const daytona = new Daytona({ apiKey, apiUrl: process.env.DAYTONA_API_URL });
    const sandbox = await daytona.get(sandboxId);
    const toolboxBase = `${(sandbox as unknown as { toolboxProxyUrl: string }).toolboxProxyUrl}/${sandbox.id}`;
    const authHeader = `Bearer ${apiKey}`;
    await uploadFilesViaToolbox(sandbox, toolboxBase, authHeader, projectRoot, files);
  }
}
