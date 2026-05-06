import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Branch = { id: string; name: string };
type InvRow = {
  branch_id: string;
  product_id: string;
  on_hand: number;
  reorder_point: number;
  safety_stock: number;
  products: { unit_cost: number; sku: string; description: string } | null;
};
type SaleRow = { sale_date: string; quantity: number; branch_id: string; product_id: string };

const fmtCurrency = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(1)}K`
    : `$${n.toFixed(0)}`;
const fmtNum = (n: number) => n.toLocaleString();

function Sparkline({ data, color }: { data: { x: string; y: number }[]; color: string }) {
  if (!data.length) return <div className="h-10 text-xs text-muted-foreground">No data</div>;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="y" stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  if (!isFinite(value) || value === 0)
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  const positive = value > 0;
  const good = invert ? !positive : positive;
  return (
    <span
      className={cn(
        "text-xs inline-flex items-center gap-0.5 font-medium",
        good ? "text-success" : "text-danger",
      )}
    >
      {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  delta,
  invertDelta,
  spark,
  color,
  hint,
}: {
  label: string;
  value: string;
  delta: number;
  invertDelta?: boolean;
  spark: { x: string; y: number }[];
  color: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <Delta value={delta} invert={invertDelta} />
      </div>
      <div className="mt-2">
        <Sparkline data={spark} color={color} />
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

export default function Dashboard() {
  const { branchId } = useBranch();
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inventory, setInventory] = useState<InvRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [bRes, iRes, sRes] = await Promise.all([
        supabase.from("branches").select("id,name"),
        // pull inventory with product joined; paginate to bypass 1k limit
        (async () => {
          const all: InvRow[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            let q = supabase
              .from("inventory_levels")
              .select(
                "branch_id,product_id,on_hand,reorder_point,safety_stock,products(unit_cost,sku,description)",
              )
              .range(from, from + pageSize - 1);
            if (branchId !== "all") q = q.eq("branch_id", branchId);
            const { data, error } = await q;
            if (error || !data || data.length === 0) break;
            all.push(...(data as unknown as InvRow[]));
            if (data.length < pageSize) break;
            from += pageSize;
          }
          return { data: all };
        })(),
        (async () => {
          const since = new Date();
          since.setDate(since.getDate() - 120);
          let q = supabase
            .from("sales_history")
            .select("sale_date,quantity,branch_id,product_id")
            .gte("sale_date", since.toISOString().slice(0, 10))
            .limit(50000);
          if (branchId !== "all") q = q.eq("branch_id", branchId);
          return q;
        })(),
      ]);
      if (cancelled) return;
      setBranches((bRes.data ?? []) as Branch[]);
      setInventory(iRes.data as InvRow[]);
      setSales((sRes.data ?? []) as SaleRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  // Compute KPIs
  const stockoutPairs = inventory.filter((r) => r.on_hand === 0);
  const totalValue = inventory.reduce(
    (s, r) => s + r.on_hand * (r.products?.unit_cost ?? 0),
    0,
  );

  const today = new Date();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const last30Start = new Date(today);
  last30Start.setDate(today.getDate() - 30);
  const prev30Start = new Date(today);
  prev30Start.setDate(today.getDate() - 60);

  const sales30 = sales.filter((s) => s.sale_date >= day(last30Start));
  const sales60to30 = sales.filter(
    (s) => s.sale_date >= day(prev30Start) && s.sale_date < day(last30Start),
  );
  const sales90Total = sales.reduce((a, s) => a + s.quantity, 0);

  const demand30 = sales30.reduce((a, s) => a + s.quantity, 0);
  const demandPrev = sales60to30.reduce((a, s) => a + s.quantity, 0);

  // Fill rate: % of demand fulfilled. Since we don't track unfulfilled, approximate:
  // demand fulfilled / (demand fulfilled + estimated lost from stockouts).
  // Simple proxy: 100 - (stockoutPairs/totalPairs)*100 weighted; fallback formula
  const totalPairs = inventory.length || 1;
  const fillRate = Math.max(0, 100 - (stockoutPairs.length / totalPairs) * 100);
  const fillRatePrev = fillRate; // placeholder; no historical fill data yet
  const fillDelta = fillRate - fillRatePrev;

  // Avg days of supply across active SKUs
  const dailyDemandByPair = new Map<string, number>();
  for (const s of sales30) {
    const k = `${s.branch_id}|${s.product_id}`;
    dailyDemandByPair.set(k, (dailyDemandByPair.get(k) ?? 0) + s.quantity);
  }
  let dosSum = 0;
  let dosCount = 0;
  for (const r of inventory) {
    const k = `${r.branch_id}|${r.product_id}`;
    const daily = (dailyDemandByPair.get(k) ?? 0) / 30;
    if (daily > 0) {
      dosSum += r.on_hand / daily;
      dosCount++;
    }
  }
  const avgDos = dosCount ? dosSum / dosCount : 0;

  // Inventory turns: annualized COGS / avg inventory value (last 90 days)
  const cogs90 = sales.reduce(
    (a, s) =>
      a +
      s.quantity *
        (inventory.find(
          (i) => i.product_id === s.product_id && i.branch_id === s.branch_id,
        )?.products?.unit_cost ?? 0),
    0,
  );
  const turns = totalValue > 0 ? (cogs90 * 4) / totalValue : 0;

  // Build sparklines: stockouts and value are static; demand-based ones use sales 30d
  const dayCounts: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dayCounts[day(d)] = 0;
  }
  for (const s of sales30) {
    if (dayCounts[s.sale_date] !== undefined) dayCounts[s.sale_date] += s.quantity;
  }
  const demandSpark = Object.entries(dayCounts).map(([x, y]) => ({ x, y }));

  // Stockout trend (approx): we don't have history of stockouts; show flat current
  const stockoutTrend = demandSpark.map((d) => ({
    x: d.x,
    y: stockoutPairs.length,
  }));

  // Top 10 problem SKUs by severity = (reorder_point - on_hand) / max(reorder_point,1)
  const problems = inventory
    .map((r) => ({
      sku: r.products?.sku ?? "—",
      desc: r.products?.description ?? "",
      severity:
        r.reorder_point > 0
          ? Math.max(0, (r.reorder_point - r.on_hand) / r.reorder_point)
          : r.on_hand === 0
          ? 1
          : 0,
      on_hand: r.on_hand,
      rp: r.reorder_point,
    }))
    .filter((r) => r.severity > 0)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 10)
    .map((r) => ({ name: r.sku, value: Math.round(r.severity * 100) }));

  // Branch comparison
  const branchRows = (branchId === "all" ? branches : branches.filter((b) => b.id === branchId))
    .map((b) => {
      const rows = inventory.filter((r) => r.branch_id === b.id);
      const so = rows.filter((r) => r.on_hand === 0).length;
      const fr = rows.length ? Math.max(0, 100 - (so / rows.length) * 100) : 0;
      const value = rows.reduce(
        (s, r) => s + r.on_hand * (r.products?.unit_cost ?? 0),
        0,
      );
      // excess: on_hand > 6 * monthly demand (proxy: 180 days supply)
      const branchSales30 = sales30.filter((s) => s.branch_id === b.id);
      const demandMap = new Map<string, number>();
      for (const s of branchSales30)
        demandMap.set(s.product_id, (demandMap.get(s.product_id) ?? 0) + s.quantity);
      let excess = 0;
      let dos = 0;
      let dosN = 0;
      for (const r of rows) {
        const d = (demandMap.get(r.product_id) ?? 0) / 30;
        if (d > 0) {
          const ds = r.on_hand / d;
          dos += ds;
          dosN++;
          if (ds > 180) excess++;
        }
      }
      return {
        id: b.id,
        name: b.name,
        fr,
        so,
        excess,
        value,
        dos: dosN ? dos / dosN : 0,
      };
    });

  const bestFr = Math.max(...branchRows.map((r) => r.fr), 0);
  const worstFr = Math.min(...branchRows.map((r) => r.fr), 100);
  const worstSo = Math.max(...branchRows.map((r) => r.so), 0);

  const successColor = "hsl(var(--success))";
  const dangerColor = "hsl(var(--danger))";
  const warningColor = "hsl(var(--warning))";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Network-wide inventory health {loading && "· loading…"}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        <KpiCard
          label="Fill Rate"
          value={`${fillRate.toFixed(1)}%`}
          delta={fillDelta}
          spark={demandSpark.map((d) => ({ x: d.x, y: fillRate }))}
          color={fillRate >= 95 ? successColor : fillRate >= 90 ? warningColor : dangerColor}
          hint="Target > 95%"
        />
        <KpiCard
          label="Active Stockouts"
          value={fmtNum(stockoutPairs.length)}
          delta={0}
          invertDelta
          spark={stockoutTrend}
          color={stockoutPairs.length > 0 ? dangerColor : successColor}
          hint="SKU-branch pairs at zero"
        />
        <KpiCard
          label="Inventory Value"
          value={fmtCurrency(totalValue)}
          delta={0}
          spark={demandSpark}
          color={successColor}
          hint="Sum of on-hand × cost"
        />
        <KpiCard
          label="Avg Days of Supply"
          value={avgDos.toFixed(0)}
          delta={demandPrev ? ((demand30 - demandPrev) / demandPrev) * 100 : 0}
          invertDelta
          spark={demandSpark}
          color={avgDos > 180 ? warningColor : avgDos < 14 ? dangerColor : successColor}
          hint="Across active SKUs"
        />
        <KpiCard
          label="Inventory Turns"
          value={`${turns.toFixed(2)}x`}
          delta={0}
          spark={demandSpark}
          color={turns >= 4 ? successColor : turns >= 2 ? warningColor : dangerColor}
          hint="Annualized, last 90d"
        />
      </div>

      {/* Branch comparison */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Branch Comparison</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Fill Rate</TableHead>
              <TableHead className="text-right">Stockouts</TableHead>
              <TableHead className="text-right">Excess SKUs</TableHead>
              <TableHead className="text-right">Inventory Value</TableHead>
              <TableHead className="text-right">Days of Supply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {branchRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                  No branch data
                </TableCell>
              </TableRow>
            )}
            {branchRows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    branchRows.length > 1 && r.fr === bestFr && "text-success font-semibold",
                    branchRows.length > 1 && r.fr === worstFr && "text-danger font-semibold",
                  )}
                >
                  {r.fr.toFixed(1)}%
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    branchRows.length > 1 && r.so === worstSo && r.so > 0 && "text-danger font-semibold",
                  )}
                >
                  {r.so}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.excess}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCurrency(r.value)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.dos.toFixed(0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">30-day Stockout Trend</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stockoutTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} hide />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="y" stroke={dangerColor} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Top 10 Problem SKUs</h2>
          <div className="h-64">
            {problems.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No problem SKUs
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={problems} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" fill={dangerColor} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
