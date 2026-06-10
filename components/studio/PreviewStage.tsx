"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import html2canvas from "html2canvas";
import { Code2, ExternalLink, QrCode, RefreshCw, RotateCw, Smartphone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { isPreviewStale, proxyUrlOf, THUMBNAIL_MAX_BYTES } from "@/lib/previewContract";
import { DeviceFrame } from "@/components/DeviceFrame";
import { InterstellarMark } from "@/components/InterstellarMark";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { CodeView } from "./CodeView";
import { QRDialog } from "./QRDialog";
import { toast } from "sonner";

type View = "preview" | "code";

export function PreviewStage({ version }: { version: Doc<"versions"> }) {
  const [view, setView] = useState<View>("preview");
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const capturedRef = useRef(false);
  const files = useQuery(api.files.listByVersion, { versionId: version._id }) ?? [];
  const reopenPreview = useMutation(api.projects.reopenPreview);
  const setThumbnail = useMutation(api.projects.setThumbnail);
  // Only the first build (index 0) seeds the gallery thumbnail; skip otherwise.
  const needsThumb = useQuery(
    api.projects.needsThumbnail,
    version.index === 0 ? { projectId: version.projectId } : "skip",
  );

  const url = version.previewUrl;
  const building = version.status === "generating" || version.status === "pending";
  // Sandboxes are ephemeral (auto-stop when idle), so an older build's stored URL
  // may point at a stopped/deleted sandbox. "provisioning" = a reopen in flight.
  const provisioning = version.sandboxProvider === "provisioning" || reopening;
  // Past the 28-min trust window (lib/previewContract), the stored URL is almost
  // certainly dead — show the asleep state instead of Daytona's warning.
  const stale = isPreviewStale(version);
  // Embed through the same-origin proxy (no Daytona warning); fall back to the raw
  // URL if we can't derive a sandbox id. Don't embed a known-stale URL.
  const embedUrl = stale ? undefined : proxyUrlOf(version) ?? url;
  const canReopen = version.status === "ready" && version.sandboxProvider !== "none";

  useEffect(() => setLoaded(false), [url, nonce]);
  useEffect(() => {
    // Clear the local reopening flag once the backend swaps in a fresh URL.
    if (version.sandboxProvider === "daytona" && url) setReopening(false);
  }, [version.sandboxProvider, url]);

  // One-shot: screenshot the first build's live preview for the gallery thumbnail.
  // The proxied iframe is same-origin, so we can read its document and rasterize it.
  useEffect(() => {
    if (capturedRef.current) return;
    if (version.index !== 0 || needsThumb !== true) return;
    if (version.status !== "ready" || !loaded || stale) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    capturedRef.current = true;
    // Let entrance animations finish + fonts load, then rasterize the preview.
    const t = setTimeout(async () => {
      try {
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;
        const body = doc?.body;
        if (!doc || !win || !body) return;
        // Wait for the icon font (Ionicons etc.) so glyphs render instead of
        // empty boxes; html2canvas can't fetch fonts mid-rasterize.
        try {
          await doc.fonts?.ready;
        } catch {
          /* fonts API may be unavailable — proceed anyway */
        }
        // Capture the full phone viewport (the iframe box), not body.clientHeight
        // which RN-web can report short. Render at 2x for a crisp retina thumbnail.
        const w = iframe.clientWidth || 300;
        const h = iframe.clientHeight || 620;
        const canvas = await html2canvas(body, {
          backgroundColor: "#ffffff",
          scale: 2,
          logging: false,
          useCORS: true,
          width: w,
          height: h,
          windowWidth: w,
          windowHeight: h,
          // RN-web renders lists inside a ScrollView whose content sits in an
          // absolutely-positioned, overflow-clipped inner div — html2canvas clips
          // it to the header. In the clone, force every node's overflow visible so
          // the list + button rasterize too.
          onclone: (cloneDoc: Document) => {
            cloneDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
              if (el.style) {
                el.style.overflow = "visible";
                el.style.overflowX = "visible";
                el.style.overflowY = "visible";
              }
            });
          },
        });
        // Encode at high quality, stepping down only if needed to fit Convex's
        // ~1 MiB document cap (a stored base64 dataURL must stay well under it).
        let dataUrl = "";
        for (const q of [0.95, 0.9, 0.82, 0.7]) {
          dataUrl = canvas.toDataURL("image/jpeg", q);
          if (dataUrl.length <= THUMBNAIL_MAX_BYTES) break;
        }
        if (dataUrl.startsWith("data:image/") && dataUrl.length <= THUMBNAIL_MAX_BYTES) {
          await setThumbnail({ projectId: version.projectId, dataUrl });
        }
      } catch (err) {
        // Cross-origin taint or render hiccup — non-fatal; gallery falls back to a gradient.
        console.warn("thumbnail capture skipped", err);
      }
    }, 2600);
    return () => clearTimeout(t);
  }, [loaded, needsThumb, stale, version.index, version.status, version.projectId, setThumbnail]);

  async function handleReopen() {
    if (reopening || building) return;
    setReopening(true);
    try {
      await reopenPreview({ versionId: version._id });
      toast.success("Reopening preview — booting a fresh sandbox…");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't reopen the preview.");
      setReopening(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3">
        <Segmented
          value={view}
          onChange={(v) => setView(v)}
          size="sm"
          options={[
            { value: "preview", label: <><Smartphone className="h-3.5 w-3.5" /> Preview</> },
            { value: "code", label: <><Code2 className="h-3.5 w-3.5" /> Code</> },
          ]}
        />

        <div className="flex items-center gap-1.5">
          {canReopen && (
            <Tip label="Reopen preview (fresh sandbox)">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleReopen}
                disabled={provisioning}
                aria-label="Reopen preview"
              >
                <RotateCw className={cnSpin(provisioning)} />
              </Button>
            </Tip>
          )}
          {url && (
            <>
              <Tip label="Reload preview">
                <Button variant="ghost" size="icon-sm" onClick={() => setNonce((n) => n + 1)} aria-label="Reload">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </Tip>
              <Tip label="Open on your phone">
                <Button variant="ghost" size="icon-sm" onClick={() => setQrOpen(true)} aria-label="QR code">
                  <QrCode className="h-4 w-4" />
                </Button>
              </Tip>
              <Tip label="Open in new tab">
                <Button variant="ghost" size="icon-sm" asChild aria-label="Open in new tab">
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </Tip>
            </>
          )}
        </div>
      </div>

      {/* stage */}
      {view === "code" ? (
        <CodeView files={files} />
      ) : (
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(70%_70%_at_50%_45%,black,transparent)]" />
          {url && !provisioning && !stale && version.status === "ready" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute left-4 top-4 z-40"
            >
              <Badge variant="green" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ios-green animate-live-pulse" />
                live
              </Badge>
            </motion.div>
          )}
          {/* The phone keeps its aspect ratio and fits the pane height; on short
              screens it shrinks (max-h-full) and, if the pane is shorter than the
              minimum, the stage scrolls (overflow-y-auto) so nothing is cut off. */}
          <div className="relative h-full max-h-full min-h-[480px] shrink-0 py-2">
            <DeviceFrame className="h-full">
              <PreviewBody
                url={provisioning ? undefined : embedUrl}
                nonce={nonce}
                building={building}
                provisioning={provisioning}
                status={version.status}
                provider={version.sandboxProvider}
                loaded={loaded}
                onLoad={() => setLoaded(true)}
                onReopen={handleReopen}
                onShowCode={() => setView("code")}
                iframeRef={iframeRef}
              />
            </DeviceFrame>
          </div>
        </div>
      )}

      <QRDialog open={qrOpen} onOpenChange={setQrOpen} url={url ?? ""} />
    </div>
  );
}

