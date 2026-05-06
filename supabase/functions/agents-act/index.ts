import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { insight_id } = await req.json();
    if (!insight_id) return new Response(JSON.stringify({ error: "insight_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: ins, error } = await sb.from("insights").select("*").eq("id", insight_id).single();
    if (error) throw error;
    const a = ins.recommended_action_json ?? {};
    const ev = ins.evidence_json ?? {};
    let result: any = {};

    switch (ins.type) {
      case "inter_branch_transfer": {
        const { data, error: e } = await sb.from("transfer_orders").insert({
          source_branch_id: a.source_branch_id ?? ev.source_branch_id,
          dest_branch_id: a.dest_branch_id ?? ev.dest_branch_id,
          product_id: a.product_id ?? ev.product_id,
          quantity: a.quantity ?? ev.quantity,
          expected_arrival: a.expected_arrival ?? ev.expected_arrival,
          status: "pending",
        }).select().single();
        if (e) throw e;
        result.transfer_order = data;
        break;
      }
      case "rebate_opportunity": {
        // bump first item's quantity by ~10%
        const poId = a.po_id ?? ev.po_id;
        const { data: items } = await sb.from("purchase_order_items").select("*").eq("po_id", poId).limit(1);
        if (items?.length) {
          const it = items[0];
          const newQty = Math.ceil(it.quantity * 1.15);
          await sb.from("purchase_order_items").update({ quantity: newQty }).eq("id", it.id);
          result.bumped = { po_id: poId, item_id: it.id, new_quantity: newQty };
        }
        break;
      }
      case "stockout_risk": {
        // create draft PO + line item
        const productId = a.product_id ?? ev.product_id;
        const branchId = a.branch_id ?? ev.branch_id;
        const { data: sp } = await sb.from("supplier_products").select("supplier_id, cost").eq("product_id", productId).eq("is_primary", true).limit(1).maybeSingle();
        const { data: anySp } = sp ? { data: sp } : await sb.from("supplier_products").select("supplier_id, cost").eq("product_id", productId).limit(1).maybeSingle();
        const supplier = sp ?? anySp;
        if (supplier) {
          const today = new Date().toISOString().slice(0, 10);
          const expected = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
          const { data: po, error: e } = await sb.from("purchase_orders").insert({
            supplier_id: supplier.supplier_id, branch_id: branchId,
            ordered_date: today, expected_date: expected, status: "draft",
          }).select().single();
          if (e) throw e;
          await sb.from("purchase_order_items").insert({
            po_id: po.id, product_id: productId, quantity: a.quantity ?? 50, unit_cost: supplier.cost,
          });
          result.draft_po = po;
        }
        break;
      }
      case "excess_inventory": {
        const { data, error: e } = await sb.from("markdown_candidates").insert({
          product_id: a.product_id ?? ev.product_id,
          branch_id: a.branch_id ?? ev.branch_id,
          excess_qty: a.excess_qty ?? ev.excess_qty ?? 0,
          estimated_value: ins.financial_impact_usd,
        }).select().single();
        if (e) throw e;
        result.markdown = data;
        break;
      }
      case "substitution_opportunity": {
        const productId = a.product_id ?? ev.product_id;
        const subId = a.substitute_product_id ?? ev.substitute_id;
        await sb.from("promoted_substitutes").upsert({ product_id: productId, substitute_product_id: subId, promoted_at: new Date().toISOString() });
        result.promoted = { product_id: productId, substitute_product_id: subId };
        break;
      }
      case "supplier_delay_impact":
      default:
        result.note = "Resolved without further action.";
    }

    await sb.from("insights").update({ status: "executed", resolved_at: new Date().toISOString() }).eq("id", insight_id);
    return new Response(JSON.stringify({ ok: true, result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("act error", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
