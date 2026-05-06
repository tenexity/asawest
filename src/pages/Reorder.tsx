import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { RefreshCw, Sparkles, Snowflake, Tag, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Rec = {
  id: string; product_id: string; branch_id: string; supplier_id: string | null;
  urgency: "critical" | "high" | "medium" | "low";
  avg_daily_demand: number; demand_stddev: number; recent_max_day: number;
  lead_time_days: number; lead_time_var_days: number;
  service_level: number; z_score: number;
  safety_stock: number; reorder_point: number;
  on_hand: number; on_order: number; days_of_supply: number | null;
  suggested_qty: number; moq: number;
  seasonality_boost: boolean; seasonality_pattern: string | null;
  rebate_opportunity: boolean; rebate_threshold: number | null; rebate_bumped_qty: number | null;
  unit_cost: number; financial_impact: number;
  status: "open" | "approved" | "rejected" | "snoozed";
  snoozed_until: string | null;
};
type Product = { id: string; sku: string; description: string; category: string };
type Branch = { id: string; name: string };
type Supplier = { id: string; name: string };

const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const urgencyClass: Record<Rec["urgency"], string> = {
  critical: "bg-danger text-danger-foreground border-transparent",
  high: "bg-warning/20 text-warning border-warning/40",
  medium: "bg-warning/10 text-warning border-warning/30",
  low: "bg-muted text-muted-foreground border-border",
};

export default function Reorder() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [branchFilter, setBranchFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [seasonalOnly, setSeasonalOnly] = useState(false);
  const [rebateOnly, setRebateOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [whyId, setWhyId] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<string>("");
  const [narrativeLoading, setNarrativeLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [rRes, pRes, bRes, sRes] = await Promise.all([
      supabase.from("reorder_recommendations").select("*").neq("status", "rejected").limit(2000),
      supabase.from("products").select("id, sku, description, category").limit(20000),
      supabase.from("branches").select("id, name"),
      supabase.from("suppliers").select("id, name"),
    ]);
    setRecs((rRes.data ?? []) as Rec[]);
    const pmap = new Map<string, Product>();
    for (const p of (pRes.data ?? []) as Product[]) pmap.set(p.id, p);
    setProducts(pmap);
    setBranches((bRes.data ?? []) as Branch[]);
    setSuppliers((sRes.data ?? []) as Supplier[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runPass() {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("compute-reorder-recommendations", {});
    setRunning(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Generated ${data?.summary?.total ?? 0} recommendations`);
    load();
  }

  async function setStatus(ids: string[], status: Rec["status"], snoozeDays?: number) {
    const patch: any = { status };
    if (status === "snoozed" && snoozeDays) {
      const d = new Date(); d.setDate(d.getDate() + snoozeDays);
      patch.snoozed_until = d.toISOString().slice(0, 10);
    }
    const { error } = await supabase.from("reorder_recommendations").update(patch).in("id", ids);
    if (error) { toast.error(error.message); return; }
    setRecs(recs.filter(r => !ids.includes(r.id)));
    setSelected(new Set());
  }

  async function createPOsFromSelected() {
    const sel = recs.filter(r => selected.has(r.id) && r.supplier_id);
    if (!sel.length) { toast.error("Select rows with a primary supplier"); return; }
    const groups = new Map<string, Rec[]>();
    for (const r of sel) {
      const key = `${r.supplier_id}|${r.branch_id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const today = new Date().toISOString().slice(0, 10);
    let created = 0;
    for (const items of groups.values()) {
      const expected = new Date(); expected.setDate(expected.getDate() + items[0].lead_time_days);
      const { data: po, error } = await supabase.from("purchase_orders").insert({
        supplier_id: items[0].supplier_id!, branch_id: items[0].branch_id,
        ordered_date: today, expected_date: expected.toISOString().slice(0, 10),
        status: "draft",
      }).select("id").single();
      if (error || !po) { toast.error(error?.message ?? "PO failed"); continue; }
      await supabase.from("purchase_order_items").insert(items.map(it => ({
        po_id: po.id, product_id: it.product_id, quantity: it.suggested_qty, unit_cost: it.unit_cost,
      })));
      created++;
    }
    await setStatus(sel.map(r => r.id), "approved");
    toast.success(`Created ${created} draft PO${created === 1 ? "" : "s"}`);
  }

  const filtered = useMemo(() => {
    const branchMap = new Map(branches.map(b => [b.id, b.name]));
    const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
    const ql = search.trim().toLowerCase();
    return recs
      .filter(r => {
        const p = products.get(r.product_id);
        if (branchFilter !== "all" && r.branch_id !== branchFilter) return false;
        if (supplierFilter !== "all" && r.supplier_id !== supplierFilter) return false;
        if (urgencyFilter !== "all" && r.urgency !== urgencyFilter) return false;
        if (categoryFilter !== "all" && p?.category !== categoryFilter) return false;
        if (seasonalOnly && !r.seasonality_boost) return false;
        if (rebateOnly && !r.rebate_opportunity) return false;
        if (ql && !(p?.sku.toLowerCase().includes(ql) || p?.description.toLowerCase().includes(ql))) return false;
        return true;
      })
      .map(r => ({
        ...r,
        _sku: products.get(r.product_id)?.sku ?? "—",
        _desc: products.get(r.product_id)?.description ?? "",
        _branch: branchMap.get(r.branch_id) ?? "—",
        _supplier: r.supplier_id ? supplierMap.get(r.supplier_id) ?? "—" : "—",
      }))
      .sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || b.financial_impact - a.financial_impact);
  }, [recs, products, branches, suppliers, branchFilter, supplierFilter, urgencyFilter, categoryFilter, seasonalOnly, rebateOnly, search]);

  const summary = useMemo(() => {
    const s = { critical: 0, high: 0, medium: 0, low: 0, total: 0, value: 0 };
    for (const r of recs) {
      s[r.urgency]++; s.total++; s.value += r.financial_impact;
    }
    return s;
  }, [recs]);

  const categories = useMemo(
    () => Array.from(new Set(Array.from(products.values()).map(p => p.category))).sort(),
    [products],
  );

  async function openWhy(id: string) {
    setWhyId(id);
    setNarrative("");
    setNarrativeLoading(true);
    const { data, error } = await supabase.functions.invoke("explain-recommendation", {
      body: { recommendation_id: id },
    });
    setNarrativeLoading(false);
    if (error) { toast.error(error.message); return; }
    setNarrative(data?.narrative ?? "");
  }

  const whyRec = whyId ? recs.find(r => r.id === whyId) : null;
  const whyProduct = whyRec ? products.get(whyRec.product_id) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reorder Recommendations</h1>
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${filtered.length.toLocaleString()} of ${recs.length.toLocaleString()} open recommendations`}
        </p>
      </div>

      {/* Summary */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-6">
          <SummaryStat label="Critical" value={summary.critical} className="text-danger" />
          <SummaryStat label="High" value={summary.high} className="text-warning" />
          <SummaryStat label="Medium" value={summary.medium} />
          <SummaryStat label="Low" value={summary.low} />
          <div className="h-10 w-px bg-border" />
          <SummaryStat label="Total recommendations" value={summary.total} />
          <SummaryStat label="Total $ suggested" value={`$${summary.value.toLocaleString()}`} />
          <Button onClick={runPass} disabled={running} className="ml-auto">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run Recommendation Pass
          </Button>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search SKU or description…" value={search} onChange={e => setSearch(e.target.value)} className="h-9 w-[240px]" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Branch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Supplier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All suppliers</SelectItem>
            {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="Urgency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgency</SelectItem>
            {(["critical", "high", "medium", "low"] as const).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <TooltipProvider>
          <div className="flex items-center gap-2 ml-2">
            <Switch id="seasonal" checked={seasonalOnly} onCheckedChange={setSeasonalOnly} />
            <Label htmlFor="seasonal" className="text-sm">Seasonal only</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What is seasonal only?">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Show only SKUs whose next 30 days fall in their peak season — cooling (May–Aug), heating (Nov–Feb), or freeze events (Dec–Feb at freeze-prone branches). For these, expected daily demand is multiplied by 2.5× when sizing the order.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="rebate" checked={rebateOnly} onCheckedChange={setRebateOnly} />
            <Label htmlFor="rebate" className="text-sm">Rebate only</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What is rebate only?">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Show only SKUs where the suggested quantity is within 15% of a supplier rebate threshold (5× or 10× MOQ). Bumping the order a little can unlock a volume rebate — the "Why" modal shows the exact threshold and bumped quantity.
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
        {selected.size > 0 && (
          <Button size="sm" className="ml-auto" onClick={createPOsFromSelected}>
            Create PO from {selected.size} selected
          </Button>
        )}
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <div className="max-h-[calc(100vh-360px)] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">DoS</TableHead>
                <TableHead className="text-right">ROP</TableHead>
                <TableHead className="text-right">Suggested</TableHead>
                <TableHead className="text-right">$ Impact</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Lead</TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 500).map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(selected);
                        v ? n.add(r.id) : n.delete(r.id);
                        setSelected(n);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={cn("text-xs capitalize", urgencyClass[r.urgency])}>{r.urgency}</Badge>
                      {r.seasonality_boost && <Snowflake className="h-3 w-3 text-primary" aria-label="Seasonality boost" />}
                      {r.rebate_opportunity && <Tag className="h-3 w-3 text-success" aria-label="Rebate opportunity" />}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r._sku}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-xs">{r._desc}</TableCell>
                  <TableCell className="text-xs">{r._branch}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.on_hand}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.days_of_supply ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.reorder_point}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.suggested_qty}</TableCell>
                  <TableCell className="text-right tabular-nums">${r.financial_impact.toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r._supplier}</TableCell>
                  <TableCell className="text-right text-xs">{r.lead_time_days}d</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => openWhy(r.id)}>
                      <Info className="h-3.5 w-3.5 mr-1" /> Why
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setStatus([r.id], "approved")}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus([r.id], "snoozed", 7)}>Snooze</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus([r.id], "rejected")}>Reject</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-10">
                    No recommendations. Click "Run Recommendation Pass" to compute them.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {filtered.length > 500 && (
            <div className="text-xs text-muted-foreground text-center py-2 border-t">
              Showing first 500 of {filtered.length.toLocaleString()} — refine filters to narrow.
            </div>
          )}
        </div>
      </Card>

      {/* Why dialog */}
      <Dialog open={!!whyId} onOpenChange={(o) => { if (!o) setWhyId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Why this recommendation?</DialogTitle>
            <DialogDescription>
              {whyProduct?.sku} · {branches.find(b => b.id === whyRec?.branch_id)?.name ?? ""}
            </DialogDescription>
          </DialogHeader>
          {whyRec && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Avg daily demand" value={Number(whyRec.avg_daily_demand).toFixed(2)} />
                <Stat label="Std dev" value={Number(whyRec.demand_stddev).toFixed(2)} />
                <Stat label="Recent max day" value={String(whyRec.recent_max_day)} />
                <Stat label="Lead time" value={`${whyRec.lead_time_days}d ± ${whyRec.lead_time_var_days}d`} />
                <Stat label="Service level" value={`${(Number(whyRec.service_level) * 100).toFixed(0)}% (z=${Number(whyRec.z_score).toFixed(2)})`} />
                <Stat label="Safety stock" value={String(whyRec.safety_stock)} />
                <Stat label="Reorder point" value={String(whyRec.reorder_point)} />
                <Stat label="On hand / on order" value={`${whyRec.on_hand} / ${whyRec.on_order}`} />
                <Stat label="Days of supply" value={whyRec.days_of_supply?.toString() ?? "—"} />
                <Stat label="Suggested qty (MOQ)" value={`${whyRec.suggested_qty} (MOQ ${whyRec.moq})`} />
              </div>
              {whyRec.seasonality_boost && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                  <div className="font-medium inline-flex items-center gap-1"><Snowflake className="h-3 w-3" /> Seasonality boost applied</div>
                  Pattern: <span className="font-mono">{whyRec.seasonality_pattern}</span> — daily demand multiplied by 2.5× because the next 30 days fall in this SKU's peak window.
                </div>
              )}
              {whyRec.rebate_opportunity && (
                <div className="rounded-md border border-success/30 bg-success/5 p-3 text-xs">
                  <div className="font-medium inline-flex items-center gap-1"><Tag className="h-3 w-3" /> Rebate opportunity</div>
                  Suggested {whyRec.suggested_qty} is within 15% of rebate threshold {whyRec.rebate_threshold}. Bumping to {whyRec.rebate_bumped_qty} unlocks the rebate.
                </div>
              )}
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="font-medium text-xs inline-flex items-center gap-1 mb-1">
                  <Sparkles className="h-3 w-3" /> Analyst note
                </div>
                <p className="text-sm text-muted-foreground">
                  {narrativeLoading ? "Generating…" : narrative || "—"}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", className)}>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
