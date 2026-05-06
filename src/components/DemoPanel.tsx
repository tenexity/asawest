import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown, ChevronUp, X, ArrowRight, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDemo } from "@/contexts/DemoContext";
import { DEMO_SEQUENCE, findStepIndex } from "@/lib/demo-script";

export function DemoPanel() {
  const { demoMode, setDemoMode, next } = useDemo();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [seconds, setSeconds] = useState(10 * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!demoMode) return null;

  const idx = Math.max(0, findStepIndex(pathname));
  const step = DEMO_SEQUENCE[idx];
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");

  return (
    <>
      {/* Timer top-right */}
      <div className="fixed top-16 right-4 z-50">
        <Card className="px-3 py-2 flex items-center gap-2 shadow-lg">
          <Timer className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm tabular-nums">{mm}:{ss}</span>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Start"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => { setSeconds(600); setRunning(false); }}>
            Reset
          </Button>
        </Card>
      </div>

      {/* Bottom-right script panel */}
      <Card className="fixed bottom-4 right-4 w-80 z-50 shadow-xl border-primary/40">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-primary/5">
          <div className="text-xs font-semibold uppercase tracking-wide">
            Demo · Step {idx + 1}/{DEMO_SEQUENCE.length}
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setDemoMode(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        {!collapsed && (
          <div className="p-3 space-y-2">
            <div className="text-sm font-semibold">{step.label}</div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              {step.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            <Button size="sm" className="w-full" onClick={next}>
              Next <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
            <div className="text-[10px] text-muted-foreground text-center">
              Shortcuts: D toggle · R reset · → next
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
