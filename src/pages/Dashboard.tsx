import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  to,
}: {
  label: string;
  value: string;
  delta: number;
  invertDelta?: boolean;
  spark: { x: string; y: number }[];
  color: string;
  hint?: string;
  to?: string;
}) {
  const inner = (
    <Card
      className={cn(
        "p-4 h-full",
        to && "transition-all hover:shadow-md hover:border-primary/40 cursor-pointer group",
      )}
    >
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center justify-between">
        <span>{label}</span>
        {to && (
          <span className="text-muted-foreground/50 group-hover:text-primary transition-colors">
            →
          </span>
        )}
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
  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
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
          // Paginate to bypass PostgREST 1k row cap. 90 days keeps payload sane.
          const since = new Date();
          since.setDate(since.getDate() - 90);
          const sinceStr = since.toISOString().slice(0, 10);
          const all: SaleRow[] = [];
          const pageSize = 1000;
          let from = 0;
          while (true) {
            let q = supabase
              .from("sales_history")
              .select("sale_date,quantity,branch_id,product_id")
              .gte("sale_date", sinceStr)
              .order("sale_date", { ascending: false })
              .range(from, from + pageSize - 1);
            if (branchId !== "all") q = q.eq("branch_id", branchId);
            const { data, error } = await q;
            if (error || !data || data.length === 0) break;
            all.push(...(data as SaleRow[]));
            if (data.length < pageSize) break;
            from += pageSize;
            if (from > 500000) break; // safety
          }
          return { data: all };
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

  // Dead stock: pairs with on_hand > 0 but zero demand in the last 90 days.
  // This is trapped working capital — the ripest opportunity to convert to cash.
  const pairsWithDemand90 = new Set<string>();
  for (const s of sales) pairsWithDemand90.add(`${s.branch_id}|${s.product_id}`);
  let deadStockValue = 0;
  let deadStockPairs = 0;
  for (const r of inventory) {
    if (r.on_hand > 0 && !pairsWithDemand90.has(`${r.branch_id}|${r.product_id}`)) {
      deadStockValue += r.on_hand * (r.products?.unit_cost ?? 0);
      deadStockPairs++;
    }
  }
  const deadStockPct = totalValue > 0 ? (deadStockValue / totalValue) * 100 : 0;

  // Inventory turns: annualized COGS / avg inventory value.
  // Use the precomputed costByProduct map (built below) — defer calc until after it.


  // ---------- Daily time-series from sales_history ----------
  // Build a 30-day window of: total demand, COGS, and distinct (product,branch)
  // pairs that had any sales. We use "active pairs that went silent" as a proxy
  // for daily stockouts (we don't store historical on_hand).
  const lastNDays = (n: number) => {
    const arr: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      arr.push(day(d));
    }
    return arr;
  };
  const days30 = lastNDays(30);

  // Cost lookup
  const costByProduct = new Map<string, number>();
  for (const r of inventory) {
    if (r.products?.unit_cost != null) costByProduct.set(r.product_id, r.products.unit_cost);
  }
  // Inventory turns: annualized COGS / inventory value, using 90-day window.
  const cogs90Total = sales.reduce(
    (a, s) => a + s.quantity * (costByProduct.get(s.product_id) ?? 0),
    0,
  );
  const turns = totalValue > 0 ? (cogs90Total * (365 / 90)) / totalValue : 0;

  // Universe of pairs that have sold at least once in the last 90 days (= "active")
  const activePairs = new Set<string>();
  for (const s of sales) activePairs.add(`${s.branch_id}|${s.product_id}`);
  const totalActivePairs = Math.max(1, activePairs.size);

  const demandPerDay = new Map<string, number>(days30.map((d) => [d, 0]));
  const cogsPerDay = new Map<string, number>(days30.map((d) => [d, 0]));
  const pairsSoldPerDay = new Map<string, Set<string>>(days30.map((d) => [d, new Set<string>()]));
  for (const s of sales30) {
    if (!demandPerDay.has(s.sale_date)) continue;
    demandPerDay.set(s.sale_date, (demandPerDay.get(s.sale_date) ?? 0) + s.quantity);
    cogsPerDay.set(
      s.sale_date,
      (cogsPerDay.get(s.sale_date) ?? 0) + s.quantity * (costByProduct.get(s.product_id) ?? 0),
    );
    pairsSoldPerDay.get(s.sale_date)!.add(`${s.branch_id}|${s.product_id}`);
  }

  const demandSpark = days30.map((d) => ({ x: d, y: demandPerDay.get(d) ?? 0 }));
  const cogsSpark = days30.map((d) => ({ x: d, y: Math.round(cogsPerDay.get(d) ?? 0) }));
  // Approx daily stockout count: active pairs that did NOT sell that day.
  const stockoutTrend = days30.map((d) => ({
    x: d,
    y: totalActivePairs - (pairsSoldPerDay.get(d)?.size ?? 0),
  }));
  // Daily fill-rate proxy: % of active pairs NOT stocked out (sold OR has on_hand>0).
  // Aligns with branch-comparison definition (100 - stockouts/totalPairs).
  // Approximation: pairs that did not sell that day AND are currently at on_hand=0
  // are counted as stockouts on that day.
  const stockoutPairKeys = new Set(
    stockoutPairs.map((r) => `${r.branch_id}|${r.product_id}`),
  );
  const fillSpark = days30.map((d) => {
    const sold = pairsSoldPerDay.get(d)?.size ?? 0;
    // pairs currently at zero that also did not sell that day = stockouts today
    let stockedOutToday = 0;
    for (const k of stockoutPairKeys) {
      if (!pairsSoldPerDay.get(d)?.has(k)) stockedOutToday++;
    }
    const pct = ((totalActivePairs - stockedOutToday) / totalActivePairs) * 100;
    return { x: d, y: Math.max(0, Math.min(100, pct)) };
  });
  // Daily inventory-value proxy: today's value minus cumulative COGS already shipped.
  let cum = 0;
  const valueSpark = days30.map((d) => {
    cum += cogsPerDay.get(d) ?? 0;
    return { x: d, y: Math.max(0, totalValue - (cum - (cogsPerDay.get(days30[0]) ?? 0))) };
  });

  // ---------- Period-over-period deltas ----------
  const avg = (arr: { y: number }[]) => (arr.length ? arr.reduce((a, b) => a + b.y, 0) / arr.length : 0);
  const prevDemand = sales60to30.reduce((a, s) => a + s.quantity, 0);
  const prevCogs = sales60to30.reduce(
    (a, s) => a + s.quantity * (costByProduct.get(s.product_id) ?? 0),
    0,
  );
  const demandDelta = prevDemand ? ((demand30 - prevDemand) / prevDemand) * 100 : 0;
  const cogsTotal30 = cogsSpark.reduce((a, b) => a + b.y, 0);
  const cogsDelta = prevCogs ? ((cogsTotal30 - prevCogs) / prevCogs) * 100 : 0;
  // First vs second half of 30-day window for fill / stockout deltas
  const half = Math.floor(days30.length / 2);
  const firstHalf = (s: { y: number }[]) => s.slice(0, half);
  const secondHalf = (s: { y: number }[]) => s.slice(half);
  const fillDeltaPct = (() => {
    const a = avg(firstHalf(fillSpark));
    const b = avg(secondHalf(fillSpark));
    return a ? ((b - a) / a) * 100 : 0;
  })();
  const stockoutDeltaPct = (() => {
    const a = avg(firstHalf(stockoutTrend));
    const b = avg(secondHalf(stockoutTrend));
    return a ? ((b - a) / a) * 100 : 0;
  })();
  // Use the same definition as branch table for the headline KPI
  const fillRateLive = fillRate;



  // Top 10 problem SKUs — classify the *reason* and quantify impact
  type Problem = {
    sku: string;
    desc: string;
    reason: "Stockout" | "Below ROP" | "Excess";
    on_hand: number;
    rp: number;
    dos: number;
    impact: number; // $ at risk (lost sales) or $ tied up (excess)
    severity: number; // 0..1 sort key
  };
  const problems: Problem[] = inventory
    .map((r): Problem | null => {
      const k = `${r.branch_id}|${r.product_id}`;
      const daily = (dailyDemandByPair.get(k) ?? 0) / 30;
      const cost = r.products?.unit_cost ?? 0;
      const dos = daily > 0 ? r.on_hand / daily : r.on_hand > 0 ? 999 : 0;
      const sku = r.products?.sku ?? "—";
      const desc = r.products?.description ?? "";
      if (r.on_hand === 0 && daily > 0) {
        // 14-day lost-sales estimate
        const impact = daily * 14 * cost;
        return { sku, desc, reason: "Stockout", on_hand: 0, rp: r.reorder_point, dos: 0, impact, severity: 1 + impact / 1e6 };
      }
      if (r.reorder_point > 0 && r.on_hand < r.reorder_point && daily > 0) {
        const gap = r.reorder_point - r.on_hand;
        const impact = gap * cost;
        const sev = 0.5 + (gap / r.reorder_point) * 0.49;
        return { sku, desc, reason: "Below ROP", on_hand: r.on_hand, rp: r.reorder_point, dos, impact, severity: sev };
      }
      if (dos > 180 && r.on_hand > 0) {
        const impact = r.on_hand * cost;
        return { sku, desc, reason: "Excess", on_hand: r.on_hand, rp: r.reorder_point, dos, impact, severity: 0.3 + Math.min(0.2, impact / 1e6) };
      }
      return null;
    })
    .filter((p): p is Problem => p !== null)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 10);


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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <KpiCard
          label="Fill Rate"
          value={`${fillRateLive.toFixed(1)}%`}
          delta={fillDeltaPct}
          spark={fillSpark}
          color={fillRateLive >= 95 ? successColor : fillRateLive >= 90 ? warningColor : dangerColor}
          hint="Active SKUs moving daily"
          to="/agents?type=stockout_risk"
        />
        <KpiCard
          label="Active Stockouts"
          value={fmtNum(stockoutPairs.length)}
          delta={stockoutDeltaPct}
          invertDelta
          spark={stockoutTrend}
          color={stockoutPairs.length > 0 ? dangerColor : successColor}
          hint="SKU-branch pairs at zero"
          to="/reorder"
        />
        <KpiCard
          label="Inventory Value"
          value={fmtCurrency(totalValue)}
          delta={cogsDelta}
          invertDelta
          spark={valueSpark}
          color={successColor}
          hint="On-hand × cost"
          to="/skus"
        />
        <KpiCard
          label="Dead Stock"
          value={fmtCurrency(deadStockValue)}
          delta={0}
          spark={days30.map((d) => ({ x: d, y: deadStockValue }))}
          color={deadStockPct > 5 ? dangerColor : deadStockPct > 2 ? warningColor : successColor}
          hint={`${fmtNum(deadStockPairs)} SKUs · ${deadStockPct.toFixed(1)}% of inventory · 0 sales 90d`}
          to="/skus?filter=dead"
        />
        <KpiCard
          label="Avg Days of Supply"
          value={avgDos.toFixed(0)}
          delta={demandDelta}
          invertDelta
          spark={demandSpark}
          color={avgDos > 180 ? warningColor : avgDos < 14 ? dangerColor : successColor}
          hint="Across active SKUs"
          to="/agents?type=excess_inventory"
        />
        <KpiCard
          label="Inventory Turns"
          value={`${turns.toFixed(2)}x`}
          delta={cogsDelta}
          spark={cogsSpark}
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
          <h2 className="font-semibold mb-3">30-day Daily Demand (units)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={demandSpark}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="x" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="y" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h2 className="font-semibold">Top 10 Problem SKUs</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ranked by reason and financial impact
            </p>
          </div>
          <div className="h-[232px] overflow-auto">
            {problems.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No problem SKUs
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">ROP</TableHead>
                    <TableHead className="text-right">DOS</TableHead>
                    <TableHead className="text-right">Impact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {problems.map((p) => {
                    const badge =
                      p.reason === "Stockout"
                        ? "bg-danger/15 text-danger"
                        : p.reason === "Below ROP"
                        ? "bg-warning/15 text-warning"
                        : "bg-muted text-muted-foreground";
                    return (
                      <TableRow key={`${p.sku}-${p.reason}`}>
                        <TableCell className="font-mono text-xs">
                          <div className="font-medium">{p.sku}</div>
                          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            {p.desc}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", badge)}>
                            {p.reason}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.on_hand}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {p.rp}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.dos >= 999 ? "∞" : p.dos.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmtCurrency(p.impact)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
