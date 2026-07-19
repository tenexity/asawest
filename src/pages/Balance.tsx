import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Scale, Sparkles, Loader2, Download, CheckCircle2, ArrowRight, ArrowLeft, RefreshCw, HelpCircle, Info } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Release = {
  sku: string; description: string; category: string;
  branch_id: string; branch_name: string; product_id: string;
  on_hand: number; unit_cost: number; tied_capital: number; dos: number;
  disposition: "Transfer" | "Return" | "Bundle" | "Markdown";
  disposition_detail: string;
  transfer_target: { branch_id: string; branch_name: string; units_short: number } | null;
  bundle_target: { sku: string; description: string } | null;
  recoverable_cash: number;
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

const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;


const dispositionColor: Record<Release["disposition"], string> = {
  Transfer: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  Return:   "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  Bundle:   "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  Markdown: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

const priorityColor: Record<Redeploy["priority_label"], string> = {
  Critical:     "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  "Below ROP":  "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
  "Trending up":"bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

type CacheEntry = { releases: Release[]; redeploys: Redeploy[]; totals: Totals | null; ts: number };
const balanceCache: Record<string, CacheEntry> = {};

function formatAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

type Rationale = { label: string; value: string; hint?: string };
type EnrichedRelease = Release & {
  actionQty: number;
  valueImpact: number;
  valueLabel: string;
  isRealCash: boolean; // true = cash actually returns to bank; false = capital repositioned/avoided-loss
  rationale: Rationale[];
  logicSummary: string;
};

function enrichRelease(r: Release): EnrichedRelease {
  const cost = r.unit_cost || 0;
  const tied = r.on_hand * cost;
  const dosLabel = r.dos >= 999 ? "no demand in last 30d" : `${Math.round(r.dos)} days of supply on hand`;

  if (r.disposition === "Transfer" && r.transfer_target) {
    const qty = Math.min(r.on_hand, r.transfer_target.units_short);
    const capitalMoved = qty * cost;
    // Avoided lost margin at destination (assume 35% gross margin on units that would have stocked out)
    const avoidedLoss = capitalMoved * 0.35;
    return {
      ...r,
      actionQty: qty,
      valueImpact: capitalMoved,
      valueLabel: "Capital repositioned",
      isRealCash: false,
      logicSummary: `Move ${qty.toLocaleString()} of ${r.on_hand.toLocaleString()} on-hand units to ${r.transfer_target.branch_name}, which is short ${r.transfer_target.units_short.toLocaleString()}. Cash does not return to the bank — inventory dollars simply relocate to where they will actually sell.`,
      rationale: [
        { label: "On-hand at source", value: `${r.on_hand.toLocaleString()} units (${dosLabel})` },
        { label: "Shortage at destination", value: `${r.transfer_target.units_short.toLocaleString()} units short at ${r.transfer_target.branch_name}` },
        { label: "Transfer qty (the min)", value: `${qty.toLocaleString()} units`, hint: "min(on-hand at source, units short at destination)" },
        { label: "Unit cost", value: `$${cost.toFixed(2)}` },
        { label: "Capital repositioned", value: `${qty.toLocaleString()} × $${cost.toFixed(2)} = $${Math.round(capitalMoved).toLocaleString()}`, hint: "Inventory dollars moved to a location that will sell them. NOT new cash in the bank." },
        { label: "Est. avoided lost margin", value: `~$${Math.round(avoidedLoss).toLocaleString()}`, hint: "Assumes 35% gross margin on units that would have stocked out at destination." },
      ],
    };
  }

  if (r.disposition === "Return") {
    const recovery = tied * 0.85;
    return {
      ...r,
      actionQty: r.on_hand,
      valueImpact: recovery,
      valueLabel: "Cash refunded (est.)",
      isRealCash: true,
      logicSummary: `Return all ${r.on_hand.toLocaleString()} units to the primary supplier. Vendor rebate program or high reliability score qualifies this SKU for return, typically at ~85% of cost.`,
      rationale: [
        { label: "On-hand", value: `${r.on_hand.toLocaleString()} units (${dosLabel})` },
        { label: "Tied-up capital", value: `${r.on_hand.toLocaleString()} × $${cost.toFixed(2)} = $${Math.round(tied).toLocaleString()}` },
        { label: "Return recovery rate", value: "85%", hint: "Typical restocking fee applied by primary suppliers with rebate programs." },
        { label: "Cash refunded", value: `$${Math.round(tied).toLocaleString()} × 0.85 = $${Math.round(recovery).toLocaleString()}`, hint: "Real cash returned to your account." },
      ],
    };
  }

  if (r.disposition === "Bundle" && r.bundle_target) {
    const revenue = tied; // assume sold-through at cost value alongside a fast mover
    return {
      ...r,
      actionQty: r.on_hand,
      valueImpact: revenue,
      valueLabel: "Revenue unlocked",
      isRealCash: true,
      logicSummary: `Bundle these ${r.on_hand.toLocaleString()} slow-moving units with fast mover ${r.bundle_target.sku} in the same category. The fast mover pulls the slow SKU through at close to full value.`,
      rationale: [
        { label: "On-hand", value: `${r.on_hand.toLocaleString()} units (${dosLabel})` },
        { label: "Bundle partner", value: `${r.bundle_target.sku} — ${r.bundle_target.description}` },
        { label: "Expected sell-through", value: "~100% of cost", hint: "Bundling a stuck SKU with a fast mover in the same category typically clears at close to book value with no markdown." },
        { label: "Revenue unlocked", value: `$${Math.round(revenue).toLocaleString()}`, hint: "Cash comes in as the bundle sells over the next 30–60 days." },
      ],
    };
  }

  // Markdown
  const recovery = tied * 0.75;
  return {
    ...r,
    actionQty: r.on_hand,
    valueImpact: recovery,
    valueLabel: "Cash recovered (est.)",
    isRealCash: true,
    logicSummary: `No sister branch needs these units, supplier will not accept a return, and there is no fast-mover bundle. Clear at a 25% markdown to convert dead stock back into working capital.`,
    rationale: [
      { label: "On-hand", value: `${r.on_hand.toLocaleString()} units (${dosLabel})` },
      { label: "Tied-up capital", value: `$${Math.round(tied).toLocaleString()}` },
      { label: "Markdown depth", value: "25% off cost", hint: "Standard clearance depth to move dead stock within 30–60 days." },
      { label: "Cash recovered", value: `$${Math.round(tied).toLocaleString()} × 0.75 = $${Math.round(recovery).toLocaleString()}`, hint: "Real cash from clearance sales. Recognizes a book loss but frees working capital." },
    ],
  };
}

function RationaleButton({ row }: { row: EnrichedRelease }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1">
          <HelpCircle className="h-3 w-3" /> Why?
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-96">
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Logic — {row.sku} @ {row.branch_name}</div>
            <div className="text-sm mt-1">{row.logicSummary}</div>
          </div>
          <div className="border-t pt-2 space-y-2">
            {row.rationale.map((r, i) => (
              <div key={i} className="text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-medium text-right tabular-nums">{r.value}</span>
                </div>
                {r.hint && <div className="text-[11px] text-muted-foreground italic mt-0.5">{r.hint}</div>}
              </div>
            ))}
          </div>
          {!row.isRealCash && (
            <div className="border-t pt-2 text-[11px] text-amber-700 dark:text-amber-400 flex gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>This dollar amount is <b>inventory repositioned</b>, not cash returning to the bank. The win is preventing a stockout at the receiving branch.</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

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

  // Tick every 30s so "updated Xm ago" refreshes.
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


  const enrichedReleases = useMemo(() => releases.map(enrichRelease), [releases]);

  // Recompute honest totals from the enriched, per-row math.
  const cashRecovered = useMemo(
    () => enrichedReleases.filter((r) => r.isRealCash).reduce((s, r) => s + r.valueImpact, 0),
    [enrichedReleases],
  );
  const capitalRepositioned = useMemo(
    () => enrichedReleases.filter((r) => !r.isRealCash).reduce((s, r) => s + r.valueImpact, 0),
    [enrichedReleases],
  );
  const capitalTied = useMemo(
    () => enrichedReleases.reduce((s, r) => s + r.tied_capital, 0),
    [enrichedReleases],
  );
  const cashNeeded = totals?.cash_needed ?? 0;
  const netFreed = useMemo(() => Math.max(cashRecovered - cashNeeded, 0), [cashRecovered, cashNeeded]);
  const marginLift = useMemo(() => netFreed * 0.35, [netFreed]);

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
    rows.push("Side,SKU,Description,Branch,Qty/OnHand,Action,Dollars");
    releases.forEach((r) => {
      rows.push([
        "Release",
        r.sku,
        JSON.stringify(r.description),
        JSON.stringify(r.branch_name),
        r.on_hand,
        JSON.stringify(`${r.disposition}: ${r.disposition_detail}`),
        Math.round(r.recoverable_cash),
      ].join(","));
    });
    redeploys.forEach((r) => {
      rows.push([
        "Redeploy",
        r.sku,
        JSON.stringify(r.description),
        JSON.stringify(r.branch_name),
        r.units_short,
        JSON.stringify(r.priority_label),
        Math.round(r.cash_needed),
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
      const markdowns = releases
        .filter((r) => r.disposition === "Markdown")
        .map((r) => ({
          product_id: r.product_id,
          branch_id: r.branch_id,
          excess_qty: r.on_hand,
          estimated_value: r.recoverable_cash,
        }));
      const transfers = releases
        .filter((r) => r.disposition === "Transfer" && r.transfer_target)
        .map((r) => ({
          source_branch_id: r.branch_id,
          dest_branch_id: r.transfer_target!.branch_id,
          product_id: r.product_id,
          quantity: Math.min(r.on_hand, r.transfer_target!.units_short),
          status: "pending" as const,
          expected_arrival: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        }));

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
        action_summary: `Freed ~${fmt$(totals?.cash_freed ?? 0)}, redeploying into ${redeploys.length} short SKUs. Created ${transfers.length} transfer(s), ${markdowns.length} markdown(s).`,
        action_payload: { releases, redeploys, totals, generated_at: now } as any,
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

  const transferCount = releases.filter((r) => r.disposition === "Transfer").length;
  const returnCount = releases.filter((r) => r.disposition === "Return").length;
  const bundleCount = releases.filter((r) => r.disposition === "Bundle").length;
  const markdownCount = releases.filter((r) => r.disposition === "Markdown").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SKU Balance</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Recycle capital stuck in dead stock into the fast movers that keep stocking out.
            Every row has a specific disposition — no vague &ldquo;reduce inventory&rdquo; directive.
          </p>
        </div>
      </div>

      {/* Totals bar */}
      <div className="grid gap-3 md:grid-cols-4" data-tour="balance-totals">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Capital in excess</div>
          <div className="text-2xl font-semibold mt-1">{fmt$(totals?.capital_tied ?? 0)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals?.release_count ?? 0} SKUs tied up</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recoverable cash</div>
          <div className="text-2xl font-semibold mt-1 text-emerald-600">{fmt$(totals?.cash_freed ?? 0)}</div>
          <div className="text-xs text-muted-foreground mt-1">After disposition haircut</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Cash to fix stockouts</div>
          <div className="text-2xl font-semibold mt-1">{fmt$(totals?.cash_needed ?? 0)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals?.redeploy_count ?? 0} SKUs below ROP</div>
        </Card>
        <Card className="p-4 border-primary/40 bg-primary/5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Net freed + est. margin lift</div>
          <div className="text-2xl font-semibold mt-1 text-primary">
            {fmt$(netFreed)} <span className="text-base text-muted-foreground">+ {fmt$(marginLift)}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">Working-capital release, next 30–60 days</div>
        </Card>
      </div>

      {/* Loading banner */}
      {loading && (
        <Card className="p-3 flex items-center gap-3 border-primary/30 bg-primary/5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="text-sm">
            Crunching excess stock and stockout risk across the network…
            <span className="text-muted-foreground"> This can take 10–20 seconds on first load.</span>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={generatePlan}
          disabled={planLoading || loading || releases.length === 0}
          data-tour="balance-generate-btn"
        >
          {planLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Generate AI Rebalance Plan
        </Button>
        <Button variant="outline" onClick={exportCsv} disabled={loading || releases.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadData(true)}
          disabled={loading}
          title="Recompute from the latest data"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            Updated {formatAge(lastUpdated)}
          </span>
        )}
        <Button
          variant="default"
          className="ml-auto"
          onClick={() => setConfirmOpen(true)}
          disabled={loading || (releases.length === 0 && redeploys.length === 0)}
        >
          <CheckCircle2 className="h-4 w-4 mr-2" /> Start the Process
        </Button>
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
              <div className="font-semibold">Release <span className="text-muted-foreground font-normal">— excess → cash</span></div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2">
              {transferCount > 0 && <span>{transferCount} transfer</span>}
              {returnCount > 0 && <span>· {returnCount} return</span>}
              {bundleCount > 0 && <span>· {bundleCount} bundle</span>}
              {markdownCount > 0 && <span>· {markdownCount} markdown</span>}
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead className="text-right">Recovers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && releases.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No excess SKUs at this branch.</TableCell></TableRow>
                )}
                {releases.map((r, i) => (
                  <TableRow key={`${r.product_id}-${r.branch_id}-${i}`}>
                    <TableCell>
                      <div className="font-medium">{r.sku}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.description}</div>
                    </TableCell>
                    <TableCell className="text-xs">{r.branch_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.on_hand.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={dispositionColor[r.disposition]}>{r.disposition}</Badge>
                      <div className="text-xs text-muted-foreground mt-1 max-w-[200px]">{r.disposition_detail}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-emerald-600">
                      {fmt$(r.recoverable_cash)}
                    </TableCell>
                  </TableRow>
                ))}
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
            <div className="mt-1 text-xs text-muted-foreground">
              Ranked by 14-day revenue at risk
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Short</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Cash needed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && redeploys.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No stockout risk at this branch.</TableCell></TableRow>
                )}
                {redeploys.map((r, i) => (
                  <TableRow key={`${r.product_id}-${r.branch_id}-${i}`}>
                    <TableCell>
                      <div className="font-medium">{r.sku}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.description}</div>
                    </TableCell>
                    <TableCell className="text-xs">{r.branch_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.units_short.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={priorityColor[r.priority_label]}>{r.priority_label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmt$(r.cash_needed)}
                    </TableCell>
                  </TableRow>
                ))}
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
              Here&rsquo;s exactly what will happen when you click Approve — nothing is sent to any supplier or customer.
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-2">
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span><b>{transferCount}</b> inter-branch transfer(s) created in <b>pending</b> status. Warehouse staff must confirm pick &amp; ship.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span><b>{markdownCount}</b> markdown candidate(s) queued for merchandiser review. No prices change automatically.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span><b>{returnCount}</b> return(s) and <b>{bundleCount}</b> bundle(s) flagged in the plan — these are advisory and require buyer follow-up with the supplier.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary">•</span>
              <span>One entry written to the audit log with the full plan payload for later review.</span>
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
  );
}
