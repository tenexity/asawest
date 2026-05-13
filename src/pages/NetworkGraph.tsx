import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Factory,
  Package,
  Warehouse,
  Users,
  Loader2,
  Play,
  RotateCcw,
  Save,
  AlertTriangle,
  Building2,
  DollarSign,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface GraphData {
  suppliers: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  categories: string[];
  customer_types: string[];
  supplier_category: Record<string, number>;
  category_branch: Record<string, number>;
  branch_customer: Record<string, number>;
}

const COL = {
  supplier: { bg: "hsl(239 84% 67%)", text: "#fff" },
  category: { bg: "hsl(220 9% 46%)", text: "#fff" },
  branch: { bg: "hsl(160 84% 39%)", text: "#fff" },
  customer: { bg: "hsl(38 92% 50%)", text: "#000" },
};

export default function NetworkGraph() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [selected, setSelected] = useState<{ label: string; meta: any } | null>(null);

  // Simulator
  const [supplierId, setSupplierId] = useState<string>("");
  const [delay, setDelay] = useState(7);
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<string>("");
  const [recLoading, setRecLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("network-graph");
      if (error) toast.error("Failed to load graph");
      else setGraph(data as GraphData);
      setLoading(false);
    })();
  }, []);

  // Default supplier = largest spend
  useEffect(() => {
    if (!graph || supplierId) return;
    const totals = new Map<string, number>();
    for (const [k, v] of Object.entries(graph.supplier_category)) {
      const [sid] = k.split("|");
      totals.set(sid, (totals.get(sid) ?? 0) + v);
    }
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) setSupplierId(top[0]);
  }, [graph, supplierId]);

  const { nodes: computedNodes, edges: computedEdges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Filter helpers
    const passBranch = (b: string) => filterBranch === "all" || b === filterBranch;
    const passCat = (c: string) => filterCategory === "all" || c === filterCategory;

    // Per-tier "critical" thresholds, computed within the *currently visible* subset
    // (after branch/category filters). The three edge types are on very different
    // dollar scales, and a global threshold also wipes out most edges as soon as
    // the user narrows to a single category.
    const topPct = (vals: number[], pct = 0.2) => {
      if (!vals.length) return 0;
      const sorted = [...vals].sort((a, b) => b - a);
      return sorted[Math.max(0, Math.floor(sorted.length * pct) - 1)] ?? 0;
    };
    const visibleSC = Object.entries(graph.supplier_category)
      .filter(([k]) => {
        const [, cat] = k.split("|");
        return filterCategory === "all" || cat === filterCategory;
      })
      .map(([, w]) => w);
    const visibleCB = Object.entries(graph.category_branch)
      .filter(([k]) => {
        const [cat, bid] = k.split("|");
        return (filterCategory === "all" || cat === filterCategory) &&
               (filterBranch === "all" || bid === filterBranch);
      })
      .map(([, w]) => w);
    const visibleBC = Object.entries(graph.branch_customer)
      .filter(([k]) => {
        const [bid] = k.split("|");
        return filterBranch === "all" || bid === filterBranch;
      })
      .map(([, w]) => w);
    const scThreshold = topPct(visibleSC);
    const cbThreshold = topPct(visibleCB);
    const bcThreshold = topPct(visibleBC);

    const colSupplier = 0;
    const colCategory = 380;
    const colBranch = 760;
    const colCustomer = 1140;

    const nodeStyle = (color: string, textColor: string) => ({
      background: color,
      color: textColor,
      border: "none",
      borderRadius: 10,
      padding: 10,
      width: 180,
      fontSize: 12,
      fontWeight: 600,
    });

    const usedSuppliers = new Set<string>();
    const usedCategories = new Set<string>();
    const usedBranches = new Set<string>();
    const usedCustomers = new Set<string>();

    // Edges: supplier -> category
    // When a single category is selected, only show suppliers that
    // contribute meaningfully (top 10 by spend AND >= 2% of category total)
    // so the graph isn't a wall of noise from every supplier that carries 1 SKU.
    const supplierCatEntries = Object.entries(graph.supplier_category)
      .map(([k, w]) => {
        const [sid, cat] = k.split("|");
        return { k, sid, cat, w };
      });
    let allowedSC = new Set(supplierCatEntries.map((e) => e.k));
    if (filterCategory !== "all") {
      const inCat = supplierCatEntries.filter((e) => e.cat === filterCategory);
      const totalCatSpend = inCat.reduce((s, e) => s + e.w, 0);
      const minShare = totalCatSpend * 0.02;
      const top = inCat
        .filter((e) => e.w >= minShare)
        .sort((a, b) => b.w - a.w)
        .slice(0, 10);
      allowedSC = new Set(top.map((e) => e.k));
    }
    for (const { k, sid, cat, w } of supplierCatEntries) {
      if (!passCat(cat)) continue;
      if (!allowedSC.has(k)) continue;
      if (criticalOnly && w < scThreshold) continue;
      usedSuppliers.add(sid);
      usedCategories.add(cat);
      edges.push({
        id: `sc-${sid}-${cat}`,
        source: `s-${sid}`,
        target: `c-${cat}`,
        animated: false,
        style: { strokeWidth: Math.max(1, Math.log10(w + 1)), stroke: "hsl(239 84% 67% / 0.5)" },
        data: { weight: w, label: `$${Math.round(w).toLocaleString()}` },
        label: `$${Math.round(w / 1000)}k`,
        labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
      });
    }
    // category -> branch
    for (const [k, w] of Object.entries(graph.category_branch)) {
      const [cat, bid] = k.split("|");
      if (!passCat(cat) || !passBranch(bid)) continue;
      if (criticalOnly && w < cbThreshold) continue;
      usedCategories.add(cat);
      usedBranches.add(bid);
      edges.push({
        id: `cb-${cat}-${bid}`,
        source: `c-${cat}`,
        target: `b-${bid}`,
        style: { strokeWidth: Math.max(1, Math.log10(w + 1)), stroke: "hsl(160 84% 39% / 0.5)" },
        data: { weight: w },
        label: `$${Math.round(w / 1000)}k`,
        labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
      });
    }
    // branch -> customer
    for (const [k, w] of Object.entries(graph.branch_customer)) {
      const [bid, ct] = k.split("|");
      if (!passBranch(bid)) continue;
      if (criticalOnly && w < bcThreshold) continue;
      usedBranches.add(bid);
      usedCustomers.add(ct);
      edges.push({
        id: `bc-${bid}-${ct}`,
        source: `b-${bid}`,
        target: `cu-${ct}`,
        style: { strokeWidth: Math.max(1, Math.log10(w + 1)), stroke: "hsl(38 92% 50% / 0.55)" },
        data: { weight: w },
        label: `$${Math.round(w / 1000)}k`,
        labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
      });
    }

    const supList = graph.suppliers.filter((s) => usedSuppliers.has(s.id));
    const catList = graph.categories.filter((c) => usedCategories.has(c));
    const brList = graph.branches.filter((b) => usedBranches.has(b.id));
    const cuList = graph.customer_types.filter((c) => usedCustomers.has(c));

    const space = (count: number, i: number) => 80 + i * 90;

    supList.forEach((s, i) =>
      nodes.push({
        id: `s-${s.id}`,
        position: { x: colSupplier, y: space(supList.length, i) },
        data: { label: `🏭 ${s.name}`, type: "supplier", meta: s },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: nodeStyle(COL.supplier.bg, COL.supplier.text),
      })
    );
    const catTotals = new Map<string, number>();
    for (const [k, w] of Object.entries(graph.category_branch)) {
      const [cat] = k.split("|");
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + w);
    }
    const fmtK = (n: number) =>
      n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;
    catList.forEach((c, i) => {
      const total = catTotals.get(c) ?? 0;
      nodes.push({
        id: `c-${c}`,
        position: { x: colCategory, y: space(catList.length, i) },
        data: {
          label: `📦 ${c}  ·  ${fmtK(total)}`,
          type: "category",
          meta: { category: c, total_flow: total },
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: nodeStyle(COL.category.bg, COL.category.text),
      });
    });
    brList.forEach((b, i) =>
      nodes.push({
        id: `b-${b.id}`,
        position: { x: colBranch, y: space(brList.length, i) },
        data: { label: `🏬 ${b.name}`, type: "branch", meta: b },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: nodeStyle(COL.branch.bg, COL.branch.text),
      })
    );
    cuList.forEach((c, i) =>
      nodes.push({
        id: `cu-${c}`,
        position: { x: colCustomer, y: space(cuList.length, i) },
        data: { label: `👥 ${c}`, type: "customer", meta: { customer_type: c } },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: nodeStyle(COL.customer.bg, COL.customer.text),
      })
    );

    // markers
    edges.forEach((e) => {
      e.markerEnd = { type: MarkerType.ArrowClosed };
    });

    return { nodes, edges };
  }, [graph, filterBranch, filterCategory, criticalOnly]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes, setNodes]);

  useEffect(() => {
    setEdges(computedEdges);
  }, [computedEdges, setEdges]);

  const runSimulation = async () => {
    if (!supplierId) return;
    setSimRunning(true);
    setSimResult(null);
    setRecommendations("");
    const minDelay = new Promise((r) => setTimeout(r, 1200));
    const [{ data, error }] = await Promise.all([
      supabase.functions.invoke("simulate-disruption", { body: { supplier_id: supplierId, delay_days: delay } }),
      minDelay,
    ]);
    setSimRunning(false);
    if (error) {
      toast.error("Simulation failed");
      return;
    }
    setSimResult(data);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

    // Trigger recommendations
    setRecLoading(true);
    const { data: rec } = await supabase.functions.invoke("recommend-actions", {
      body: { summary: data.summary, top_at_risk: data.at_risk.slice(0, 20) },
    });
    setRecommendations(rec?.recommendations ?? "Unable to generate recommendations.");
    setRecLoading(false);
  };

  const reset = () => {
    setSimResult(null);
    setRecommendations("");
  };

  const saveScenario = async () => {
    if (!simResult) return;
    const supplierName = graph?.suppliers.find((s) => s.id === supplierId)?.name ?? "Unknown";
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      toast.error("Sign in to save");
      return;
    }
    const { error } = await supabase.from("saved_simulations").insert({
      user_id: u.user.id,
      name: `${supplierName} +${delay}d`,
      supplier_id: supplierId,
      delay_days: delay,
      result: simResult,
    });
    if (error) toast.error(error.message);
    else toast.success("Scenario saved");
  };

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Network Graph</h1>
          <p className="text-sm text-muted-foreground italic mt-1">
            See how money and product flow across your supply chain — and what breaks when one link fails.
          </p>
        </div>
        <Card className="bg-muted/30">
          <CardContent className="pt-5 pb-5 text-sm space-y-2">
            <div className="font-medium">What am I looking at?</div>
            <p className="text-muted-foreground">
              A left-to-right map of your business: <span className="font-medium text-foreground">Suppliers</span> ship product
              to <span className="font-medium text-foreground">Categories</span>, which stock your{" "}
              <span className="font-medium text-foreground">Branches</span>, which sell to{" "}
              <span className="font-medium text-foreground">Customer Types</span>. Thicker lines = more dollars flowing through that link.
            </p>
            <div className="font-medium pt-2">Why it matters</div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Spot <span className="font-medium text-foreground">concentration risk</span> — suppliers or branches your business leans on heavily.</li>
              <li>Use the <span className="font-medium text-foreground">Disruption Simulator</span> below to model "what if Supplier X is delayed 7 days?" and see exact SKUs, branches, and revenue at risk.</li>
              <li>Click any node to inspect its connections; drag to rearrange the layout for a clearer view. Nodes reflect your live data — they aren't manually added or deleted here.</li>
            </ul>
          </CardContent>
        </Card>
      </header>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Branch</Label>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {graph?.branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Category</Label>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {graph?.categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="crit" checked={criticalOnly} onCheckedChange={setCriticalOnly} />
            <Label htmlFor="crit" className="text-xs">Critical path only (top 20%)</Label>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <LegendDot color={COL.supplier.bg} icon={<Factory className="h-3 w-3" />} label="Supplier" />
            <LegendDot color={COL.category.bg} icon={<Package className="h-3 w-3" />} label="Category" />
            <LegendDot color={COL.branch.bg} icon={<Warehouse className="h-3 w-3" />} label="Branch" />
            <LegendDot color={COL.customer.bg} icon={<Users className="h-3 w-3" />} label="Customer Type" />
            <span>· edge thickness = $ flow</span>
          </div>
        </CardContent>
      </Card>

      {/* Graph */}
      <div className="h-[560px] border rounded-lg bg-card">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            onNodeClick={(_, n: any) =>
              setSelected({ label: n.data.label, meta: n.data })
            }
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        )}
      </div>

      {/* Simulator */}
      <Card className="border-t-4 border-t-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Disruption Simulator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Pick supplier" /></SelectTrigger>
                <SelectContent>
                  {graph?.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Delay: {delay} days</Label>
              <Slider value={[delay]} min={1} max={30} step={1} onValueChange={(v) => setDelay(v[0])} />
            </div>
            <Button size="lg" onClick={runSimulation} disabled={simRunning || !supplierId}>
              {simRunning ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…</>
              ) : (
                <><Play className="h-4 w-4 mr-2" /> Run Simulation</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <div ref={resultRef}>
        {simResult && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {/* Top metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <BigStat
                icon={<AlertTriangle className="h-5 w-5" />}
                label="SKUs at Risk"
                value={simResult.summary.skus_at_risk.toLocaleString()}
                tone="danger"
              />
              <BigStat
                icon={<Package className="h-5 w-5" />}
                label="Units Affected"
                value={simResult.summary.units_affected.toLocaleString()}
                tone="warning"
              />
              <BigStat
                icon={<Building2 className="h-5 w-5" />}
                label="Branches Hit"
                value={simResult.summary.branches_hit.toLocaleString()}
                tone="warning"
              />
              <BigStat
                icon={<DollarSign className="h-5 w-5" />}
                label="Revenue at Risk"
                value={`$${simResult.summary.revenue_at_risk.toLocaleString()}`}
                tone="danger"
              />
            </div>

            {/* Heatmap */}
            <Card>
              <CardHeader><CardTitle className="text-base">Severity Heat Map (Branch × Category)</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-start">
                  <Heatmap data={simResult.summary.heatmap} />
                  <HeatmapSummary
                    data={simResult.summary.heatmap}
                    supplierName={simResult.summary.supplier_name}
                    delayDays={simResult.summary.delay_days}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Top 20 table */}
            <Card>
              <CardHeader><CardTitle className="text-base">Top 20 At-Risk SKUs</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead className="text-right">On Hand</TableHead>
                        <TableHead className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help underline decoration-dotted">Days→Out</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <p className="font-semibold mb-1">Days until stockout</p>
                              <p>Projected day when on-hand inventory hits zero, given:</p>
                              <p className="mt-1 font-mono">on_hand − (avg_daily_demand × day) + on_order (arrives at lead_time + delay)</p>
                              <p className="mt-1">Demand uses 90-day average per branch, with a ×2.5 boost in active seasonal months.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help underline decoration-dotted">Units Short</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <p className="font-semibold mb-1">Units short over horizon</p>
                              <p>Day-by-day projected lost sales after on-hand inventory and incoming orders are consumed.</p>
                              <p className="mt-1">Horizon = lead time + delay days + 14 days of buffer demand.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableHead>
                        <TableHead className="text-right">Revenue Risk</TableHead>
                        <TableHead>Recommended Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {simResult.at_risk.slice(0, 20).map((r: any) => (
                        <TableRow key={`${r.product_id}-${r.branch_id}`}>
                          <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                          <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                          <TableCell>{r.branch_name}</TableCell>
                          <TableCell className="text-right">{r.on_hand}</TableCell>
                          <TableCell className="text-right">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant={r.is_stockout ? "destructive" : "outline"} className="cursor-help">{r.days_to_stockout}</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                <p className="font-semibold mb-1">{r.is_stockout ? "Projected stockout" : "Below safety stock"} on day {r.days_to_stockout}</p>
                                <p>On hand: <b>{r.on_hand}</b> · Safety stock: <b>{r.safety_stock}</b></p>
                                <p>Avg daily demand: <b>{r.avg_daily_demand}</b> units (90-day, branch-level)</p>
                                <p className="mt-1">Replenishment PO arrives at lead time + {simResult.summary.delay_days}d delay. {r.is_stockout ? "Inflow is too late or too small to prevent zero." : "Inventory dips below safety stock but doesn't hit zero in horizon."}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help underline decoration-dotted">{r.units_short}</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                <p className="font-semibold mb-1">Shortfall over horizon</p>
                                <p>Projected unfilled demand over the simulation horizon: <b>{r.units_short}</b> units.</p>
                                <p className="mt-1">At ${r.unit_price.toFixed(2)}/unit → ${r.revenue_at_risk.toLocaleString()} revenue exposed.</p>
                                {r.transfer_branch && (
                                  <p className="mt-1 text-emerald-600">{r.transfer_units} units of surplus available at {r.transfer_branch}.</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right font-medium">${r.revenue_at_risk.toLocaleString()}</TableCell>
                          <TableCell className="text-xs">
                            {r.recommended_action}
                            {r.transfer_branch && (
                              <div className="text-emerald-600">↪ Transfer {r.transfer_units} from {r.transfer_branch}</div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Recommendations */}
            <Card className="border-l-4 border-l-primary">
              <CardHeader><CardTitle className="text-base">Recommended Actions (AI)</CardTitle></CardHeader>
              <CardContent>
                {recLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Generating recommendations…
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{recommendations}</pre>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}><RotateCcw className="h-4 w-4 mr-2" />Reset</Button>
              <Button variant="secondary" onClick={saveScenario}><Save className="h-4 w-4 mr-2" />Save Scenario</Button>
            </div>
          </div>
        )}
      </div>

      {/* Side panel */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.label}</SheetTitle>
          </SheetHeader>
          {selected && graph && (() => {
            const type = selected.meta?.type as string;
            const meta = selected.meta?.meta ?? {};
            const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

            const inflows: { label: string; value: number }[] = [];
            const outflows: { label: string; value: number }[] = [];
            let total = 0;

            if (type === "supplier") {
              for (const [k, v] of Object.entries(graph.supplier_category)) {
                const [sid, cat] = k.split("|");
                if (sid === meta.id) { outflows.push({ label: cat, value: v }); total += v; }
              }
            } else if (type === "category") {
              for (const [k, v] of Object.entries(graph.supplier_category)) {
                const [sid, cat] = k.split("|");
                if (cat === meta.category) {
                  const name = graph.suppliers.find((s) => s.id === sid)?.name ?? sid;
                  inflows.push({ label: name, value: v });
                }
              }
              for (const [k, v] of Object.entries(graph.category_branch)) {
                const [cat, bid] = k.split("|");
                if (cat === meta.category) {
                  const name = graph.branches.find((b) => b.id === bid)?.name ?? bid;
                  outflows.push({ label: name, value: v }); total += v;
                }
              }
            } else if (type === "branch") {
              for (const [k, v] of Object.entries(graph.category_branch)) {
                const [cat, bid] = k.split("|");
                if (bid === meta.id) inflows.push({ label: cat, value: v });
              }
              for (const [k, v] of Object.entries(graph.branch_customer)) {
                const [bid, ct] = k.split("|");
                if (bid === meta.id) { outflows.push({ label: ct, value: v }); total += v; }
              }
            } else if (type === "customer") {
              for (const [k, v] of Object.entries(graph.branch_customer)) {
                const [bid, ct] = k.split("|");
                if (ct === meta.customer_type) {
                  const name = graph.branches.find((b) => b.id === bid)?.name ?? bid;
                  inflows.push({ label: name, value: v }); total += v;
                }
              }
            }

            inflows.sort((a, b) => b.value - a.value);
            outflows.sort((a, b) => b.value - a.value);

            const typeLabel = {
              supplier: "Supplier",
              category: "Product category",
              branch: "Branch",
              customer: "Customer type",
            }[type] ?? type;

            const inboundLabel = {
              supplier: null,
              category: "Supplied by",
              branch: "Stocked from categories",
              customer: "Served by branches",
            }[type];
            const outboundLabel = {
              supplier: "Supplies categories",
              category: "Distributed to branches",
              branch: "Sells to customer types",
              customer: null,
            }[type];

            return (
              <div className="mt-4 space-y-5 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{typeLabel}</Badge>
                  {total > 0 && (
                    <span className="text-muted-foreground text-xs">
                      ~{fmt(total)} flowing through (90d)
                    </span>
                  )}
                </div>

                {inboundLabel && (
                  <div>
                    <div className="font-medium mb-2">{inboundLabel}</div>
                    {inflows.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No upstream connections.</div>
                    ) : (
                      <ul className="space-y-1">
                        {inflows.slice(0, 10).map((r) => (
                          <li key={r.label} className="flex justify-between gap-3 border-b py-1">
                            <span className="truncate">{r.label}</span>
                            <span className="text-muted-foreground tabular-nums">{fmt(r.value)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {outboundLabel && (
                  <div>
                    <div className="font-medium mb-2">{outboundLabel}</div>
                    {outflows.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No downstream connections.</div>
                    ) : (
                      <ul className="space-y-1">
                        {outflows.slice(0, 10).map((r) => (
                          <li key={r.label} className="flex justify-between gap-3 border-b py-1">
                            <span className="truncate">{r.label}</span>
                            <span className="text-muted-foreground tabular-nums">{fmt(r.value)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {type === "supplier" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setSupplierId(meta.id);
                      setSelected(null);
                      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
                    }}
                  >
                    <Play className="h-3 w-3 mr-2" /> Simulate disruption for this supplier
                  </Button>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LegendDot({ color, icon, label }: { color: string; icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center justify-center h-4 w-4 rounded" style={{ background: color, color: "#fff" }}>
        {icon}
      </span>
      {label}
    </span>
  );
}

function BigStat({
  icon, label, value, tone,
}: { icon: React.ReactNode; label: string; value: string; tone: "danger" | "warning" }) {
  const toneCls =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : "border-amber-500/40 bg-amber-500/5 text-amber-600";
  return (
    <Card className={`${toneCls} border-2`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide font-medium opacity-80">{label}</span>
          {icon}
        </div>
        <div className="text-3xl font-bold mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}

function Heatmap({ data }: { data: Record<string, Record<string, number>> }) {
  const branches = Object.keys(data);
  const cats = [...new Set(branches.flatMap((b) => Object.keys(data[b])))];
  if (!branches.length) return <p className="text-sm text-muted-foreground">No risk concentration to map.</p>;
  const max = Math.max(1, ...branches.flatMap((b) => cats.map((c) => data[b][c] ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th></th>
            {cats.map((c) => <th key={c} className="px-2 py-1 text-left font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b}>
              <td className="pr-3 font-medium">{b}</td>
              {cats.map((c) => {
                const v = data[b][c] ?? 0;
                const intensity = v / max;
                return (
                  <td key={c} className="p-0">
                    <div
                      className="h-9 w-16 grid place-items-center text-[11px] font-medium"
                      style={{
                        background: v ? `hsl(0 75% ${85 - intensity * 45}%)` : "hsl(var(--muted))",
                        color: intensity > 0.5 ? "white" : "hsl(var(--foreground))",
                      }}
                    >
                      {v || ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatmapSummary({
  data,
  supplierName,
  delayDays,
}: {
  data: Record<string, Record<string, number>>;
  supplierName: string;
  delayDays: number;
}) {
  const branches = Object.keys(data);
  if (!branches.length) {
    return <p className="text-sm text-muted-foreground">No risk concentration to summarize.</p>;
  }
  const cats = [...new Set(branches.flatMap((b) => Object.keys(data[b])))];

  // Per-branch totals
  const branchTotals = branches.map((b) => ({
    name: b,
    total: cats.reduce((s, c) => s + (data[b][c] ?? 0), 0),
  }));
  branchTotals.sort((a, b) => b.total - a.total);
  const hotBranch = branchTotals[0];

  // Per-category totals
  const catTotals = cats.map((c) => ({
    name: c,
    total: branches.reduce((s, b) => s + (data[b][c] ?? 0), 0),
  }));
  catTotals.sort((a, b) => b.total - a.total);
  const hotCat = catTotals[0];

  // Hottest single cell
  let hotCell = { branch: "", cat: "", v: 0 };
  for (const b of branches) {
    for (const c of cats) {
      const v = data[b][c] ?? 0;
      if (v > hotCell.v) hotCell = { branch: b, cat: c, v };
    }
  }

  const totalAtRisk = branchTotals.reduce((s, b) => s + b.total, 0);
  const branchesAffected = branchTotals.filter((b) => b.total > 0).length;

  return (
    <div className="text-sm space-y-3">
      <div>
        <p className="font-semibold text-foreground">What you're looking at</p>
        <p className="text-muted-foreground mt-1">
          Each cell counts <b>at-risk SKUs</b> for a branch + product category if{" "}
          <b>{supplierName}</b> is delayed by <b>{delayDays} days</b>. Darker red = more SKUs
          breaching safety stock. Empty cells = no exposure for that combo.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
        <p className="font-semibold text-foreground">Where to focus first</p>
        <ul className="space-y-1 text-muted-foreground">
          <li>
            🔥 <b className="text-foreground">{hotCell.branch}</b> · <b>{hotCell.cat}</b> is the
            single hottest cell ({hotCell.v} SKUs at risk).
          </li>
          <li>
            🏢 <b className="text-foreground">{hotBranch.name}</b> is the most exposed branch
            ({hotBranch.total} at-risk SKUs across all categories).
          </li>
          <li>
            📦 <b className="text-foreground">{hotCat.name}</b> is the most exposed category
            ({hotCat.total} at-risk SKUs across all branches).
          </li>
          <li>
            📊 <b className="text-foreground">{totalAtRisk.toLocaleString()}</b> SKU-branch
            exposures across <b className="text-foreground">{branchesAffected}</b> branches.
          </li>
        </ul>
      </div>

      <div className="rounded-md border-l-4 border-l-primary bg-primary/5 p-3 space-y-1.5">
        <p className="font-semibold text-foreground">Recommended next steps</p>
        <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
          <li>
            Expedite or split the next PO from <b className="text-foreground">{supplierName}</b> —
            prioritize <b>{hotCat.name}</b> SKUs going to <b>{hotBranch.name}</b>.
          </li>
          <li>
            Use the <b>Top 20 At-Risk SKUs</b> table below to trigger inter-branch transfers where a
            surplus branch is suggested (green link).
          </li>
          <li>
            For SKUs with substitutes listed, promote the substitute in quoting/POS until the
            primary is back in stock.
          </li>
          <li>
            Notify counter staff at <b className="text-foreground">{hotBranch.name}</b> so will-call
            customers are quoted realistic ETAs.
          </li>
        </ol>
      </div>
    </div>
  );
}
