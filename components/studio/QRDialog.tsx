"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QRDialog({
  open,
  onOpenChange,
  url,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/[0.14] bg-[#141414]/95 p-6 shadow-glass-lg backdrop-blur-xl focus:outline-none data-[state=open]:animate-scale-in">
          <Dialog.Title className="text-center text-base font-semibold">Open on your phone</Dialog.Title>
          <Dialog.Description className="mt-1 text-center text-sm text-muted-foreground">
            Scan to open the live app in your mobile browser.
          </Dialog.Description>
          <div className="mx-auto mt-5 w-fit rounded-2xl bg-white p-3 shadow-stellar-sm">
            {url ? (
              <QRCodeSVG value={url} size={196} />
            ) : (
              <div className="h-[196px] w-[196px] animate-pulse rounded bg-zinc-200" />
            )}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <span className="truncate font-mono text-xs text-foreground/70">{url || "—"}</span>
            <Button size="icon-sm" variant="ghost" className="ml-auto shrink-0" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="h-3.5 w-3.5 text-ios-green" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
