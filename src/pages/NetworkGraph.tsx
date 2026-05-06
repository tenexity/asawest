import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
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

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Filter helpers
    const passBranch = (b: string) => filterBranch === "all" || b === filterBranch;
    const passCat = (c: string) => filterCategory === "all" || c === filterCategory;

    // Compute weight thresholds for "critical only"
    const allWeights = [
      ...Object.values(graph.supplier_category),
      ...Object.values(graph.category_branch),
      ...Object.values(graph.branch_customer),
    ].sort((a, b) => b - a);
    const criticalThreshold = allWeights[Math.floor(allWeights.length * 0.2)] ?? 0;

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
    for (const [k, w] of Object.entries(graph.supplier_category)) {
      const [sid, cat] = k.split("|");
      if (!passCat(cat)) continue;
      if (criticalOnly && w < criticalThreshold) continue;
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
      if (criticalOnly && w < criticalThreshold) continue;
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
      if (criticalOnly && w < criticalThreshold) continue;
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
    catList.forEach((c, i) =>
      nodes.push({
        id: `c-${c}`,
        position: { x: colCategory, y: space(catList.length, i) },
        data: { label: `📦 ${c}`, type: "category", meta: { category: c } },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: nodeStyle(COL.category.bg, COL.category.text),
      })
    );
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
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Network Graph</h1>
        <p className="text-sm text-muted-foreground italic mt-1">
          Every node you see has consequences. The simulator below shows them.
        </p>
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
            fitView
            onNodeClick={(_, n: any) =>
              setSelected({ label: n.data.label, meta: n.data })
            }
            nodesDraggable
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
                <Heatmap data={simResult.summary.heatmap} />
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
                        <TableHead className="text-right">Days→Out</TableHead>
                        <TableHead className="text-right">Units Short</TableHead>
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
                            <Badge variant={r.is_stockout ? "destructive" : "outline"}>{r.days_to_stockout}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{r.units_short}</TableCell>
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
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.label}</SheetTitle>
          </SheetHeader>
          <pre className="text-xs mt-4 bg-muted p-3 rounded">
            {JSON.stringify(selected?.meta, null, 2)}
          </pre>
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
