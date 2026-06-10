"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import { ArrowUp, Loader2, Github } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { InterstellarWordmark } from "@/components/InterstellarMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/ui/segmented";
import { ModelPicker } from "@/components/ModelPicker";
import { ThemePicker } from "@/components/ThemePicker";
import { BuildHistory } from "@/components/BuildHistory";
import { DEFAULT_MODEL, DEFAULT_EFFORT, supportsEffort, type ModelId, type Effort } from "@/lib/models";
import { DEFAULT_THEME } from "@/lib/themes";
import { STARTER_PROMPTS } from "@/lib/prompts";
import { toast } from "sonner";

export default function LandingPage() {
  const router = useRouter();
  const start = useMutation(api.projects.start);
  const [prompt, setPrompt] = useState("");
  const [variants, setVariants] = useState<"1" | "3">("1");
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [effort, setEffort] = useState<Effort>(DEFAULT_EFFORT);
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [loading, setLoading] = useState(false);

  async function submit(text: string) {
    const idea = text.trim();
    if (!idea || loading) return;
    setLoading(true);
    try {
      const { projectId } = await start({
        prompt: idea,
        variants: Number(variants),
        model,
        effort: supportsEffort(model) ? effort : undefined,
        theme,
      });
      router.push(`/studio/${projectId}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't start — is Convex running? Try `npm run dev:all`.");
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* star-chart backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light opacity-70 [mask-image:radial-gradient(65%_55%_at_50%_0%,black,transparent)]" />

      {/* decorative orbit — one thin path with a craft, echoing the mark */}
      <svg
        className="pointer-events-none absolute left-1/2 top-[270px] -z-0 hidden h-[520px] w-[1400px] -translate-x-1/2 sm:block"
        viewBox="0 0 1400 520"
        fill="none"
        aria-hidden
      >
        <ellipse cx="700" cy="260" rx="660" ry="210" stroke="currentColor" strokeWidth="1" opacity="0.1" />
        <circle cx="180" cy="120" r="5" fill="#FF4D00" />
      </svg>

      {/* nav */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <InterstellarWordmark />
        <div className="flex items-center gap-3">
          <span className="telemetry hidden text-muted-foreground sm:inline">
            Expo · Convex · Claude
          </span>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href="https://github.com/oezguercelebi/interstellar" target="_blank" rel="noreferrer" aria-label="GitHub">
              <Github className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </nav>

      <section className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pt-16 text-center sm:pt-24">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <span className="telemetry mb-8 inline-flex items-center gap-2 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-stellar" />
            3 design variations · in parallel
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="text-balance font-serif text-6xl leading-[1.04] tracking-tight sm:text-7xl"
        >
          Make your ideas <em className="text-stellar">orbit</em>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="mt-6 max-w-xl text-balance text-lg text-muted-foreground"
        >
          Describe an app. Watch an AI agent build a real, beautifully-designed
          native Expo app — live, on an iPhone.
        </motion.p>

        {/* composer */}
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit(prompt);
          }}
          className="mt-12 w-full"
        >
          <div className="rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(20,22,27,0.05),0_16px_48px_-20px_rgba(20,22,27,0.18)] transition-colors focus-within:border-stellar/50">
            <Textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(prompt);
                }
              }}
              placeholder="Describe the app you want to build…  e.g. a meditation app with a breathing timer"
              className="px-4 py-3 text-foreground placeholder:text-muted-foreground/60"
              maxRows={6}
            />
            <div className="flex items-center justify-between gap-3 px-1.5 pb-1">
              <div className="flex items-center gap-2">
                <Segmented
                  value={variants}
                  onChange={(v) => setVariants(v)}
                  options={[
                    { value: "1", label: "1 design" },
                    { value: "3", label: "3 variations" },
                  ]}
                />
                <ModelPicker
                  model={model}
                  effort={effort}
                  onModelChange={setModel}
                  onEffortChange={setEffort}
                  disabled={loading}
                />
                <ThemePicker theme={theme} onThemeChange={setTheme} disabled={loading} />
              </div>
              <Button type="submit" disabled={!prompt.trim() || loading} className="px-5">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Build
                    <ArrowUp className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.form>

        {/* starter prompts — numbered like a checklist, not emoji chips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.32 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-2"
        >
          {STARTER_PROMPTS.map((p, i) => (
            <button
              key={p.title}
              type="button"
              disabled={loading}
              onClick={() => {
                setPrompt(p.prompt);
                submit(p.prompt);
              }}
              className="group inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground/80 transition-colors hover:border-stellar/50 hover:text-foreground disabled:opacity-50"
            >
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground/60 transition-colors group-hover:text-stellar">
                {String(i + 1).padStart(2, "0")}
              </span>
              {p.title}
            </button>
          ))}
        </motion.div>

        <p className="telemetry mt-16 text-muted-foreground/70">
          idea → live native app · no setup · no simulator
        </p>
      </section>

      <BuildHistory />
    </main>
  );
}
