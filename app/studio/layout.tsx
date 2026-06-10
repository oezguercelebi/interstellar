import { TooltipProvider } from "@/components/ui/tooltip";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </div>
  );
}