function cnSpin(spinning: boolean) {
  return spinning ? "h-4 w-4 animate-spin" : "h-4 w-4";
}

function PreviewBody({
  url,
  nonce,
  building,
  provisioning,
  status,
  provider,
  loaded,
  onLoad,
  onReopen,
  onShowCode,
  iframeRef,
}: {
  url?: string;
  nonce: number;
  building: boolean;
  provisioning: boolean;
  status: string;
  provider?: string;
  loaded: boolean;
  onLoad: () => void;
  onReopen: () => void;
  onShowCode: () => void;
  iframeRef?: React.Ref<HTMLIFrameElement>;
}) {
  if (provisioning) return <BootScreen label="Reopening preview…" />;
  if (url) {
    return (
      <div className="relative h-full w-full bg-white">
        <iframe
          key={nonce}
          ref={iframeRef}
          src={url}
          title="App preview"
          className="h-full w-full border-0"
          onLoad={onLoad}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
        {!loaded && <BootScreen label="Loading preview…" />}
      </div>
    );
  }
  if (building) return <BootScreen label="Designing your app…" />;
  if (status === "ready" && !provider) return <BootScreen label="Booting Expo…" />;
  if (provider === "none")
    return (
      <FallbackScreen
        title="Live preview needs a sandbox key"
        body="Add DAYTONA_API_KEY to run this app live. Meanwhile, the full source is ready."
        onShowCode={onShowCode}
      />
    );
  // ready but no live sandbox (auto-stopped/expired) → offer a one-tap reopen.
  return (
    <FallbackScreen
      title="Preview is asleep"
      body="Sandboxes pause when idle. Reopen to boot a fresh one from your saved code — it takes ~30s."
      onReopen={onReopen}
      onShowCode={onShowCode}
    />
  );
}

function BootScreen({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-[#0A0B0D] text-center text-white/90">
      {/* CSS-driven (compositor) rotation — smoother than a JS transform loop.
          The ring is symmetric, so only the orange craft dot visibly orbits. */}
      <div className="animate-orbit-spin [will-change:transform]">
        <InterstellarMark className="h-12 w-12" />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/55">
        {label}
      </p>
    </div>
  );
}

function FallbackScreen({
  title,
  body,
  onReopen,
  onShowCode,
}: {
  title: string;
  body: string;
  onReopen?: () => void;
  onShowCode: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0A0B0D] px-8 text-center text-white/80">
      <InterstellarMark className="h-10 w-10 opacity-70" />
      <p className="font-serif text-xl text-white">{title}</p>
      <p className="text-xs leading-relaxed text-white/55">{body}</p>
      <div className="mt-1 flex items-center gap-2">
        {onReopen && (
          <Button size="sm" onClick={onReopen}>
            <RotateCw className="h-3.5 w-3.5" /> Reopen preview
          </Button>
        )}
        <Button variant="glass" size="sm" onClick={onShowCode}>
          <Code2 className="h-3.5 w-3.5" /> View code
        </Button>
      </div>
    </div>
  );
}
