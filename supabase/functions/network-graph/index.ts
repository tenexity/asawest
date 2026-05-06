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

    const [suppliers, branches, products, sp, sales] = await Promise.all([
      fetchAll<any>("suppliers", "id, name"),
      fetchAll<any>("branches", "id, name"),
      fetchAll<any>("products", "id, category, unit_cost, unit_price"),
      fetchAll<any>("supplier_products", "supplier_id, product_id, is_primary"),
      fetchAll<any>("sales_history", "branch_id, customer_type, quantity, product_id, sale_date", (q) => q.gte("sale_date", sinceStr)),
    ]);

    const prodMap = new Map((products ?? []).map((p: any) => [p.id, p]));

    // Single common metric across all three tiers: 90-day COGS
    // (units sold in last 90d * product unit_cost). This makes the three
    // edge tiers reconcile: dollars in (supplier→category) ≈ dollars
    // through (category→branch) ≈ dollars out (branch→customer) for
    // each category.

    // Aggregate 90-day COGS per (product, branch)
    const cogsByProdBranch = new Map<string, number>();
    const cogsByProd = new Map<string, number>();
    for (const s of sales ?? []) {
      const prod: any = prodMap.get(s.product_id);
      if (!prod) continue;
      const cogs = s.quantity * Number(prod.unit_cost ?? 0);
      const k = `${s.product_id}|${s.branch_id}`;
      cogsByProdBranch.set(k, (cogsByProdBranch.get(k) ?? 0) + cogs);
      cogsByProd.set(s.product_id, (cogsByProd.get(s.product_id) ?? 0) + cogs);
    }

    // Supplier → Category: allocate each product's 90-day COGS to its
    // primary supplier (fallback: split evenly across listed suppliers).
    const suppliersByProduct = new Map<string, { primary?: string; all: string[] }>();
    for (const r of sp ?? []) {
      const entry = suppliersByProduct.get(r.product_id) ?? { all: [] as string[] };
      entry.all.push(r.supplier_id);
      if (r.is_primary) entry.primary = r.supplier_id;
      suppliersByProduct.set(r.product_id, entry);
    }
    const spByPair = new Map<string, number>();
    for (const [productId, cogs] of cogsByProd) {
      const prod: any = prodMap.get(productId);
      if (!prod) continue;
      const link = suppliersByProduct.get(productId);
      if (!link || link.all.length === 0) continue;
      if (link.primary) {
        const k = `${link.primary}|${prod.category}`;
        spByPair.set(k, (spByPair.get(k) ?? 0) + cogs);
      } else {
        const share = cogs / link.all.length;
        for (const sid of link.all) {
          const k = `${sid}|${prod.category}`;
          spByPair.set(k, (spByPair.get(k) ?? 0) + share);
        }
      }
    }

    // Category → Branch: 90-day COGS by (category, branch)
    const catBranch = new Map<string, number>();
    for (const [key, cogs] of cogsByProdBranch) {
      const [productId, branchId] = key.split("|");
      const prod: any = prodMap.get(productId);
      if (!prod) continue;
      const k = `${prod.category}|${branchId}`;
      catBranch.set(k, (catBranch.get(k) ?? 0) + cogs);
    }

    // Branch → CustomerType: 90-day COGS by (branch, customer_type)
    const branchCust = new Map<string, number>();
    for (const s of sales ?? []) {
      const prod: any = prodMap.get(s.product_id);
      if (!prod) continue;
      const k = `${s.branch_id}|${s.customer_type}`;
      branchCust.set(k, (branchCust.get(k) ?? 0) + s.quantity * Number(prod.unit_cost ?? 0));
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
