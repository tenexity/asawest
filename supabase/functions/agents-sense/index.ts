import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Insight = {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  financial_impact_usd: number;
  evidence_json: any;
  recommended_action_json: any;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function severityFromImpact(usd: number): Insight["severity"] {
  if (usd >= 50000) return "critical";
  if (usd >= 15000) return "high";
  if (usd >= 3000) return "medium";
  return "low";
}

async function checkStockoutRisk(sb: any): Promise<Insight[]> {
  const { data: inv } = await sb
    .from("inventory_levels")
    .select("product_id, branch_id, on_hand, safety_stock, on_order")
    .limit(2000);
  const { data: products } = await sb.from("products").select("id, sku, description, unit_price, unit_cost");
  const { data: branches } = await sb.from("branches").select("id, name");
  const pmap = new Map(products?.map((p: any) => [p.id, p]) ?? []);
  const bmap = new Map(branches?.map((b: any) => [b.id, b.name]) ?? []);
  const out: Insight[] = [];
  for (const r of inv ?? []) {
    if (r.on_hand < r.safety_stock && r.on_order < (r.safety_stock - r.on_hand)) {
      const p: any = pmap.get(r.product_id);
      if (!p) continue;
      const gap = (r.safety_stock - r.on_hand);
      const impact = gap * Number(p.unit_price ?? 0);
      if (impact < 200) continue;
      out.push({
        type: "stockout_risk",
        severity: severityFromImpact(impact),
        title: `Stockout risk: ${p.sku} @ ${bmap.get(r.branch_id)}`,
        financial_impact_usd: Math.round(impact),
        evidence_json: { product_id: r.product_id, branch_id: r.branch_id, on_hand: r.on_hand, safety_stock: r.safety_stock, on_order: r.on_order, sku: p.sku, description: p.description, branch: bmap.get(r.branch_id) },
        recommended_action_json: { action: "create_draft_po", product_id: r.product_id, branch_id: r.branch_id, quantity: gap * 2 },
      });
    }
  }
  return out.slice(0, 25);
}

async function checkExcessInventory(sb: any): Promise<Insight[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: inv } = await sb.from("inventory_levels").select("product_id, branch_id, on_hand").gt("on_hand", 0).limit(2000);
  const { data: sales } = await sb.from("sales_history").select("product_id, branch_id, quantity").gte("sale_date", since);
  const { data: products } = await sb.from("products").select("id, sku, description, unit_cost, seasonality_pattern");
  const { data: branches } = await sb.from("branches").select("id, name");
  const pmap = new Map(products?.map((p: any) => [p.id, p]) ?? []);
  const bmap = new Map(branches?.map((b: any) => [b.id, b.name]) ?? []);
  const demand = new Map<string, number>();
  for (const s of sales ?? []) {
    const k = `${s.product_id}|${s.branch_id}`;
    demand.set(k, (demand.get(k) ?? 0) + s.quantity);
  }
  const out: Insight[] = [];
  for (const r of inv ?? []) {
    const p: any = pmap.get(r.product_id);
    if (!p) continue;
    if (p.seasonality_pattern && p.seasonality_pattern !== "none") continue;
    const totalSold = demand.get(`${r.product_id}|${r.branch_id}`) ?? 0;
    const adps = totalSold / 90;
    if (adps <= 0) continue;
    const dos = r.on_hand / adps;
    if (dos > 180) {
      const excess = Math.round(r.on_hand - adps * 90);
      const impact = excess * Number(p.unit_cost ?? 0);
      if (impact < 500) continue;
      out.push({
        type: "excess_inventory",
        severity: severityFromImpact(impact),
        title: `Excess: ${p.sku} @ ${bmap.get(r.branch_id)} (${Math.round(dos)} DOS)`,
        financial_impact_usd: Math.round(impact),
        evidence_json: { product_id: r.product_id, branch_id: r.branch_id, sku: p.sku, days_of_supply: Math.round(dos), on_hand: r.on_hand, avg_daily_sales: adps.toFixed(2), branch: bmap.get(r.branch_id) },
        recommended_action_json: { action: "log_markdown", product_id: r.product_id, branch_id: r.branch_id, excess_qty: excess },
      });
    }
  }
  return out.slice(0, 20);
}

