import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AtRiskRow {
  product_id: string;
  sku: string;
  description: string;
  category: string;
  branch_id: string;
  branch_name: string;
  on_hand: number;
  safety_stock: number;
  avg_daily_demand: number;
  days_to_stockout: number;
  units_short: number;
  unit_price: number;
  revenue_at_risk: number;
  is_stockout: boolean;
  recommended_action: string;
  substitute_sku?: string;
  transfer_branch?: string;
  transfer_units?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { supplier_id, delay_days = 7 } = await req.json();
    if (!supplier_id) {
      return new Response(JSON.stringify({ error: "supplier_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load supplier info
    const { data: supplier } = await supabase.from("suppliers").select("*").eq("id", supplier_id).single();
    if (!supplier) throw new Error("Supplier not found");

    // Products from this supplier
    const { data: sp } = await supabase.from("supplier_products").select("product_id").eq("supplier_id", supplier_id);
    const productIds = (sp ?? []).map((r: any) => r.product_id);
    if (productIds.length === 0) {
      return new Response(JSON.stringify({ at_risk: [], summary: emptySummary(supplier.name, delay_days) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Products
    const { data: products } = await supabase.from("products").select("*").in("id", productIds);
    const prodMap = new Map((products ?? []).map((p: any) => [p.id, p]));

    // Substitutes for these products (from products table)
    const substituteIds = (products ?? []).map((p: any) => p.substitute_product_id).filter(Boolean);
    const { data: subProducts } = substituteIds.length
      ? await supabase.from("products").select("id, sku, description").in("id", substituteIds)
      : { data: [] };
    const subMap = new Map((subProducts ?? []).map((p: any) => [p.id, p]));

    // Branches
    const { data: branches } = await supabase.from("branches").select("*");
    const branchMap = new Map((branches ?? []).map((b: any) => [b.id, b]));

    // Inventory for these products at all branches
    const { data: inventory } = await supabase
      .from("inventory_levels")
      .select("*")
      .in("product_id", productIds);

    // 90 days sales for these products
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const { data: sales } = await supabase
      .from("sales_history")
      .select("product_id, branch_id, quantity, sale_date")
      .in("product_id", productIds)
      .gte("sale_date", since.toISOString().slice(0, 10));

    // Build per (product, branch) avg daily demand
    const demandMap = new Map<string, number>();
    for (const s of sales ?? []) {
      const k = `${s.product_id}|${s.branch_id}`;
      demandMap.set(k, (demandMap.get(k) ?? 0) + (s as any).quantity);
    }

    const atRisk: AtRiskRow[] = [];
    let unitsAffected = 0;
    let revenueAtRisk = 0;
    const branchesHit = new Set<string>();
    const heatmap: Record<string, Record<string, number>> = {};

    const lt = supplier.lead_time_days ?? 14;
    const horizon = lt + delay_days + 14;

    for (const inv of inventory ?? []) {
      const product: any = prodMap.get(inv.product_id);
      if (!product) continue;
      const branch: any = branchMap.get(inv.branch_id);
      if (!branch) continue;
      const k = `${inv.product_id}|${inv.branch_id}`;
      let avgDaily = (demandMap.get(k) ?? 0) / 90;
      if (avgDaily <= 0) avgDaily = 0.05; // tiny baseline so phase-down/intermittent SKUs still surface
      // seasonality boost
      const month = new Date().getMonth();
      const isCooling = product.seasonality_pattern === "cooling_peak" && month >= 4 && month <= 8;
      const isHeating = product.seasonality_pattern === "heating_peak" && (month >= 10 || month <= 2);
      const isFreeze = product.seasonality_pattern === "freeze_event";
      if (isCooling || isHeating || isFreeze) avgDaily *= 2.5;

      // Effective inflow: assume on_order arrives at lt+delay
      const arrivalDay = lt + delay_days;
      let projected = inv.on_hand;
      let dayToBelowSS = -1;
      let dayToZero = -1;
      for (let d = 1; d <= horizon; d++) {
        projected -= avgDaily;
        if (d === arrivalDay) projected += inv.on_order;
        if (projected < inv.safety_stock && dayToBelowSS < 0) dayToBelowSS = d;
        if (projected <= 0 && dayToZero < 0) dayToZero = d;
      }

      if (dayToBelowSS < 0) continue;
      const isStockout = dayToZero > 0;
      const unitsShort = Math.max(0, Math.ceil(avgDaily * horizon - inv.on_hand - inv.on_order));
      const revenue = unitsShort * Number(product.unit_price ?? 0);

      if (isStockout) {
        unitsAffected += unitsShort;
        branchesHit.add(inv.branch_id);
      }
      revenueAtRisk += revenue;

      const cat = product.category;
      heatmap[branch.name] ??= {};
      heatmap[branch.name][cat] = (heatmap[branch.name][cat] ?? 0) + 1;

      const sub: any = product.substitute_product_id ? subMap.get(product.substitute_product_id) : null;
      let action = isStockout
        ? `Expedite PO or transfer ${unitsShort} units`
        : `Monitor — below safety stock by day ${dayToBelowSS}`;
      if (sub) action = `Substitute with ${sub.sku} (${sub.description})`;

      atRisk.push({
        product_id: product.id,
        sku: product.sku,
        description: product.description,
        category: product.category,
        branch_id: branch.id,
        branch_name: branch.name,
        on_hand: inv.on_hand,
        safety_stock: inv.safety_stock,
        avg_daily_demand: Math.round(avgDaily * 100) / 100,
        days_to_stockout: dayToZero > 0 ? dayToZero : dayToBelowSS,
        units_short: unitsShort,
        unit_price: Number(product.unit_price ?? 0),
        revenue_at_risk: Math.round(revenue),
        is_stockout: isStockout,
        recommended_action: action,
        substitute_sku: sub?.sku,
      });
    }

    // Find inter-branch transfer candidates for top stockouts
    atRisk.sort((a, b) => b.revenue_at_risk - a.revenue_at_risk);
    const topProductIds = [...new Set(atRisk.slice(0, 20).map((r) => r.product_id))];
    if (topProductIds.length) {
      const { data: allInv } = await supabase
        .from("inventory_levels")
        .select("product_id, branch_id, on_hand, safety_stock")
        .in("product_id", topProductIds);
      const surplus = new Map<string, { branch_id: string; surplus: number }[]>();
      for (const i of allInv ?? []) {
        const s = i.on_hand - i.safety_stock * 1.5;
        if (s > 5) {
          const arr = surplus.get(i.product_id) ?? [];
          arr.push({ branch_id: i.branch_id, surplus: s });
          surplus.set(i.product_id, arr);
        }
      }
      for (const r of atRisk) {
        const candidates = (surplus.get(r.product_id) ?? []).filter((c) => c.branch_id !== r.branch_id);
        candidates.sort((a, b) => b.surplus - a.surplus);
        if (candidates.length) {
          const best = candidates[0];
          const b: any = branchMap.get(best.branch_id);
          r.transfer_branch = b?.name;
          r.transfer_units = Math.min(Math.floor(best.surplus), r.units_short);
        }
      }
    }

    const summary = {
      supplier_name: supplier.name,
      delay_days,
      skus_at_risk: atRisk.length,
      units_affected: unitsAffected,
      branches_hit: branchesHit.size,
      revenue_at_risk: Math.round(revenueAtRisk),
      heatmap,
    };

    return new Response(JSON.stringify({ at_risk: atRisk, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function emptySummary(name: string, delay: number) {
  return {
    supplier_name: name,
    delay_days: delay,
    skus_at_risk: 0,
    units_affected: 0,
    branches_hit: 0,
    revenue_at_risk: 0,
    heatmap: {},
  };
}
