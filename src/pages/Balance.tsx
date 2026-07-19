import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Scale, Sparkles, Loader2, Download, CheckCircle2, ArrowRight, ArrowLeft,
  RefreshCw, HelpCircle, Info, ChevronDown, ChevronRight, Plus, X, RotateCcw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ---------- Types ----------
type AbsorptionTarget = {
  branch_id: string;
  branch_name: string;
  dest_on_hand: number;
  dest_reorder_point: number;
  velocity_per_day: number;
  current_dos: number;
  headroom_units: number;
  tier: "covers_shortage" | "safety_cushion" | "slow_absorption";
};

type Release = {
  sku: string; description: string; category: string;
  branch_id: string; branch_name: string; product_id: string;
  on_hand: number; unit_cost: number; tied_capital: number; dos: number;
  disposition: "Transfer" | "Return" | "Bundle" | "Markdown";
  disposition_detail: string;
  transfer_target: { branch_id: string; branch_name: string; units_short: number } | null;
  bundle_target: { sku: string; description: string } | null;
  recoverable_cash: number;
  absorption_targets: AbsorptionTarget[];
};

type Redeploy = {
  sku: string; description: string; category: string;
  branch_id: string; branch_name: string; product_id: string;
  on_hand: number; reorder_point: number; qty30: number; unit_cost: number;
  units_short: number; cash_needed: number; priority_score: number;
  priority_label: "Critical" | "Below ROP" | "Trending up";
};

type Totals = {
  cash_freed: number; capital_tied: number; cash_needed: number;
  release_count: number; redeploy_count: number;
};

type LineKind = "transfer" | "markdown" | "return" | "bundle" | "hold";

type AllocationLine = {
  id: string;
  kind: LineKind;
  qty: number;
  dest_branch_id?: string;
  dest_branch_name?: string;
  tier?: AbsorptionTarget["tier"];
  headroom_cap?: number; // max qty this dest can absorb
  bundle_sku?: string;
};

// ---------- Helpers ----------
const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const uid = () => Math.random().toString(36).slice(2, 9);

const RECOVERY_RATE: Record<LineKind, number> = {
  transfer: 0,       // no immediate cash — inventory repositioned
  markdown: 0.75,    // 25% markdown
  return:   0.85,    // 15% restock fee
  bundle:   1.00,    // sells with a fast mover
  hold:     0,       // capital stays tied up by choice
};

