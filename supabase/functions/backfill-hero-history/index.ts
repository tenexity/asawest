// Backfills ~18 months of realistic daily sales history for a single "hero"
// product so the SKU Detail page in the guided tour has enough signal to
// render a meaningful demand chart AND a valid forecast tournament (which
// needs 60+ weeks of weekly data). Idempotent: only inserts dates that
// aren't already present for that product.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rand: () => number, lambda: number) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    const u1 = rand() || 1e-9, u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  while (p > L) { k++; p *= rand(); }
  return k - 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const productId = url.searchParams.get("product_id") ||
      (await req.json().catch(() => ({}))).product_id;
    if (!productId) {
      return new Response(JSON.stringify({ error: "product_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const days = Math.min(600, Number(url.searchParams.get("days") ?? 540));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load product + branches + existing dates
    const [{ data: product }, { data: branches }, { data: existing }] = await Promise.all([
      supabase.from("products").select("id,sku,seasonality_pattern,is_intermittent").eq("id", productId).maybeSingle(),
      supabase.from("branches").select("id,name").order("name"),
      supabase.from("sales_history").select("sale_date").eq("product_id", productId),
    ]);
    if (!product) {
      return new Response(JSON.stringify({ error: "product not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const brs = (branches ?? []) as Array<{ id: string; name: string }>;
    if (brs.length === 0) throw new Error("no branches");

    // Baseline daily demand: infer from existing recent sales (last 60 days)
    const now = new Date(); now.setUTCHours(0, 0, 0, 0);
    const dRecent = new Date(now); dRecent.setUTCDate(dRecent.getUTCDate() - 60);
    const { data: recent } = await supabase
      .from("sales_history")
      .select("quantity,sale_date")
      .eq("product_id", productId)
      .gte("sale_date", dRecent.toISOString().slice(0, 10));
    const recentTotal = (recent ?? []).reduce((a, b) => a + Number(b.quantity), 0);
    const inferredDaily = recentTotal / 60;
    // Ensure a healthy demo baseline
    const baseDaily = Math.max(2.5, inferredDaily);

    // Existing dates set (avoid duplicate PKs on (product_id, branch_id, sale_date))
    const existingByDate = new Set((existing ?? []).map((r) => r.sale_date as string));

    // Per-branch weights (stable via hash of branch id)
    const weights = brs.map((b, i) => 0.6 + ((b.id.charCodeAt(0) + i) % 7) / 10);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const perBranchBase = weights.map((w) => (baseDaily * w) / wSum);

    const rand = mulberry32(0xC0FFEE ^ productId.split("-").join("").length ^ Math.floor(baseDaily * 1000));
    const isSeasonal = product.seasonality_pattern && product.seasonality_pattern !== "none";
    const isIntermittent = !!product.is_intermittent;

    // Build rows for the last `days` days that aren't already present
    const rows: Array<{
      product_id: string; branch_id: string; sale_date: string;
      quantity: number; customer_type: string; is_will_call: boolean;
    }> = [];
    // Must match the customer_type enum in the database.
    const customerTypes = ["contractor", "walk_in", "project", "builder", "service_company"];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      if (existingByDate.has(iso)) continue; // don't clobber recent real data

      // Seasonality: yearly sinusoid + gentle upward trend
      const dayOfYear = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
      const seasonAmp = isSeasonal ? 0.45 : 0.15;
      const seasonal = 1 + seasonAmp * Math.sin((2 * Math.PI * dayOfYear) / 365 - Math.PI / 2);
      const trend = 1 + (days - i) / (days * 6); // ~+16% over the window
      const dow = d.getUTCDay();
      const weekday = dow === 0 ? 0.15 : dow === 6 ? 0.55 : 1.0; // low weekends

      for (let bi = 0; bi < brs.length; bi++) {
        const lambda = perBranchBase[bi] * seasonal * trend * weekday;
        // Intermittent: skip some days randomly
        if (isIntermittent && rand() < 0.35) continue;
        const q = poisson(rand, lambda);
        if (q <= 0) continue;
        rows.push({
          product_id: productId,
          branch_id: brs[bi].id,
          sale_date: iso,
          quantity: q,
          customer_type: customerTypes[Math.floor(rand() * customerTypes.length)],
          sale_price: 0, // populated by DB default / not required for demo
        });
      }
    }

    // Insert in chunks
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await supabase.from("sales_history").insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }

    return new Response(
      JSON.stringify({
        product_id: productId,
        sku: product.sku,
        base_daily: baseDaily,
        days_requested: days,
        inserted_rows: inserted,
        skipped_existing_dates: existingByDate.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
