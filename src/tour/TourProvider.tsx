import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { TOUR_STEPS, TourCtx } from "./tour-config";
import { ensureDemoHero } from "./ensureDemoHero";
import { TourOverlay } from "./TourOverlay";

const SEEN_KEY = "inv-forecaster.tour.seen.v1";
const PROGRESS_KEY = "inv-forecaster.tour.progress.v1";

type Ctx = {
  active: boolean;
  stepIndex: number;
  start: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  goTo: (i: number) => void;
  hasSeen: boolean;
  savedStep: number | null;
};

const TourContext = createContext<Ctx>({
  active: false,
  stepIndex: 0,
  start: () => {},
  resume: () => {},
  stop: () => {},
  next: () => {},
  prev: () => {},
  goTo: () => {},
  hasSeen: false,
  savedStep: null,
});

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [ctx, setCtx] = useState<TourCtx>({});
  const [hasSeen, setHasSeen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setHasSeen(localStorage.getItem(SEEN_KEY) === "1");
  }, []);

  const start = useCallback(async () => {
    const hero = await ensureDemoHero();
    setCtx(hero);
    setStepIndex(0);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    localStorage.setItem(SEEN_KEY, "1");
    setHasSeen(true);
  }, []);

  const goTo = useCallback((i: number) => {
    if (i < 0 || i >= TOUR_STEPS.length) return;
    setStepIndex(i);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= TOUR_STEPS.length) {
        setActive(false);
        localStorage.setItem(SEEN_KEY, "1");
        setHasSeen(true);
        return i;
      }
      return i + 1;
    });
  }, []);

  const prev = useCallback(() => goTo(Math.max(0, stepIndex - 1)), [goTo, stepIndex]);

  // Navigate when active step changes
  useEffect(() => {
    if (!active) return;
    const step = TOUR_STEPS[stepIndex];
    const route = typeof step.route === "function" ? step.route(ctx) : step.route;
    if (route && !samePath(location.pathname + location.search, route)) {
      navigate(route);
    }
  }, [active, stepIndex, ctx, navigate, location.pathname, location.search]);

  // Keyboard
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { e.preventDefault(); stop(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, prev, stop]);

  const value = useMemo<Ctx>(() => ({
    active, stepIndex, start, stop, next, prev, goTo, hasSeen,
  }), [active, stepIndex, start, stop, next, prev, goTo, hasSeen]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && <TourOverlay step={TOUR_STEPS[stepIndex]} stepIndex={stepIndex} total={TOUR_STEPS.length} onNext={next} onPrev={prev} onSkip={stop} />}
    </TourContext.Provider>
  );
}

function samePath(a: string, b: string) {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

export const useTour = () => useContext(TourContext);
