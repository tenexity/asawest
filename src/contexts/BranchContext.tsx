import { createContext, useContext, useState, ReactNode } from "react";

type BranchCtx = {
  branchId: string | "all";
  setBranchId: (v: string | "all") => void;
};

const Ctx = createContext<BranchCtx | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branchId, setBranchId] = useState<string | "all">("all");
  return <Ctx.Provider value={{ branchId, setBranchId }}>{children}</Ctx.Provider>;
}

export function useBranch() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBranch outside provider");
  return c;
}