async function checkSupplierDelays(sb: any): Promise<Insight[]> {
  const { data: late } = await sb.from("purchase_orders").select("id, supplier_id, branch_id, expected_date, ordered_date").eq("status", "late").limit(20);
  if (!late?.length) return [];
  const { data: suppliers } = await sb.from("suppliers").select("id, name");
  const { data: branches } = await sb.from("branches").select("id, name");
  const smap = new Map(suppliers?.map((s: any) => [s.id, s.name]) ?? []);
  const bmap = new Map(branches?.map((b: any) => [b.id, b.name]) ?? []);
  const out: Insight[] = [];
  for (const po of late) {
    const { data: items } = await sb.from("purchase_order_items").select("product_id, quantity, unit_cost").eq("po_id", po.id);
    const impact = (items ?? []).reduce((a: number, i: any) => a + Number(i.quantity) * Number(i.unit_cost), 0);
    if (!items?.length || impact <= 0) continue;
    out.push({
      type: "supplier_delay_impact",
      severity: severityFromImpact(impact * 0.3),
      title: `Late PO from ${smap.get(po.supplier_id)} → ${bmap.get(po.branch_id)}`,
      financial_impact_usd: Math.round(impact * 0.3),
      evidence_json: { po_id: po.id, supplier: smap.get(po.supplier_id), branch: bmap.get(po.branch_id), expected_date: po.expected_date, line_count: items?.length ?? 0, total_value: impact },
      recommended_action_json: { action: "resolve", note: "Affected SKUs will appear as separate stockout/transfer cards." },
    });
  }
  return out;
}

async function checkSubstitution(sb: any): Promise<Insight[]> {
  const { data: phaseDown } = await sb.from("products").select("id, sku, description, substitute_product_id, unit_price").eq("is_phase_down", true);
  if (!phaseDown?.length) return [];
  // Skip SKUs that already have a promoted substitute pairing on file.
  const { data: alreadyPromoted } = await sb.from("promoted_substitutes").select("product_id");
  const promotedSet = new Set((alreadyPromoted ?? []).map((r: any) => r.product_id));
  const out: Insight[] = [];
  for (const p of phaseDown) {
    if (!p.substitute_product_id) continue;
    if (promotedSet.has(p.id)) continue;
    const { data: invOrig } = await sb.from("inventory_levels").select("on_hand").eq("product_id", p.id);
    const { data: invSub } = await sb.from("inventory_levels").select("on_hand").eq("product_id", p.substitute_product_id);
    const origTotal = (invOrig ?? []).reduce((a: number, r: any) => a + r.on_hand, 0);
    const subTotal = (invSub ?? []).reduce((a: number, r: any) => a + r.on_hand, 0);
    if (origTotal < 100 && subTotal > 200) {
      const impact = origTotal * Number(p.unit_price ?? 0) * 0.5 + 8000;
      out.push({
        type: "substitution_opportunity",
        severity: "high",
        title: `Promote substitute for ${p.sku}`,
        financial_impact_usd: Math.round(impact),
        evidence_json: { product_id: p.id, sku: p.sku, description: p.description, original_on_hand: origTotal, substitute_on_hand: subTotal, substitute_id: p.substitute_product_id },
        recommended_action_json: { action: "promote_substitute", product_id: p.id, substitute_product_id: p.substitute_product_id },
      });
    }
  }
  // Cap to the top 8 highest-impact opportunities to keep the queue actionable.
  return out.sort((a, b) => b.financial_impact_usd - a.financial_impact_usd).slice(0, 8);
}

async function checkRebates(sb: any): Promise<Insight[]> {
  const { data: pos } = await sb.from("purchase_orders").select("id, supplier_id, status").in("status", ["draft", "pending"]).limit(50);
  if (!pos?.length) return [];
  const { data: suppliers } = await sb.from("suppliers").select("id, name, rebate_program_active");
  const smap = new Map(suppliers?.map((s: any) => [s.id, s]) ?? []);
  const out: Insight[] = [];
  for (const po of pos) {
    const sup: any = smap.get(po.supplier_id);
    if (!sup?.rebate_program_active) continue;
    const { data: items } = await sb.from("purchase_order_items").select("quantity, unit_cost").eq("po_id", po.id);
    const total = (items ?? []).reduce((a: number, i: any) => a + Number(i.quantity) * Number(i.unit_cost), 0);
    const threshold = 25000;
    if (total > threshold * 0.85 && total < threshold) {
      const gap = threshold - total;
      const rebate = threshold * 0.03;
      out.push({
        type: "rebate_opportunity",
        severity: "medium",
        title: `Rebate within reach: ${sup.name} PO`,
        financial_impact_usd: Math.round(rebate - gap * 0.05),
        evidence_json: { po_id: po.id, supplier: sup.name, current_total: total, threshold, gap_usd: gap, rebate_value: rebate },
        recommended_action_json: { action: "bump_po", po_id: po.id, additional_value_usd: gap },
      });
      if (out.length >= 10) break;
    }
  }
  return out;
}

