import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, Info, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { computeStatus, statusToken, Status } from "@/lib/sku-status";

type Inv = {
  branch_id: string;
  product_id: string;
  on_hand: number;
  reorder_point: number;
};
type Product = {
  id: string;
  sku: string;
  description: string;
  category: string;
  abc_class: string;
  xyz_class: string;
};
type Sale = { product_id: string; branch_id: string; quantity: number; sale_date: string };

type Row = {
  id: string;
  sku: string;
  description: string;
  category: string;
  abc: string;
  xyz: string;
  totalOnHand: number;
  totalRP: number;
  dailyDemand: number;
  daysOfSupply: number | null;
  status: Status;
};

const STATUSES: Status[] = ["Healthy", "Watch", "At Risk", "Stockout", "Excess"];

const ABC_LABEL: Record<string, string> = {
  A: "high value (top ~20% of revenue, 98% target service level)",
  B: "mid value (next ~30% of revenue, 95% target service level)",
  C: "low value / long tail (90% target service level)",
};
const XYZ_LABEL: Record<string, string> = {
  X: "steady, predictable demand",
  Y: "variable or seasonal demand",
  Z: "lumpy / intermittent demand — hard to forecast",
};
function combinedHint(abc: string, xyz: string): string {
  if (abc === "A" && xyz === "X") return "Tight stock, frequent reorders — keep this one humming.";
  if (abc === "A" && xyz === "Z") return "Important but unpredictable — needs extra safety stock.";
  if (abc === "C" && xyz === "Z") return "Low value and lumpy — consider order-on-demand or substitution.";
  if (abc === "B" && xyz === "Y") return "Mid-tier seasonal — watch peak windows closely.";
  return "Stocking strategy is set from this combination.";
}

