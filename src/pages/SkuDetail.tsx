import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { ArrowLeft, RefreshCw, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeStatus, statusToken } from "@/lib/sku-status";
import { aggregateWeekly, runTournament, TournamentEntry } from "@/functions/forecasters";
import { toast } from "sonner";

type Product = {
  id: string;
  sku: string;
  description: string;
  category: string;
  subcategory: string | null;
  abc_class: string;
  xyz_class: string;
  unit_cost: number;
  unit_price: number;
  is_intermittent: boolean;
  seasonality_pattern: string;
};
type Branch = { id: string; name: string; city: string; state: string };
type Inv = {
  branch_id: string;
  on_hand: number;
  on_order: number;
  safety_stock: number;
  reorder_point: number;
};
type Sale = { sale_date: string; quantity: number; branch_id: string };
type SupplierJoin = {
  supplier_id: string;
  is_primary: boolean;
  cost: number;
  suppliers: { name: string; lead_time_days: number } | null;
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--danger))",
  "hsl(var(--muted-foreground))",
];
const FORECAST_COLORS: Record<string, string> = {
  "Moving Average": "hsl(var(--primary))",
  "Exponential Smoothing": "hsl(var(--success))",
  Croston: "hsl(var(--warning))",
};

export default function SkuDetail() {
  const { id = "" } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inv, setInv] = useState<Inv[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [primary, setPrimary] = useState<SupplierJoin | null>(null);
  const [granularity, setGranularity] = useState<"daily" | "weekly">("weekly");
  const [tournamentNonce, setTournamentNonce] = useState(0);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [{ data: p }, { data: b }, { data: i }, sup] = await Promise.all([
        supabase.from("products").select("*").eq("id", id).maybeSingle(),
        supabase.from("branches").select("id,name,city,state").order("name"),
        supabase
          .from("inventory_levels")
          .select("branch_id,on_hand,on_order,safety_stock,reorder_point")
          .eq("product_id", id),
        supabase
          .from("supplier_products")
          .select("supplier_id,is_primary,cost,suppliers(name,lead_time_days)")
          .eq("product_id", id),
      ]);
      if (cancel) return;
      setProduct((p as Product | null) ?? null);
      setBranches((b ?? []) as Branch[]);
      setInv((i ?? []) as Inv[]);
      const supRows = (sup.data ?? []) as unknown as SupplierJoin[];
      setPrimary(supRows.find((s) => s.is_primary) ?? supRows[0] ?? null);

      // Sales: pull last ~18 months in pages
      const since = new Date();
      since.setMonth(since.getMonth() - 18);
      const all: Sale[] = [];
      let from = 0;
      const pageSize = 1000;
      for (;;) {
        const { data: s } = await supabase
          .from("sales_history")
          .select("sale_date,quantity,branch_id")
          .eq("product_id", id)
          .gte("sale_date", since.toISOString().slice(0, 10))
          .order("sale_date", { ascending: true })
          .range(from, from + pageSize - 1);
        if (!s || s.length === 0) break;
        all.push(...(s as Sale[]));
        if (s.length < pageSize) break;
        from += pageSize;
      }
      if (!cancel) setSales(all);
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  const branchName = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.id, b.name])) as Record<string, string>,
    [branches],
  );

  // Demand chart series
  const series = useMemo(() => {
    if (granularity === "weekly") {
      const all = aggregateWeekly(sales, 78);
      const perBranch = new Map<string, { week: string; total: number }[]>();
      for (const b of branches) {
        const rows = sales.filter((s) => s.branch_id === b.id);
        perBranch.set(b.id, aggregateWeekly(rows, 78));
      }
      return all.map(({ week }, idx) => {
        const row: Record<string, number | string> = { x: week, Total: all[idx].total };
        for (const b of branches) {
          row[b.name] = perBranch.get(b.id)?.[idx]?.total ?? 0;
        }
        return row;
      });
    } else {
      // daily — last 180 days only for readability
      const days = 180;
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      const out: Record<string, number | string>[] = [];
      const dayMap: Record<string, Record<string, number>> = {};
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(end);
        d.setDate(end.getDate() - i);
        const k = d.toISOString().slice(0, 10);
        dayMap[k] = { Total: 0 };
        for (const b of branches) dayMap[k][b.name] = 0;
      }
      for (const s of sales) {
        if (!dayMap[s.sale_date]) continue;
        const bn = branchName[s.branch_id] ?? "Unknown";
        dayMap[s.sale_date][bn] = (dayMap[s.sale_date][bn] ?? 0) + s.quantity;
        dayMap[s.sale_date].Total = (dayMap[s.sale_date].Total ?? 0) + s.quantity;
      }
      for (const k of Object.keys(dayMap)) out.push({ x: k, ...dayMap[k] });
      return out;
    }
  }, [sales, branches, granularity, branchName]);

  // Tournament: use full 18 months of weekly totals
  const tournament = useMemo(() => {
    const weekly = aggregateWeekly(sales, 78).map((w) => w.total);
    return runTournament(weekly, !!product?.is_intermittent, 13, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, product?.is_intermittent, tournamentNonce]);

  // Build chart data: last 26 weeks of actuals + 13 weeks of forecasts
  const forecastChart = useMemo(() => {
    const weekly = aggregateWeekly(sales, 78);
    const tail = weekly.slice(-26);
    const out: Record<string, number | string | null>[] = tail.map((w) => ({
      x: w.week,
      Actual: w.total,
    }));
    // forecast weeks
    const lastDate = tail.length ? new Date(tail[tail.length - 1].week) : new Date();
    for (let i = 1; i <= 13; i++) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + i * 7);
      const row: Record<string, number | string | null> = {
        x: d.toISOString().slice(0, 10),
        Actual: null,
      };
      for (const e of tournament.entries) {
        if (e.applicable && e.forecast.length) row[e.name] = e.forecast[i - 1];
      }
      out.push(row);
    }
    return out;
  }, [sales, tournament]);

  const recomputeAndExplain = async (alsoExplain = true) => {
    setTournamentNonce((n) => n + 1);
    if (!alsoExplain || !product) return;
    setExplainLoading(true);
    setExplanation(null);
    try {
      const weekly = aggregateWeekly(sales, 78).map((w) => w.total);
      const last8 = weekly.slice(-8);
      const stats = {
        weeks_with_demand: weekly.filter((v) => v > 0).length,
        total_weeks: weekly.length,
        avg_weekly: weekly.length ? weekly.reduce((a, b) => a + b, 0) / weekly.length : 0,
        recent_8w_avg: last8.length ? last8.reduce((a, b) => a + b, 0) / last8.length : 0,
        max_weekly: Math.max(0, ...weekly),
      };
      const { data, error } = await supabase.functions.invoke("explain-forecast", {
        body: {
          sku: product.sku,
          category: product.category,
          abc_xyz: `${product.abc_class}/${product.xyz_class}`,
          is_intermittent: product.is_intermittent,
          is_seasonal: product.seasonality_pattern !== "none",
          seasonality_pattern: product.seasonality_pattern,
          recent_demand_stats: stats,
          tournament_results: tournament.entries.map((e) => ({
            model: e.name,
            wmape: e.wmape,
            applicable: e.applicable,
            winner: e.isWinner,
          })),
        },
      });
      if (error) throw error;
      setExplanation((data as { explanation?: string })?.explanation ?? "No explanation returned.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to explain";
      toast.error(msg);
      setExplanation(null);
    } finally {
      setExplainLoading(false);
    }
  };

  if (!product) {
    return (
      <div className="text-sm text-muted-foreground">Loading SKU…</div>
    );
  }

  const margin = product.unit_price > 0
    ? ((product.unit_price - product.unit_cost) / product.unit_price) * 100
    : 0;

  // Inventory rows by branch (with daysOfSupply per branch from last 30d)
  const last30 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const dailyByBranch = new Map<string, number>();
  for (const s of sales) {
    if (s.sale_date >= last30) {
      dailyByBranch.set(s.branch_id, (dailyByBranch.get(s.branch_id) ?? 0) + s.quantity);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/skus" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to SKU Explorer
        </Link>
      </div>

      {/* Header */}
      <Card className="p-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{product.category}</div>
            <h1 className="text-2xl font-semibold tracking-tight font-mono">{product.sku}</h1>
            <p className="text-sm text-muted-foreground">{product.description}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <Stat label="ABC/XYZ" value={`${product.abc_class} / ${product.xyz_class}`} />
            <Stat label="Lead time" value={primary?.suppliers ? `${primary.suppliers.lead_time_days}d` : "—"} />
            <Stat label="Primary supplier" value={primary?.suppliers?.name ?? "—"} />
            <Stat label="Unit cost" value={`$${product.unit_cost.toFixed(2)}`} />
            <Stat label="Unit price" value={`$${product.unit_price.toFixed(2)}`} />
            <Stat label="Margin" value={`${margin.toFixed(1)}%`} />
            <Stat
              label="Pattern"
              value={
                product.is_intermittent
                  ? "Intermittent"
                  : product.seasonality_pattern !== "none"
                  ? `Seasonal (${product.seasonality_pattern})`
                  : "Steady"
              }
            />
          </div>
        </div>
      </Card>

      {/* Inventory table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold">Inventory across branches</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">On Hand</TableHead>
              <TableHead className="text-right">On Order</TableHead>
              <TableHead className="text-right">Safety Stock</TableHead>
              <TableHead className="text-right">Reorder Point</TableHead>
              <TableHead className="text-right">Days of Supply</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((b) => {
              const r = inv.find((x) => x.branch_id === b.id);
              const onHand = r?.on_hand ?? 0;
              const rp = r?.reorder_point ?? 0;
              const daily = (dailyByBranch.get(b.id) ?? 0) / 30;
              const dos = daily > 0 ? onHand / daily : null;
              const status = computeStatus(onHand, rp, dos);
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{onHand.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{(r?.on_order ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{(r?.safety_stock ?? 0).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{rp.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{dos === null ? "—" : Math.round(dos)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", statusToken[status])}>
                      {status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Demand history */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold">Demand history</h2>
            <p className="text-xs text-muted-foreground">
              {granularity === "weekly" ? "Last 78 weeks" : "Last 180 days"} · per branch + total
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={granularity}
            onValueChange={(v) => v && setGranularity(v as "daily" | "weekly")}
            size="sm"
          >
            <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
            <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {branches.map((b, i) => (
                <Line
                  key={b.id}
                  type="monotone"
                  dataKey={b.name}
                  stroke={COLORS[(i + 1) % COLORS.length]}
                  strokeWidth={1}
                  dot={false}
                  strokeOpacity={0.6}
                />
              ))}
              <Line type="monotone" dataKey="Total" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Forecast model comparison */}
      <Card className="p-4" data-tour="forecast-tournament">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold inline-flex items-center gap-2">
              <Trophy className="h-4 w-4 text-warning" /> Forecast Model Comparison
            </h2>
            <p className="text-xs text-muted-foreground">
              We run 4 different forecasting methods (moving average, exponential smoothing,
              Croston for intermittent demand, seasonal naive) against this SKU's last 8 weeks
              of actual sales. Whichever model predicted the past most accurately (lowest wMAPE
              error) is shown as the <span className="font-medium text-foreground">winner</span> and
              used to project the next 13 weeks.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => recomputeAndExplain(true)}>
            <RefreshCw className="h-3 w-3 mr-1" /> Recompute forecast
          </Button>
        </div>

        <div className="h-72 mb-4">
          <ResponsiveContainer>
            <LineChart data={forecastChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" tick={{ fontSize: 10 }} minTickGap={30} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Actual" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls={false} />
              {tournament.entries.map((e) =>
                e.applicable ? (
                  <Line
                    key={e.name}
                    type="monotone"
                    dataKey={e.name}
                    stroke={FORECAST_COLORS[e.name] ?? "hsl(var(--muted-foreground))"}
                    strokeWidth={e.isWinner ? 2.5 : 1.5}
                    strokeDasharray={e.isWinner ? undefined : "4 4"}
                    dot={false}
                    connectNulls
                  />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">wMAPE (holdout)</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tournament.entries.map((e) => (
              <ForecastRow key={e.name} entry={e} />
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 border rounded-md p-4 bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold inline-flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4" /> Why this winner?
            </h3>
            {!explanation && !explainLoading && (
              <Button size="sm" variant="ghost" onClick={() => recomputeAndExplain(true)}>
                Generate explanation
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {explainLoading
              ? "Asking the analyst…"
              : explanation
              ? explanation
              : tournament.winner
              ? `Click "Generate explanation" for an analyst note on why ${tournament.winner.name} fits this SKU.`
              : "No applicable model — not enough history."}
          </p>
        </div>
      </Card>
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

function ForecastRow({ entry }: { entry: TournamentEntry }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{entry.name}</TableCell>
      <TableCell className="text-right tabular-nums">
        {!entry.applicable
          ? "N/A"
          : entry.wmape === null || !isFinite(entry.wmape)
          ? "—"
          : `${entry.wmape.toFixed(1)}%`}
      </TableCell>
      <TableCell>
        {!entry.applicable ? (
          <span className="text-xs text-muted-foreground">{entry.reason ?? "Not applicable"}</span>
        ) : entry.isWinner ? (
          <Badge className="bg-success text-success-foreground">Winner</Badge>
        ) : (
          <Badge variant="outline" className="text-xs">Ran</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