const TIER_LABEL: Record<AbsorptionTarget["tier"], string> = {
  covers_shortage: "Covers shortage",
  safety_cushion: "Safety cushion",
  slow_absorption: "Slow absorption",
};
const TIER_COLOR: Record<AbsorptionTarget["tier"], string> = {
  covers_shortage: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  safety_cushion:  "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  slow_absorption: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};
const TIER_DOT: Record<AbsorptionTarget["tier"], string> = {
  covers_shortage: "🔴",
  safety_cushion: "🟡",
  slow_absorption: "🟢",
};

const priorityColor: Record<Redeploy["priority_label"], string> = {
  Critical:     "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  "Below ROP":  "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  "Trending up":"bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

const kindColor: Record<LineKind, string> = {
  transfer: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  return:   "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  bundle:   "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  markdown: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  hold:     "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

function formatAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const releaseKey = (r: Release) => `${r.product_id}|${r.branch_id}`;

// Build a default allocation that mirrors the algorithm's recommendation for this release,
// then routes the leftover on-hand to markdown so every unit is accounted for.
function buildDefaultAllocation(r: Release): AllocationLine[] {
  const lines: AllocationLine[] = [];
  let remaining = r.on_hand;

  if (r.disposition === "Transfer" && r.transfer_target) {
    const primaryMatch = r.absorption_targets.find(
      (t) => t.branch_id === r.transfer_target!.branch_id,
    );
    const cap = primaryMatch?.headroom_units ?? r.transfer_target.units_short;
    const qty = Math.min(remaining, r.transfer_target.units_short, cap || r.transfer_target.units_short);
    if (qty > 0) {
      lines.push({
        id: uid(),
        kind: "transfer",
        qty,
        dest_branch_id: r.transfer_target.branch_id,
        dest_branch_name: r.transfer_target.branch_name,
        tier: primaryMatch?.tier ?? "covers_shortage",
        headroom_cap: primaryMatch?.headroom_units,
      });
      remaining -= qty;
    }
  } else if (r.disposition === "Return") {
    lines.push({ id: uid(), kind: "return", qty: remaining });
    remaining = 0;
  } else if (r.disposition === "Bundle" && r.bundle_target) {
    lines.push({ id: uid(), kind: "bundle", qty: remaining, bundle_sku: r.bundle_target.sku });
    remaining = 0;
  }

  if (remaining > 0) {
    lines.push({ id: uid(), kind: "markdown", qty: remaining });
  }
  return lines;
}

// ---------- AllocationTray ----------
function AllocationTray({
  release,
  lines,
  onChange,
  onReset,
}: {
  release: Release;
  lines: AllocationLine[];
  onChange: (next: AllocationLine[]) => void;
  onReset: () => void;
}) {
  const cost = release.unit_cost || 0;
  const allocated = lines.reduce((s, l) => s + (Number.isFinite(l.qty) ? l.qty : 0), 0);
  const remaining = release.on_hand - allocated;
  const balanced = remaining === 0;

  const usedDestIds = new Set(lines.map((l) => l.dest_branch_id).filter(Boolean));
  const availableTargets = release.absorption_targets.filter((t) => !usedDestIds.has(t.branch_id));

  function updateLine(id: string, patch: Partial<AllocationLine>) {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id: string) {
    onChange(lines.filter((l) => l.id !== id));
  }
  function addTransfer(t: AbsorptionTarget) {
    // Auto-suggest qty = min(remaining, headroom). If remaining is 0, seed 1 so user can raise it.
    const seed = Math.max(1, Math.min(Math.max(remaining, 0) || 1, t.headroom_units));
    onChange([
      ...lines,
      {
        id: uid(),
        kind: "transfer",
        qty: seed,
        dest_branch_id: t.branch_id,
        dest_branch_name: t.branch_name,
        tier: t.tier,
        headroom_cap: t.headroom_units,
      },
    ]);
  }
  function addLine(kind: LineKind) {
    onChange([...lines, { id: uid(), kind, qty: Math.max(remaining, 0) }]);
  }

  return (
    <div className="bg-muted/20 border-t px-4 py-3 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            Allocating <b className="text-foreground">{release.on_hand.toLocaleString()}</b> on-hand units @ ${cost.toFixed(2)}
          </span>
          <span className={`px-2 py-0.5 rounded font-medium tabular-nums ${
            balanced ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                     : remaining > 0
                       ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                       : "bg-red-500/15 text-red-700 dark:text-red-300"
          }`}>
            {balanced ? "✓ Balanced" : remaining > 0 ? `${remaining.toLocaleString()} unallocated` : `${Math.abs(remaining).toLocaleString()} over-allocated`}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onReset}>
          <RotateCcw className="h-3 w-3" /> Reset to recommendation
        </Button>
      </div>

      <div className="space-y-2">
        {lines.map((l) => {
          const cashRecovered = l.kind === "transfer" ? 0 : Math.round(l.qty * cost * RECOVERY_RATE[l.kind]);
          const capitalRepositioned = l.kind === "transfer" ? Math.round(l.qty * cost) : 0;
          const overCap = l.kind === "transfer" && l.headroom_cap != null && l.qty > l.headroom_cap;

          return (
            <div key={l.id} className="flex flex-wrap items-center gap-2 text-xs bg-background rounded border p-2">
              <Badge variant="outline" className={`${kindColor[l.kind]} shrink-0 capitalize`}>{l.kind}</Badge>

              {l.kind === "transfer" && (
                <span className="text-muted-foreground shrink-0">→ <b className="text-foreground">{l.dest_branch_name}</b></span>
              )}
              {l.kind === "bundle" && l.bundle_sku && (
                <span className="text-muted-foreground shrink-0">w/ <b className="text-foreground">{l.bundle_sku}</b></span>
              )}

              {l.tier && (
                <Badge variant="outline" className={`${TIER_COLOR[l.tier]} text-[10px] shrink-0`}>
                  {TIER_DOT[l.tier]} {TIER_LABEL[l.tier]}
                </Badge>
              )}

              <div className="flex items-center gap-1 ml-auto shrink-0">
                <Input
                  type="number"
                  min={0}
                  value={l.qty}
                  onChange={(e) => updateLine(l.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
                  className={`h-7 w-24 text-right tabular-nums ${overCap ? "border-red-500" : ""}`}
                />
                <span className="text-muted-foreground">units</span>
              </div>

              <div className="text-right tabular-nums w-32 shrink-0">
                {l.kind === "transfer" ? (
                  <div className="text-blue-600 dark:text-blue-400 font-medium">{fmt$(capitalRepositioned)}</div>
                ) : (
                  <div className="text-emerald-600 font-medium">{fmt$(cashRecovered)}</div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {l.kind === "transfer" ? "repositioned" : "cash"}
                </div>
              </div>

              {l.kind === "transfer" && l.headroom_cap != null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className={`h-3 w-3 shrink-0 ${overCap ? "text-red-500" : "text-muted-foreground"}`} />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {overCap
                      ? `Exceeds this branch's headroom of ${l.headroom_cap.toLocaleString()} units — would push them past 180 days of supply.`
                      : `Max ${l.headroom_cap.toLocaleString()} units before this branch tips into excess (180 days of supply).`}
                  </TooltipContent>
                </Tooltip>
              )}

              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => removeLine(l.id)}
                title="Remove line"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={availableTargets.length === 0}>
              <Plus className="h-3 w-3" /> Add transfer target
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-96">
            <DropdownMenuLabel className="text-xs">Branches ranked by velocity — headroom respects 180-day cap</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {availableTargets.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground text-center">All eligible branches already added.</div>
            )}
            {availableTargets.map((t) => (
              <DropdownMenuItem
                key={t.branch_id}
                className="flex flex-col items-start gap-0.5 py-2"
                onClick={() => addTransfer(t)}
              >
                <div className="flex items-center gap-2 w-full">
                  <span className="text-xs">{TIER_DOT[t.tier]}</span>
                  <span className="font-medium text-sm">{t.branch_name}</span>
                  <Badge variant="outline" className={`ml-auto text-[10px] ${TIER_COLOR[t.tier]}`}>
                    {TIER_LABEL[t.tier]}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground pl-6">
                  Sells {t.velocity_per_day.toFixed(1)}/day · {t.current_dos >= 999 ? "no demand" : `${t.current_dos.toFixed(0)}d of supply`} · absorbs up to <b>{t.headroom_units.toLocaleString()}</b> units
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {!lines.some((l) => l.kind === "markdown") && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => addLine("markdown")}>
            <Plus className="h-3 w-3" /> Add markdown
          </Button>
        )}
        {!lines.some((l) => l.kind === "return") && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => addLine("return")}>
            <Plus className="h-3 w-3" /> Add return
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------- Page ----------
type CacheEntry = { releases: Release[]; redeploys: Redeploy[]; totals: Totals | null; ts: number };
const balanceCache: Record<string, CacheEntry> = {};

export default function Balance() {
  const { branchId } = useBranch();
  const cacheKey = branchId ?? "all";
  const cached = balanceCache[cacheKey];
  const [loading, setLoading] = useState(!cached);
  const [releases, setReleases] = useState<Release[]>(cached?.releases ?? []);
  const [redeploys, setRedeploys] = useState<Redeploy[]>(cached?.redeploys ?? []);
  const [totals, setTotals] = useState<Totals | null>(cached?.totals ?? null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(cached?.ts ?? null);
  const [plan, setPlan] = useState<string>("");
  const [planLoading, setPlanLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [, setNowTick] = useState(0);

  // Per-release editable allocation state, keyed by product_id|branch_id.
  const [allocations, setAllocations] = useState<Record<string, AllocationLine[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const loadData = useCallback(async (force: boolean) => {
    const key = branchId ?? "all";
    const existing = balanceCache[key];
    if (!force && existing) {
      setReleases(existing.releases);
      setRedeploys(existing.redeploys);
      setTotals(existing.totals);
      setLastUpdated(existing.ts);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("sku_balance_plan" as any, {
      p_branch_id: branchId === "all" ? null : branchId,
    });
    if (error) {
      console.error(error);
      toast.error("Failed to load rebalance data");
      setLoading(false);
      return;
    }
    const d = (data ?? {}) as any;
    const entry: CacheEntry = {
      releases: (d.releases ?? []) as Release[],
      redeploys: (d.redeploys ?? []) as Redeploy[],
      totals: (d.totals ?? null) as Totals | null,
      ts: Date.now(),
    };
    balanceCache[key] = entry;
    setReleases(entry.releases);
    setRedeploys(entry.redeploys);
    setTotals(entry.totals);
    setLastUpdated(entry.ts);
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    setPlan("");
    void loadData(false);
  }, [loadData]);

  // Seed / reseed allocations whenever the releases list changes.
  useEffect(() => {
    const next: Record<string, AllocationLine[]> = {};
    for (const r of releases) {
      next[releaseKey(r)] = buildDefaultAllocation(r);
    }
    setAllocations(next);
    setExpanded({});
  }, [releases]);

  const setAllocation = (key: string, lines: AllocationLine[]) => {
    setAllocations((s) => ({ ...s, [key]: lines }));
  };
  const resetAllocation = (r: Release) => {
    setAllocation(releaseKey(r), buildDefaultAllocation(r));
  };

  // ---- Live-computed totals from the editable allocations ----
  const perReleaseSummary = useMemo(() => {
    return releases.map((r) => {
      const lines = allocations[releaseKey(r)] ?? [];
      const cost = r.unit_cost || 0;
      const allocated = lines.reduce((s, l) => s + (l.qty || 0), 0);
      const cashRecovered = lines.reduce((s, l) =>
        l.kind === "transfer" ? s : s + l.qty * cost * RECOVERY_RATE[l.kind], 0);
      const repositioned = lines.reduce((s, l) => l.kind === "transfer" ? s + l.qty * cost : s, 0);
      const overCap = lines.some((l) =>
        l.kind === "transfer" && l.headroom_cap != null && l.qty > l.headroom_cap);
      return { r, lines, allocated, cashRecovered, repositioned, remaining: r.on_hand - allocated, overCap };
    });
  }, [releases, allocations]);

  const capitalTied = useMemo(
    () => perReleaseSummary.reduce((s, x) => s + x.r.tied_capital, 0),
    [perReleaseSummary],
  );
  const cashRecovered = useMemo(
    () => perReleaseSummary.reduce((s, x) => s + x.cashRecovered, 0),
    [perReleaseSummary],
  );
  const capitalRepositioned = useMemo(
    () => perReleaseSummary.reduce((s, x) => s + x.repositioned, 0),
    [perReleaseSummary],
  );
  const cashNeeded = totals?.cash_needed ?? 0;
  const netFreed = useMemo(() => Math.max(cashRecovered - cashNeeded, 0), [cashRecovered, cashNeeded]);
  const marginLift = useMemo(() => netFreed * 0.35, [netFreed]);

  const allBalanced = perReleaseSummary.every((x) => x.remaining === 0 && !x.overCap);
  const unbalancedCount = perReleaseSummary.filter((x) => x.remaining !== 0 || x.overCap).length;

  async function generatePlan() {
    setPlanLoading(true);
    setPlan("");
    try {
      const { data, error } = await supabase.functions.invoke("rebalance-plan", {
        body: { releases, redeploys, totals },
      });
      if (error) throw error;
      setPlan((data as any)?.plan ?? "");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate plan");
    } finally {
      setPlanLoading(false);
    }
  }

  function exportCsv() {
    const rows: string[] = [];
    rows.push("Side,SKU,Description,SourceBranch,Kind,Qty,DestBranch,Tier,DollarImpact,Type");
    perReleaseSummary.forEach(({ r, lines }) => {
      const cost = r.unit_cost || 0;
      lines.forEach((l) => {
        const dollars = l.kind === "transfer" ? Math.round(l.qty * cost) : Math.round(l.qty * cost * RECOVERY_RATE[l.kind]);
        rows.push([
          "Release",
          r.sku,
          JSON.stringify(r.description),
          JSON.stringify(r.branch_name),
          l.kind,
          l.qty,
          JSON.stringify(l.dest_branch_name ?? ""),
          l.tier ?? "",
          dollars,
          l.kind === "transfer" ? "repositioned" : "cash",
        ].join(","));
      });
    });
    redeploys.forEach((r) => {
      rows.push([
        "Redeploy",
        r.sku,
        JSON.stringify(r.description),
        JSON.stringify(r.branch_name),
        "shortage",
        r.units_short,
        "",
        r.priority_label,
        Math.round(r.cash_needed),
        "cash_needed",
      ].join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sku-balance-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function approvePlan() {
    setApproving(true);
    try {
      const now = new Date().toISOString();
      const transfers: any[] = [];
      const markdowns: any[] = [];
      const arrivesOn = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

      perReleaseSummary.forEach(({ r, lines }) => {
        lines.forEach((l) => {
          if (l.qty <= 0) return;
          if (l.kind === "transfer" && l.dest_branch_id) {
            transfers.push({
              source_branch_id: r.branch_id,
              dest_branch_id: l.dest_branch_id,
              product_id: r.product_id,
              quantity: l.qty,
              status: "pending" as const,
              expected_arrival: arrivesOn,
            });
          } else if (l.kind === "markdown") {
            markdowns.push({
              product_id: r.product_id,
              branch_id: r.branch_id,
              excess_qty: l.qty,
              estimated_value: l.qty * (r.unit_cost || 0) * RECOVERY_RATE.markdown,
            });
          }
          // returns & bundles are advisory-only in v1, captured in audit payload
        });
      });

      if (markdowns.length) {
        const { error } = await supabase.from("markdown_candidates").insert(markdowns);
        if (error) throw error;
      }
      if (transfers.length) {
        const { error } = await supabase.from("transfer_orders").insert(transfers);
        if (error) throw error;
      }

      const { error: auditErr } = await supabase.from("action_audit_log").insert({
        action_type: "sku_balance_plan",
        insight_type: "sku_balance_plan",
        insight_title: "SKU Balance — working-capital rebalance",
        financial_impact_usd: netFreed,
        action_summary: `Created ${transfers.length} transfer(s) and ${markdowns.length} markdown(s). Cash recovered ~${fmt$(cashRecovered)}; inventory repositioned ~${fmt$(capitalRepositioned)}.`,
        action_payload: {
          allocations: perReleaseSummary.map(({ r, lines }) => ({
            sku: r.sku, product_id: r.product_id, branch_id: r.branch_id, branch_name: r.branch_name,
            on_hand: r.on_hand, unit_cost: r.unit_cost, lines,
          })),
          redeploys, totals, generated_at: now,
        } as any,
        result_json: { transfers_created: transfers.length, markdowns_created: markdowns.length } as any,
        status: "success",
      } as any);
      if (auditErr) throw auditErr;

      toast.success(`Plan approved · ${transfers.length} transfer(s), ${markdowns.length} markdown(s) queued`);
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Approval failed");
    } finally {
      setApproving(false);
    }
  }

  // Roll-ups for the release column header + approve dialog
  const totalLines = perReleaseSummary.reduce((s, x) => s + x.lines.length, 0);
  const transferLines = perReleaseSummary.reduce((s, x) => s + x.lines.filter((l) => l.kind === "transfer" && l.qty > 0).length, 0);
  const markdownLines = perReleaseSummary.reduce((s, x) => s + x.lines.filter((l) => l.kind === "markdown" && l.qty > 0).length, 0);
  const returnLines = perReleaseSummary.reduce((s, x) => s + x.lines.filter((l) => l.kind === "return" && l.qty > 0).length, 0);
  const bundleLines = perReleaseSummary.reduce((s, x) => s + x.lines.filter((l) => l.kind === "bundle" && l.qty > 0).length, 0);

  // ---- Cross-side impact map ----
  // For each (product_id | dest_branch_id), sum incoming transfer units from all Release allocations,
  // and remember what remains at the source branch after all its transfers ship.
  type Incoming = {
    from_branch_id: string;
    from_branch_name: string;
    qty: number;
    source_on_hand_before: number;
    source_on_hand_after: number;
    source_dos_before: number;
  };
  const incomingByPair = useMemo(() => {
    const m: Record<string, Incoming[]> = {};
    perReleaseSummary.forEach(({ r, lines }) => {
      const totalOut = lines.filter((x) => x.kind === "transfer" && x.qty > 0).reduce((s, x) => s + x.qty, 0);
      lines.forEach((l) => {
        if (l.kind !== "transfer" || !l.dest_branch_id || l.qty <= 0) return;
        const key = `${r.product_id}|${l.dest_branch_id}`;
        (m[key] ||= []).push({
          from_branch_id: r.branch_id,
          from_branch_name: r.branch_name,
          qty: l.qty,
          source_on_hand_before: r.on_hand,
          source_on_hand_after: r.on_hand - totalOut,
          source_dos_before: r.dos,
        });
      });
    });
    return m;
  }, [perReleaseSummary]);

  return (
    <TooltipProvider delayDuration={100}>
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SKU Balance</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            The system proposes a disposition for every excess SKU; you make the final call. Expand any row
            to reshape the plan — shift units toward branches that will sell them at full margin instead of
            discounting. Approve is unlocked once every SKU is fully allocated.
          </p>
        </div>
      </div>

      {/* Totals bar */}
      <div className="grid gap-3 md:grid-cols-4" data-tour="balance-totals">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Capital in excess</div>
          <div className="text-2xl font-semibold mt-1">{fmt$(capitalTied)}</div>
          <div className="text-xs text-muted-foreground mt-1">{releases.length} SKUs tied up</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            Cash recovered
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Real cash returning to the bank from Returns (85%), Bundles (~100%), and Markdowns (75%).
                <b> Transfers are NOT counted here</b> — they reposition inventory, they don't refund cash.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="text-2xl font-semibold mt-1 text-emerald-600">{fmt$(cashRecovered)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            + {fmt$(capitalRepositioned)} repositioned via transfer
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Cash to fix stockouts</div>
          <div className="text-2xl font-semibold mt-1">{fmt$(cashNeeded)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals?.redeploy_count ?? 0} SKUs below ROP</div>
        </Card>
        <Card className="p-4 border-primary/40 bg-primary/5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            Net freed + est. margin lift
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Cash recovered − cash needed to restock. Margin lift assumes 35% gross margin on redeployed units.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="text-2xl font-semibold mt-1 text-primary">
            {fmt$(netFreed)} <span className="text-base text-muted-foreground">+ {fmt$(marginLift)}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">Working-capital release, next 30–60 days</div>
        </Card>
      </div>

      {loading && (
        <Card className="p-3 flex items-center gap-3 border-primary/30 bg-primary/5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="text-sm">
            Crunching excess stock, absorption capacity, and stockout risk across the network…
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generatePlan} disabled={planLoading || loading || releases.length === 0} data-tour="balance-generate-btn">
          {planLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Generate AI Rebalance Plan
        </Button>
        <Button variant="outline" onClick={exportCsv} disabled={loading || releases.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
        <Button variant="ghost" size="sm" onClick={() => loadData(true)} disabled={loading} title="Recompute from the latest data">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">Updated {formatAge(lastUpdated)}</span>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto">
              <Button
                variant="default"
                onClick={() => setConfirmOpen(true)}
                disabled={loading || releases.length === 0 || !allBalanced}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Start the Process
              </Button>
            </span>
          </TooltipTrigger>
          {!allBalanced && (
            <TooltipContent className="text-xs">
              {unbalancedCount} SKU{unbalancedCount === 1 ? "" : "s"} still {perReleaseSummary.some((x) => x.overCap) ? "over-allocated or over branch capacity" : "have unallocated units"} — resolve them to unlock Approve.
            </TooltipContent>
          )}
        </Tooltip>
      </div>

      {plan && (
        <Card className="p-5 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <div className="font-semibold text-sm">AI Rebalance Plan</div>
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{plan}</ReactMarkdown>
          </div>
        </Card>
      )}

      {/* Two-column */}
      <div className="grid gap-4 lg:grid-cols-2" data-tour="balance-columns">
        {/* RELEASE */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b bg-muted/40">
            <div className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4 text-emerald-600" />
              <div className="font-semibold">Release <span className="text-muted-foreground font-normal">— excess → cash & repositioned stock</span></div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {totalLines} allocation lines · {transferLines} transfer · {markdownLines} markdown · {returnLines} return · {bundleLines} bundle. Click any row to edit.
            </div>
          </div>
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Source branch</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">$ impact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && perReleaseSummary.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No excess SKUs at this branch.</TableCell></TableRow>
                )}
                {perReleaseSummary.map(({ r, lines, allocated, cashRecovered, repositioned, remaining, overCap }) => {
                  const key = releaseKey(r);
                  const isOpen = expanded[key] ?? false;
                  const balanced = remaining === 0 && !overCap;
                  return (
                    <>
                      <TableRow
                        key={`${key}-row`}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpanded((s) => ({ ...s, [key]: !isOpen }))}
                      >
                        <TableCell className="w-8">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.sku}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.description}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.branch_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div>{r.on_hand.toLocaleString()}</div>
                          <div className={`text-[10px] ${balanced ? "text-emerald-600" : "text-amber-600"}`}>
                            {balanced ? "✓ balanced" : remaining > 0 ? `${remaining.toLocaleString()} left` : overCap ? "over cap" : `${Math.abs(remaining).toLocaleString()} over`}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {lines.filter((l) => l.qty > 0).slice(0, 3).map((l) => (
                              <Badge key={l.id} variant="outline" className={`${kindColor[l.kind]} text-[10px] capitalize`}>
                                {l.kind === "transfer" ? `→ ${l.dest_branch_name?.split(" ")[0]} ${l.qty.toLocaleString()}` : `${l.kind} ${l.qty.toLocaleString()}`}
                              </Badge>
                            ))}
                            {lines.filter((l) => l.qty > 0).length > 3 && (
                              <span className="text-[10px] text-muted-foreground">+{lines.filter((l) => l.qty > 0).length - 3}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div className="text-emerald-600 font-medium">{fmt$(cashRecovered)}</div>
                          {repositioned > 0 && (
                            <div className="text-[10px] text-blue-600 dark:text-blue-400">+ {fmt$(repositioned)} moved</div>
                          )}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`${key}-tray`}>
                          <TableCell colSpan={6} className="p-0">
                            <AllocationTray
                              release={r}
                              lines={lines}
                              onChange={(next) => setAllocation(key, next)}
                              onReset={() => resetAllocation(r)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* REDEPLOY */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b bg-muted/40">
            <div className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-primary" />
              <div className="font-semibold">Redeploy <span className="text-muted-foreground font-normal">— cash → fast movers</span></div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Ranked by 14-day revenue at risk</div>
          </div>
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Cash needed</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && redeploys.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No stockout risk at this branch.</TableCell></TableRow>
                )}
                {redeploys.map((r, i) => {
                  const incoming = incomingByPair[`${r.product_id}|${r.branch_id}`] ?? [];
                  const incomingQty = incoming.reduce((s, x) => s + x.qty, 0);
                  const covered = r.units_short > 0 ? Math.min(1, incomingQty / r.units_short) : 0;
                  const remainingShort = Math.max(0, r.units_short - incomingQty);
                  const cashStillNeeded = Math.max(0, r.cash_needed - incomingQty * (r.unit_cost || 0));
                  const dailyDemand = r.qty30 / 30;
                  const daysToStockout = dailyDemand > 0 ? (r.on_hand / dailyDemand) : 999;
                  const revenue14 = dailyDemand * 14 * (r.unit_cost || 0);
                  return (
                    <TableRow key={`${r.product_id}-${r.branch_id}-${i}`}>
                      <TableCell>
                        <div className="font-medium">{r.sku}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.description}</div>
                      </TableCell>
                      <TableCell className="text-xs">{r.branch_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{r.units_short.toLocaleString()}</div>
                        {incomingQty > 0 && (
                          <div className="text-[10px] text-blue-600 dark:text-blue-400">
                            −{incomingQty.toLocaleString()} incoming ({Math.round(covered * 100)}%)
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={priorityColor[r.priority_label]}>{r.priority_label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        <div>{fmt$(r.cash_needed)}</div>
                        {incomingQty > 0 && cashStillNeeded < r.cash_needed && (
                          <div className="text-[10px] text-emerald-600">
                            → {fmt$(cashStillNeeded)} after transfer
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6" title="Why this recommendation?">
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-96 text-xs space-y-3">
                            <div>
                              <div className="font-semibold text-sm">Why this SKU is on the redeploy list</div>
                              <div className="text-muted-foreground mt-0.5">
                                {r.branch_name} · <span className="font-mono">{r.sku}</span>
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">Shortage math</div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
                                <span>On hand</span><span className="text-right">{r.on_hand.toLocaleString()}</span>
                                <span>Reorder point</span><span className="text-right">{r.reorder_point.toLocaleString()}</span>
                                <span>Units short</span><span className="text-right font-medium">{r.units_short.toLocaleString()}</span>
                                <span>Sold last 30d</span><span className="text-right">{r.qty30.toLocaleString()}</span>
                                <span>Avg daily demand</span><span className="text-right">{dailyDemand.toFixed(1)}</span>
                                <span>Days to stockout</span><span className="text-right">{daysToStockout >= 999 ? "—" : daysToStockout.toFixed(1)}</span>
                                <span>Unit cost</span><span className="text-right">${(r.unit_cost || 0).toFixed(2)}</span>
                                <span>Cash needed</span><span className="text-right font-medium">{fmt$(r.cash_needed)}</span>
                              </div>
                              <div className="text-muted-foreground text-[11px] pt-1">
                                Cash needed = units short × unit cost = {r.units_short.toLocaleString()} × ${(r.unit_cost || 0).toFixed(2)}
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="font-semibold uppercase tracking-wide text-[10px] text-muted-foreground">Priority score</div>
                              <div className="text-[11px]">
                                <span className="font-medium">{r.priority_label}</span> — 14-day revenue at risk ≈ <b>{fmt$(revenue14)}</b>
                                <div className="text-muted-foreground mt-0.5">
                                  ({dailyDemand.toFixed(1)}/day × 14 days × ${(r.unit_cost || 0).toFixed(2)})
                                </div>
                              </div>
                            </div>

                            {incoming.length > 0 ? (
                              <div className="space-y-1 border-t pt-2">
                                <div className="font-semibold uppercase tracking-wide text-[10px] text-blue-600 dark:text-blue-400">
                                  Impact of your Release plan
                                </div>
                                <div className="text-[11px]">
                                  {incomingQty.toLocaleString()} units incoming from {incoming.length} branch{incoming.length === 1 ? "" : "es"} —
                                  covers <b>{Math.round(covered * 100)}%</b> of the {r.units_short.toLocaleString()}-unit shortage.
                                </div>
                                <ul className="text-[11px] space-y-0.5 pl-3 list-disc">
                                  {incoming.map((inc, idx) => (
                                    <li key={idx}>
                                      <b>{inc.qty.toLocaleString()}</b> from <b>{inc.from_branch_name}</b>
                                      <span className="text-muted-foreground">
                                        {" "}(their on-hand: {inc.source_on_hand_before.toLocaleString()} → {Math.max(0, inc.source_on_hand_after).toLocaleString()}
                                        {inc.source_dos_before < 999 ? `, was ${inc.source_dos_before.toFixed(0)}d supply` : ", no local demand"})
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                                {remainingShort > 0 ? (
                                  <div className="text-[11px] pt-1">
                                    Still short <b>{remainingShort.toLocaleString()}</b> units — needs <b>{fmt$(cashStillNeeded)}</b> in new PO or additional transfers.
                                  </div>
                                ) : (
                                  <div className="text-[11px] pt-1 text-emerald-600">
                                    ✓ Shortage fully covered by transfers — no PO needed.
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="border-t pt-2 text-[11px] text-muted-foreground">
                                No transfer of this SKU is currently allocated to this branch. Fix by adding a transfer
                                target in a matching Release row, or plan a PO for <b>{fmt$(r.cash_needed)}</b>.
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      {/* Approve dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve the rebalance plan?</DialogTitle>
            <DialogDescription>
              Here&rsquo;s exactly what will happen — nothing is sent to any supplier or customer.
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-2">
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span><b>{transferLines}</b> inter-branch transfer(s) created in <b>pending</b> status. Warehouse staff must confirm pick &amp; ship.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span><b>{markdownLines}</b> markdown candidate(s) queued for merchandiser review. No prices change automatically.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span><b>{returnLines}</b> return(s) and <b>{bundleLines}</b> bundle(s) captured in the audit payload — these are advisory and require buyer follow-up.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span>Your full edited allocation (including any deltas from the system's recommendation) is written to the audit log.</span>
            </li>
            <li className="flex gap-2 text-muted-foreground">
              <span>•</span>
              <span>No emails, EDI, or supplier notifications are triggered.</span>
            </li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={approving}>Cancel</Button>
            <Button onClick={approvePlan} disabled={approving}>
              {approving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Approve &amp; queue actions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