async function checkInterBranchTransfers(sb: any): Promise<Insight[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: inv } = await sb.from("inventory_levels").select("product_id, branch_id, on_hand, safety_stock").limit(3000);
  const { data: sales } = await sb.from("sales_history").select("product_id, branch_id, quantity").gte("sale_date", since);
  const { data: products } = await sb.from("products").select("id, sku, description, unit_price, unit_cost");
  const { data: branches } = await sb.from("branches").select("id, name");
  const pmap = new Map(products?.map((p: any) => [p.id, p]) ?? []);
  const bmap = new Map(branches?.map((b: any) => [b.id, b.name]) ?? []);
  const demand = new Map<string, number>();
  for (const s of sales ?? []) {
    const k = `${s.product_id}|${s.branch_id}`;
    demand.set(k, (demand.get(k) ?? 0) + s.quantity);
  }
  // Group inv by product
  const byProduct = new Map<string, any[]>();
  for (const r of inv ?? []) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(r);
  }
  const out: Insight[] = [];
  for (const [pid, rows] of byProduct) {
    const p: any = pmap.get(pid);
    if (!p) continue;
    const sources: any[] = [];
    const dests: any[] = [];
    for (const r of rows) {
      const adps = (demand.get(`${pid}|${r.branch_id}`) ?? 0) / 90;
      const dos = adps > 0 ? r.on_hand / adps : 9999;
      if (dos > 120 && r.on_hand > 20) sources.push({ ...r, dos, adps });
      else if (r.on_hand < r.safety_stock || dos < 7) dests.push({ ...r, dos, adps });
    }
    for (const dest of dests) {
      const src = sources[0];
      if (!src) continue;
      const need = Math.max(dest.safety_stock - dest.on_hand, Math.ceil(dest.adps * 30));
      const movable = Math.min(need, Math.floor(src.on_hand * 0.4));
      if (movable < 5) continue;
      const transferCost = movable * 5;
      const stockoutCost = need * Number(p.unit_price ?? 0);
      const netBenefit = stockoutCost - transferCost;
      if (netBenefit < 500) continue;
      const arrival = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      out.push({
        type: "inter_branch_transfer",
        severity: severityFromImpact(netBenefit),
        title: `Transfer ${p.sku}: ${bmap.get(src.branch_id)} → ${bmap.get(dest.branch_id)}`,
        financial_impact_usd: Math.round(netBenefit),
        evidence_json: {
          product_id: pid, sku: p.sku, description: p.description,
          source_branch: bmap.get(src.branch_id), source_branch_id: src.branch_id, source_on_hand: src.on_hand, source_dos: Math.round(src.dos),
          dest_branch: bmap.get(dest.branch_id), dest_branch_id: dest.branch_id, dest_on_hand: dest.on_hand, dest_stockout_in_days: Math.round(dest.dos),
          quantity: movable, transfer_cost: transferCost, stockout_cost: Math.round(stockoutCost), expected_arrival: arrival,
        },
        recommended_action_json: { action: "create_transfer", source_branch_id: src.branch_id, dest_branch_id: dest.branch_id, product_id: pid, quantity: movable, expected_arrival: arrival },
      });
      if (out.length >= 25) return out;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const [a, b, c, d, e, f] = await Promise.all([
      checkStockoutRisk(sb), checkExcessInventory(sb), checkSupplierDelays(sb),
      checkSubstitution(sb), checkRebates(sb), checkInterBranchTransfers(sb),
    ]);
    const all = [...a, ...b, ...c, ...d, ...e, ...f];
    // Dedupe within this run by (type|title)
    const seen = new Set<string>();
    const unique = all.filter((i) => {
      const k = `${i.type}|${i.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Skip insights that already exist as open (not resolved)
    const { data: existing } = await sb
      .from("insights")
      .select("type, title")
      .is("resolved_at", null);
    const existingKeys = new Set((existing ?? []).map((r: any) => `${r.type}|${r.title}`));
    const toInsert = unique.filter((i) => !existingKeys.has(`${i.type}|${i.title}`));
    if (toInsert.length) {
      const rows = toInsert.map((i) => ({ ...i, narrative: "", status: "new" }));
      const { data: inserted, error } = await sb.from("insights").insert(rows).select("id");
      if (error) throw error;
      return new Response(JSON.stringify({ created: inserted?.length ?? 0, ids: inserted?.map((r: any) => r.id) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ created: 0, ids: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("sense error", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
