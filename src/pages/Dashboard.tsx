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
type DailyPoint = { day: string; demand: number; cogs: number; pairs_sold: number };
type ProblemRow = {
  sku: string; desc: string;
  reason: "Stockout" | "Below ROP" | "Excess";
  on_hand: number; rp: number; dos: number; impact: number;
};
type BranchRow = { id: string; name: string; fr: number; so: number; excess: number; value: number; dos: number };
type Summary = {
  branches: Branch[];
  kpis: {
    total_value: number; stockout_pairs: number; total_pairs: number;
    active_pairs: number; well_stocked_pairs: number;
    avg_dos: number; dead_value: number;
    demand30: number; demand_prev: number;
    cogs30: number; cogs_prev: number; cogs90: number;
  };
  daily: DailyPoint[];
  total_active_pairs: number;
  stockout_pair_keys: string[];
  problems: ProblemRow[];
  branch_rows: BranchRow[];
};

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
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("dashboard_summary", {
        p_branch_id: branchId === "all" ? null : branchId,
      });
      if (cancelled) return;
      if (error) {
        console.error("dashboard_summary error", error);
        setSummary(null);
      } else {
        setSummary(data as unknown as Summary);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const k = summary?.kpis;
  const daily = summary?.daily ?? [];
  const totalActivePairs = Math.max(1, summary?.total_active_pairs ?? 0);
  const stockoutPairKeys = new Set(summary?.stockout_pair_keys ?? []);

  const totalValue = Number(k?.total_value ?? 0);
  const stockoutPairsCount = Number(k?.stockout_pairs ?? 0);
  const totalPairs = Math.max(1, Number(k?.total_pairs ?? 0));
  const activePairs = Math.max(1, Number(k?.active_pairs ?? 0));
  const wellStockedPairs = Number(k?.well_stocked_pairs ?? 0);
  // Fill rate: of active SKU-branch pairs, % adequately stocked (on_hand >= safety_stock)
  const fillRate = (wellStockedPairs / activePairs) * 100;
  const avgDos = Number(k?.avg_dos ?? 0);
  const deadStockValue = Number(k?.dead_value ?? 0);
  const deadStockPairs = 0;
  const deadStockPct = totalValue > 0 ? (deadStockValue / totalValue) * 100 : 0;
  const cogs90 = Number(k?.cogs90 ?? 0);
  const turns = totalValue > 0 ? (cogs90 * (365 / 90)) / totalValue : 0;

  const demand30 = Number(k?.demand30 ?? 0);
  const demandPrev = Number(k?.demand_prev ?? 0);
  const cogs30 = Number(k?.cogs30 ?? 0);
  const cogsPrev = Number(k?.cogs_prev ?? 0);
  const demandDelta = demandPrev ? ((demand30 - demandPrev) / demandPrev) * 100 : 0;
  const cogsDelta = cogsPrev ? ((cogs30 - cogsPrev) / cogsPrev) * 100 : 0;

  const demandSpark = daily.map((d) => ({ x: d.day, y: Number(d.demand) }));
  const cogsSpark = daily.map((d) => ({ x: d.day, y: Math.round(Number(d.cogs)) }));
  const stockoutTrend = daily.map((d) => ({
    x: d.day,
    y: Math.max(0, totalActivePairs - Number(d.pairs_sold)),
  }));
  const fillSpark = daily.map((d) => {
    const pct = ((totalActivePairs - stockoutPairKeys.size) / totalActivePairs) * 100;
    return { x: d.day, y: Math.max(0, Math.min(100, pct)) };
  });
  let cum = 0;
  const valueSpark = daily.map((d) => {
    cum += Number(d.cogs);
    return { x: d.day, y: Math.max(0, totalValue - cum + Number(daily[0]?.cogs ?? 0)) };
  });
  const fillDeltaPct = 0;
  const stockoutDeltaPct = 0;
  const fillRateLive = fillRate;

  const problems = summary?.problems ?? [];
  const branchRows = summary?.branch_rows ?? [];
  const bestFr = Math.max(...branchRows.map((r) => r.fr), 0);
  const worstFr = Math.min(...branchRows.map((r) => r.fr), 100);
  const worstSo = Math.max(...branchRows.map((r) => r.so), 0);

  const days30 = daily.map((d) => d.day);
  const stockoutPairs = { length: stockoutPairsCount };

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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3" data-tour="kpi-grid">
        <div data-tour="kpi-fill-rate" className="contents">
        <KpiCard
          label="Fill Rate"
          value={`${fillRateLive.toFixed(1)}%`}
          delta={fillDeltaPct}
          spark={fillSpark}
          color={fillRateLive >= 95 ? successColor : fillRateLive >= 90 ? warningColor : dangerColor}
          hint="Active SKUs moving daily"
          to="/agents?type=stockout_risk"
        />
        </div>
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
        <div data-tour="kpi-dead-stock" className="contents">
        <KpiCard
          label="Dead Stock"
          value={fmtCurrency(deadStockValue)}
          delta={0}
          spark={days30.map((d) => ({ x: d, y: deadStockValue }))}
          color={deadStockPct > 5 ? dangerColor : deadStockPct > 2 ? warningColor : successColor}
          hint={`${deadStockPct.toFixed(1)}% of inventory · 0 sales 90d`}
          to="/skus?filter=dead"
        />
        </div>
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
