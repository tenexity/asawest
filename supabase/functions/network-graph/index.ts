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
    // Helper: page through tables to bypass the 1000-row default limit
    async function fetchAll<T = any>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
      const pageSize = 1000;
      let from = 0;
      const out: T[] = [];
      while (true) {
        let q: any = supabase.from(table).select(columns).range(from, from + pageSize - 1);
        if (filter) q = filter(q);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        out.push(...(data as T[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return out;
    }

    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString().slice(0, 10);

    const [suppliers, branches, products, sp, inv, pos, sales] = await Promise.all([
      fetchAll<any>("suppliers", "id, name"),
      fetchAll<any>("branches", "id, name"),
      fetchAll<any>("products", "id, category, unit_cost, unit_price"),
      fetchAll<any>("supplier_products", "supplier_id, product_id, cost"),
      fetchAll<any>("inventory_levels", "product_id, branch_id, on_hand"),
      fetchAll<any>("purchase_orders", "supplier_id, ordered_date", (q) => q.gte("ordered_date", sinceStr)),
      fetchAll<any>("sales_history", "branch_id, customer_type, quantity, product_id, sale_date", (q) => q.gte("sale_date", sinceStr)),
    ]);

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
