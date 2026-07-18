import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Scale, Sparkles, Loader2, Download, CheckCircle2, ArrowRight, ArrowLeft, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

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

const fmt$ = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
    : `$${Math.round(n).toLocaleString()}`;

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

export default function Balance() {
  const { branchId } = useBranch();
  const [loading, setLoading] = useState(true);
  const [releases, setReleases] = useState<Release[]>([]);
  const [redeploys, setRedeploys] = useState<Redeploy[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [plan, setPlan] = useState<string>("");
  const [planLoading, setPlanLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPlan("");
      const { data, error } = await supabase.rpc("sku_balance_plan" as any, {
        p_branch_id: branchId === "all" ? null : branchId,
      });
      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error("Failed to load rebalance data");
        setLoading(false);
        return;
      }
      const d = (data ?? {}) as any;
      setReleases((d.releases ?? []) as Release[]);
      setRedeploys((d.redeploys ?? []) as Redeploy[]);
      setTotals((d.totals ?? null) as Totals | null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  const netFreed = useMemo(
    () => Math.max((totals?.cash_freed ?? 0) - (totals?.cash_needed ?? 0), 0),
    [totals],
  );
  const marginLift = useMemo(() => netFreed * 0.35, [netFreed]); // assumed 35% margin on redeploy

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
          variant="default"
          className="ml-auto"
          onClick={() => setConfirmOpen(true)}
          disabled={loading || (releases.length === 0 && redeploys.length === 0)}
        >
          <CheckCircle2 className="h-4 w-4 mr-2" /> Approve Plan
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