async function fetchAll<T>(
  build: (from: number, to: number) => ReturnType<ReturnType<typeof supabase.from>["select"]>,
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

type SortKey = "sku" | "description" | "category" | "abc" | "totalOnHand" | "daysOfSupply" | "status";

export default function Skus() {
  const { branchId } = useBranch();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [abc, setAbc] = useState<string>("all");
  const [xyz, setXyz] = useState<string>("all");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [p, i, s] = await Promise.all([
        fetchAll<Product>((from, to) =>
          supabase
            .from("products")
            .select("id,sku,description,category,abc_class,xyz_class")
            .range(from, to),
        ),
        fetchAll<Inv>((from, to) => {
          let q = supabase
            .from("inventory_levels")
            .select("branch_id,product_id,on_hand,reorder_point")
            .range(from, to);
          if (branchId !== "all") q = q.eq("branch_id", branchId);
          return q;
        }),
        (async () => {
          const since = new Date();
          since.setDate(since.getDate() - 30);
          let q = supabase
            .from("sales_history")
            .select("product_id,branch_id,quantity,sale_date")
            .gte("sale_date", since.toISOString().slice(0, 10))
            .limit(50000);
          if (branchId !== "all") q = q.eq("branch_id", branchId);
          const { data } = await q;
          return (data ?? []) as Sale[];
        })(),
      ]);
      if (cancel) return;
      setProducts(p);
      setInv(i);
      setSales(s);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [branchId]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort(),
    [products],
  );

  const rows: Row[] = useMemo(() => {
    const invByPid = new Map<string, Inv[]>();
    for (const r of inv) {
      const arr = invByPid.get(r.product_id) ?? [];
      arr.push(r);
      invByPid.set(r.product_id, arr);
    }
    const dailyByPid = new Map<string, number>();
    for (const s of sales) {
      dailyByPid.set(s.product_id, (dailyByPid.get(s.product_id) ?? 0) + s.quantity);
    }
    return products.map((p) => {
      const rs = invByPid.get(p.id) ?? [];
      const totalOnHand = rs.reduce((a, r) => a + r.on_hand, 0);
      const totalRP = rs.reduce((a, r) => a + r.reorder_point, 0);
      const daily = (dailyByPid.get(p.id) ?? 0) / 30;
      const dos = daily > 0 ? totalOnHand / daily : null;
      const status = computeStatus(totalOnHand, totalRP, dos);
      return {
        id: p.id,
        sku: p.sku,
        description: p.description,
        category: p.category,
        abc: p.abc_class,
        xyz: p.xyz_class,
        totalOnHand,
        totalRP,
        dailyDemand: daily,
        daysOfSupply: dos,
        status,
      };
    });
  }, [products, inv, sales]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (ql && !r.sku.toLowerCase().includes(ql) && !r.description.toLowerCase().includes(ql))
          return false;
        if (category !== "all" && r.category !== category) return false;
        if (abc !== "all" && r.abc !== abc) return false;
        if (xyz !== "all" && r.xyz !== xyz) return false;
        if (problemsOnly && (r.status === "Healthy" || r.status === "Watch")) return false;
        return true;
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        const va = a[sortKey] as string | number | null;
        const vb = b[sortKey] as string | number | null;
        if (sortKey === "status") {
          const order = { Stockout: 0, "At Risk": 1, Excess: 2, Watch: 3, Healthy: 4 } as const;
          return (order[a.status] - order[b.status]) * dir;
        }
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
  }, [rows, q, category, abc, xyz, problemsOnly, sortKey, sortDir]);

  const head = (label: string, key: SortKey, align: "left" | "right" = "left") => (
    <TableHead
      className={cn("cursor-pointer select-none whitespace-nowrap", align === "right" && "text-right")}
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else {
          setSortKey(key);
          setSortDir("asc");
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key &&
          (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SKU Explorer</h1>
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} SKUs`}
        </p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search SKU or description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={abc} onValueChange={setAbc}>
          <SelectTrigger className="h-9 w-[110px]"><SelectValue placeholder="ABC" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ABC</SelectItem>
            {["A", "B", "C"].map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={xyz} onValueChange={setXyz}>
          <SelectTrigger className="h-9 w-[110px]"><SelectValue placeholder="XYZ" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All XYZ</SelectItem>
            {["X", "Y", "Z"].map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 ml-auto px-2">
          <Switch id="problems" checked={problemsOnly} onCheckedChange={setProblemsOnly} />
          <Label htmlFor="problems" className="text-sm">Problems only</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What counts as a problem?">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Hides <span className="font-medium">Healthy</span> and <span className="font-medium">Watch</span> SKUs.
                Shows only those that need attention:
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  <li><span className="font-medium">Stockout</span> — on-hand is 0</li>
                  <li><span className="font-medium">At Risk</span> — on-hand at or below reorder point</li>
                  <li><span className="font-medium">Excess</span> — more than 180 days of supply</li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                {head("SKU", "sku")}
                {head("Description", "description")}
                {head("Category", "category")}
                {head("On-hand", "totalOnHand", "right")}
                {head("Days of Supply", "daysOfSupply", "right")}
                {head("Status", "status")}
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1 text-muted-foreground font-normal">
                    Classification
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="hover:text-foreground" aria-label="What is classification?">
                            <Info className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs text-xs">
                          A two-part tag the system uses behind the scenes to set service levels and forecasting strategy. Read it as <span className="font-medium">value · demand pattern</span> (e.g. "High value · Steady"). You don't need to act on it directly — it shapes the recommendations on the Reorder page.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 500).map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/skus/${r.id}`)}
                >
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell className="max-w-[320px] truncate">{r.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.category}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalOnHand.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.daysOfSupply === null ? "—" : Math.round(r.daysOfSupply)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", statusToken[r.status])}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="hover:text-foreground">
                            {ABC_TIER[r.abc] ?? r.abc} · {XYZ_TIER[r.xyz] ?? r.xyz}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs text-xs">
                          <div><span className="font-medium">{ABC_TIER[r.abc] ?? r.abc} value</span> — {ABC_LABEL[r.abc]}</div>
                          <div><span className="font-medium">{XYZ_TIER[r.xyz] ?? r.xyz} demand</span> — {XYZ_LABEL[r.xyz]}</div>
                          <div className="mt-1 text-muted-foreground">{combinedHint(r.abc, r.xyz)}</div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No SKUs match the current filters.
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
    </div>
  );
}
