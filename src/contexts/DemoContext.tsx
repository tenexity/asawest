import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_SEQUENCE, findStepIndex } from "@/lib/demo-script";

type DemoCtx = {
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  toggleDemoMode: () => void;
  next: () => void;
  triggerReset: () => void;
  setResetHandler: (fn: (() => void) | null) => void;
  lastResetAt: string | null;
  setLastResetAt: (s: string | null) => void;
};

const Ctx = createContext<DemoCtx>({
  demoMode: false,
  setDemoMode: () => {},
  toggleDemoMode: () => {},
  next: () => {},
  triggerReset: () => {},
  setResetHandler: () => {},
  lastResetAt: null,
  setLastResetAt: () => {},
});

export function DemoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [demoMode, setDemoModeState] = useState(false);
  const [lastResetAt, setLastResetAt] = useState<string | null>(null);
  const [resetHandler, setResetHandler] = useState<(() => void) | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Load settings
  useEffect(() => {
    if (!user) return;
    supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDemoModeState(data.demo_mode);
          setLastResetAt(data.last_reset_at);
        }
      });
  }, [user]);

  const persist = useCallback(async (patch: any) => {
    if (!user) return;
    await supabase.from("user_settings").upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() });
  }, [user]);

  const setDemoMode = useCallback((v: boolean) => {
    setDemoModeState(v);
    persist({ demo_mode: v });
  }, [persist]);

  const toggleDemoMode = useCallback(() => setDemoMode(!demoMode), [demoMode, setDemoMode]);

  const next = useCallback(() => {
    const idx = findStepIndex(location.pathname);
    const ni = (idx + 1) % DEMO_SEQUENCE.length;
    navigate(DEMO_SEQUENCE[ni].path);
  }, [location.pathname, navigate]);

  const triggerReset = useCallback(() => {
    if (resetHandler) resetHandler();
    else navigate("/settings");
  }, [resetHandler, navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "d" || e.key === "D") { e.preventDefault(); toggleDemoMode(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); triggerReset(); }
      else if (e.key === "ArrowRight" && demoMode) { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleDemoMode, triggerReset, next, demoMode]);

  return (
    <Ctx.Provider value={{ demoMode, setDemoMode, toggleDemoMode, next, triggerReset, setResetHandler, lastResetAt, setLastResetAt }}>
      {children}
    </Ctx.Provider>
  );
}

export const useDemo = () => useContext(Ctx);
