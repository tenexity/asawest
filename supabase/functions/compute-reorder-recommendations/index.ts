// Computes reorder recommendations for every active SKU-branch pair
// and replaces the contents of public.reorder_recommendations.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const Z = { A: 2.05, B: 1.65, C: 1.28 } as const;
const SL = { A: 0.98, B: 0.95, C: 0.9 } as const;

function isInPeakWindow(pattern: string, climate: string): boolean {
  const m = new Date().getMonth() + 1; // 1..12
  const next30Months = new Set([m, ((m % 12) + 1)]);
  if (pattern === "cooling_peak") return [5, 6, 7, 8].some((x) => next30Months.has(x));
  if (pattern === "heating_peak") return [11, 12, 1, 2].some((x) => next30Months.has(x));
  if (pattern === "freeze_event")
    return climate === "freeze_prone" && [12, 1, 2].some((x) => next30Months.has(x));
  return false;
}

function stddev(arr: number[], mean: number): number {
  if (arr.length < 2) return 0;
  const v = arr.reduce((a, x) => a + (x - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

async function fetchAll<T>(query: any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const [products, branches, suppliers, supplierProducts, inventory] = await Promise.all([
      sb.from("products").select("id, sku, abc_class, seasonality_pattern, unit_cost").then(r => r.data ?? []),
      sb.from("branches").select("id, name, climate_zone").then(r => r.data ?? []),
      sb.from("suppliers").select("id, name, lead_time_days, lead_time_variability_days, rebate_program_active").then(r => r.data ?? []),
      sb.from("supplier_products").select("supplier_id, product_id, moq, cost, is_primary").eq("is_primary", true).then(r => r.data ?? []),
      fetchAll<any>(sb.from("inventory_levels").select("branch_id, product_id, on_hand, on_order, reorder_point, safety_stock")),
    ]);

    const branchById = new Map(branches.map((b: any) => [b.id, b]));
    const productById = new Map(products.map((p: any) => [p.id, p]));
    const supplierById = new Map(suppliers.map((s: any) => [s.id, s]));
    const primarySupBy = new Map<string, any>();
    for (const sp of supplierProducts) primarySupBy.set(sp.product_id, sp);

    // Sales: last 90 days, grouped by (product, branch)
    const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    const sales = await fetchAll<any>(
      sb.from("sales_history").select("product_id, branch_id, sale_date, quantity").gte("sale_date", since),
      5000,
    );
    const salesByKey = new Map<string, Map<string, number>>(); // pid|bid -> date -> qty
    for (const s of sales) {
      const k = `${s.product_id}|${s.branch_id}`;
      let m = salesByKey.get(k);
      if (!m) { m = new Map(); salesByKey.set(k, m); }
      m.set(s.sale_date, (m.get(s.sale_date) ?? 0) + s.quantity);
    }

    const recs: any[] = [];
    const today = new Date();
    for (const inv of inventory) {
      const product = productById.get(inv.product_id);
      const branch = branchById.get(inv.branch_id);
      if (!product || !branch) continue;
      const sp = primarySupBy.get(inv.product_id);
      const supplier = sp ? supplierById.get(sp.supplier_id) : null;
      const lead = supplier?.lead_time_days ?? 14;
      const leadVar = supplier?.lead_time_variability_days ?? 3;
      const moq = sp?.moq ?? 1;
      const unitCost = Number(sp?.cost ?? product.unit_cost ?? 0);

      // Build daily demand series for last 90 days
      const dayMap = salesByKey.get(`${inv.product_id}|${inv.branch_id}`);
      const daily: number[] = new Array(90).fill(0);
      if (dayMap) {
        for (let i = 0; i < 90; i++) {
          const d = new Date(today.getTime() - (89 - i) * 86400_000).toISOString().slice(0, 10);
          daily[i] = dayMap.get(d) ?? 0;
        }
      }
      const totalSold = daily.reduce((a, x) => a + x, 0);
      let avg = totalSold / 90;
      // Fallback: derive from reorder_point if no sales (so demo data still works)
      if (avg === 0) {
        avg = Math.max((inv.reorder_point || 0) / 30, 0.05);
      }
      const stdev = stddev(daily, avg);
      const recentMax = daily.reduce((a, x) => Math.max(a, x), 0);

      // Seasonality boost
      const boost = isInPeakWindow(product.seasonality_pattern, branch.climate_zone);
      const dailyForCalc = boost ? avg * 2.5 : avg;
      const stdForCalc = boost ? stdev * 2.5 : stdev;

      const abc = (product.abc_class as "A" | "B" | "C") ?? "C";
      const z = Z[abc];
      const sl = SL[abc];
      const safety = Math.ceil(z * Math.sqrt(lead * stdForCalc * stdForCalc + dailyForCalc * dailyForCalc * leadVar * leadVar));
      const rop = Math.ceil(dailyForCalc * lead + safety);
      const rawSuggest = rop + dailyForCalc * 30 - inv.on_hand - inv.on_order;
      let suggested = Math.max(0, Math.ceil(rawSuggest));
      if (suggested > 0 && moq > 1) suggested = Math.ceil(suggested / moq) * moq;

      // Skip if nothing to order
      if (suggested <= 0) continue;

      // Rebate awareness
      let rebateOpp = false;
      let rebateThreshold: number | null = null;
      let rebateBumped: number | null = null;
      if (supplier?.rebate_program_active) {
        const thresholds = [moq * 5, moq * 10];
        for (const t of thresholds) {
          if (suggested <= t && suggested >= t * 0.85) {
            rebateOpp = true;
            rebateThreshold = t;
            rebateBumped = t;
            break;
          }
        }
      }

      // Urgency
      const dos = avg > 0 ? inv.on_hand / avg : null;
      let urgency: "critical" | "high" | "medium" | "low";
      if (inv.on_hand < safety) urgency = "critical";
      else if (inv.on_hand < rop) urgency = "high";
      else if (dos !== null && dos < 60) urgency = "medium";
      else urgency = "low";

      const financialImpact = Math.round(suggested * unitCost);

      recs.push({
        product_id: inv.product_id,
        branch_id: inv.branch_id,
        supplier_id: supplier?.id ?? null,
        urgency,
        avg_daily_demand: Number(avg.toFixed(3)),
        demand_stddev: Number(stdev.toFixed(3)),
        recent_max_day: recentMax,
        lead_time_days: lead,
        lead_time_var_days: leadVar,
        service_level: sl,
        z_score: z,
        safety_stock: safety,
        reorder_point: rop,
        on_hand: inv.on_hand,
        on_order: inv.on_order,
        days_of_supply: dos !== null ? Number(dos.toFixed(1)) : null,
        suggested_qty: suggested,
        moq,
        seasonality_boost: boost,
        seasonality_pattern: boost ? product.seasonality_pattern : null,
        rebate_opportunity: rebateOpp,
        rebate_threshold: rebateThreshold,
        rebate_bumped_qty: rebateBumped,
        unit_cost: unitCost,
        financial_impact: financialImpact,
        status: "open",
      });
    }

    // Replace existing
    await sb.from("reorder_recommendations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const chunk = 500;
    for (let i = 0; i < recs.length; i += chunk) {
      const { error } = await sb.from("reorder_recommendations").insert(recs.slice(i, i + chunk));
      if (error) throw error;
    }

    const summary = {
      total: recs.length,
      critical: recs.filter(r => r.urgency === "critical").length,
      high: recs.filter(r => r.urgency === "high").length,
      medium: recs.filter(r => r.urgency === "medium").length,
      low: recs.filter(r => r.urgency === "low").length,
      total_value_usd: recs.reduce((a, r) => a + r.financial_impact, 0),
    };

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("compute-reorder error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
