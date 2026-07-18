import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { TOUR_STEPS, type TourStep } from "./tour-config";


type Props = {
  step: TourStep;
  stepIndex: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
};

type Rect = { top: number; left: number; width: number; height: number } | null;

const PAD = 8;

export function TourOverlay({ step, stepIndex, total, onNext, onPrev, onSkip }: Props) {
  const [rect, setRect] = useState<Rect>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Poll for target (route change / render latency)
  useLayoutEffect(() => {
    setRect(null);
    if (!step.target) return;
    let cancelled = false;
    let tries = 0;
    let scrolled = false;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) {
        // On first find, scroll so the target sits near the top of the
        // viewport (leaves room for the card below and prevents the card
        // from being pushed off-screen when the target is very tall).
        if (!scrolled) {
          scrolled = true;
          const r0 = el.getBoundingClientRect();
          const targetTop = 120; // px from top of viewport
          window.scrollBy({ top: r0.top - targetTop, behavior: "smooth" });
          // Re-measure after scroll settles
          setTimeout(() => {
            if (cancelled) return;
            const r1 = el.getBoundingClientRect();
            setRect({ top: r1.top, left: r1.left, width: r1.width, height: r1.height });
          }, 350);
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else if (tries++ < 40) {
        setTimeout(tick, 100);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [step.target, step.id]);

  // Track resize/scroll to keep spotlight aligned
  useEffect(() => {
    if (!step.target) return;
    const update = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.target]);

  const cardPos = placeCard(rect, viewport, step.placement);

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* SVG mask dim layer with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={onSkip}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PAD}
                y={rect.top - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(2,6,23,0.72)" mask="url(#tour-mask)" />
        {rect && (
          <rect
            x={rect.left - PAD}
            y={rect.top - PAD}
            width={rect.width + PAD * 2}
            height={rect.height + PAD * 2}
            rx="10"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            className="tour-pulse"
          />
        )}
      </svg>

      {/* Card */}
      <div
        className="absolute pointer-events-auto w-[380px] max-w-[calc(100vw-24px)] rounded-xl border bg-background shadow-2xl p-5"
        style={{ top: cardPos.top, left: cardPos.left }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            {buildStepLabel(stepIndex, total)}
          </div>

          <button onClick={onSkip} className="text-muted-foreground hover:text-foreground" aria-label="Close tour">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-lg font-semibold leading-tight mb-1">{step.title}</h3>
        <p className="text-sm text-muted-foreground mb-3">{step.body}</p>
        <div className="rounded-md border bg-muted/40 px-3 py-2 mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Why this matters</div>
          <div className="text-xs">{step.why}</div>
        </div>
        <div className="flex items-center justify-between">
          <button className="text-xs text-muted-foreground hover:underline" onClick={onSkip}>Skip tour</button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onPrev} disabled={stepIndex === 0}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
            </Button>
            <Button size="sm" onClick={onNext}>
              {stepIndex === total - 1 ? "Finish" : "Next"} <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes tour-pulse-kf {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .tour-pulse { animation: tour-pulse-kf 1.8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

function placeCard(rect: Rect, vp: { w: number; h: number }, placement?: TourStep["placement"]) {
  const CARD_W = 380;
  const CARD_H = 260;
  const M = 16;
  if (!rect || placement === "center") {
    return { top: Math.max(M, (vp.h - CARD_H) / 2), left: Math.max(M, (vp.w - CARD_W) / 2) };
  }
  // Prefer bottom, then top, then right, then left based on space
  const spaceBelow = vp.h - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const spaceRight = vp.w - (rect.left + rect.width);
  const spaceLeft = rect.left;

  let top = 0, left = 0;
  const fits = { bottom: spaceBelow >= CARD_H + M, top: spaceAbove >= CARD_H + M, right: spaceRight >= CARD_W + M, left: spaceLeft >= CARD_W + M };
  const order: Array<"bottom" | "top" | "right" | "left"> = placement
    ? [placement as any, "bottom", "top", "right", "left"]
    : ["bottom", "top", "right", "left"];
  const preferred = order.find((p) => fits[p]) ?? "bottom";

  if (preferred === "bottom") {
    top = rect.top + rect.height + M;
    left = clamp(rect.left + rect.width / 2 - CARD_W / 2, M, vp.w - CARD_W - M);
  } else if (preferred === "top") {
    top = rect.top - CARD_H - M;
    left = clamp(rect.left + rect.width / 2 - CARD_W / 2, M, vp.w - CARD_W - M);
  } else if (preferred === "right") {
    top = clamp(rect.top + rect.height / 2 - CARD_H / 2, M, vp.h - CARD_H - M);
    left = rect.left + rect.width + M;
  } else {
    top = clamp(rect.top + rect.height / 2 - CARD_H / 2, M, vp.h - CARD_H - M);
    left = rect.left - CARD_W - M;
  }
  // Final clamp so the card always stays fully inside the viewport,
  // even when the target is very large or near an edge.
  top = clamp(top, M, Math.max(M, vp.h - CARD_H - M));
  left = clamp(left, M, Math.max(M, vp.w - CARD_W - M));
  return { top, left };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// "Tour · Step 3a of 8" — a/b/c letters when a major step has sub-steps.
function buildStepLabel(index: number, _total: number) {
  const step = TOUR_STEPS[index];
  const groupIds = Array.from(new Set(TOUR_STEPS.map((s) => s.group)));
  const groupTotal = groupIds.length;
  const sameGroup = TOUR_STEPS.filter((s) => s.group === step.group);
  const posInGroup = sameGroup.findIndex((s) => s.id === step.id);
  const suffix = sameGroup.length > 1 ? String.fromCharCode(97 + posInGroup) : "";
  return `Tour · Step ${step.group}${suffix} of ${groupTotal}`;
}

