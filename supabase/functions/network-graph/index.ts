import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const [{ data: suppliers }, { data: branches }, { data: products }, { data: sp }, { data: inv }] =
      await Promise.all([
        supabase.from("suppliers").select("id, name"),
        supabase.from("branches").select("id, name"),
        supabase.from("products").select("id, category, unit_cost, unit_price"),
        supabase.from("supplier_products").select("supplier_id, product_id, cost"),
        supabase.from("inventory_levels").select("product_id, branch_id, on_hand"),
      ]);

    // 90-day PO spend per supplier-category
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const { data: pos } = await supabase
      .from("purchase_orders")
      .select("supplier_id, ordered_date")
      .gte("ordered_date", since.toISOString().slice(0, 10));

    // Sales last 90 days per branch x customer_type
    const { data: sales } = await supabase
      .from("sales_history")
      .select("branch_id, customer_type, quantity, product_id, sale_date")
      .gte("sale_date", since.toISOString().slice(0, 10));

    const prodMap = new Map((products ?? []).map((p: any) => [p.id, p]));
    const spByPair = new Map<string, number>(); // supplier|category -> spend approx
    const supplierProducts = new Map<string, Set<string>>(); // supplier -> productIds
    for (const r of sp ?? []) {
      const set = supplierProducts.get(r.supplier_id) ?? new Set();
      set.add(r.product_id);
      supplierProducts.set(r.supplier_id, set);
    }
    // Approximate supplier→category spend = (PO count last 90d for supplier) * avg cost in that category
    const poCount = new Map<string, number>();
    for (const p of pos ?? []) poCount.set(p.supplier_id, (poCount.get(p.supplier_id) ?? 0) + 1);

    for (const r of sp ?? []) {
      const prod: any = prodMap.get(r.product_id);
      if (!prod) continue;
      const k = `${r.supplier_id}|${prod.category}`;
      const weight = (poCount.get(r.supplier_id) ?? 1) * Number(r.cost) * 50;
      spByPair.set(k, (spByPair.get(k) ?? 0) + weight);
    }

    // Category→Branch inventory value
    const catBranch = new Map<string, number>();
    for (const i of inv ?? []) {
      const prod: any = prodMap.get(i.product_id);
      if (!prod) continue;
      const k = `${prod.category}|${i.branch_id}`;
      catBranch.set(k, (catBranch.get(k) ?? 0) + i.on_hand * Number(prod.unit_cost ?? 0));
    }

    // Branch→CustomerType sales revenue
    const branchCust = new Map<string, number>();
    for (const s of sales ?? []) {
      const prod: any = prodMap.get(s.product_id);
      if (!prod) continue;
      const k = `${s.branch_id}|${s.customer_type}`;
      branchCust.set(k, (branchCust.get(k) ?? 0) + s.quantity * Number(prod.unit_price ?? 0));
    }

    return new Response(
      JSON.stringify({
        suppliers,
        branches,
        categories: [...new Set((products ?? []).map((p: any) => p.category))],
        customer_types: [...new Set((sales ?? []).map((s: any) => s.customer_type))],
        supplier_category: Object.fromEntries(spByPair),
        category_branch: Object.fromEntries(catBranch),
        branch_customer: Object.fromEntries(branchCust),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
