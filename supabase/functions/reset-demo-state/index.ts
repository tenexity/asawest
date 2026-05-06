import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DYNAMIC_TABLES = [
  "sales_history",
  "inventory_levels",
  "purchase_order_items",
  "purchase_orders",
  "insights",
  "transfer_orders",
  "reorder_recommendations",
  "markdown_candidates",
  "promoted_substitutes",
  "saved_simulations",
  "chat_messages",
  "conversations",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    // Truncate dynamic tables
    for (const t of DYNAMIC_TABLES) {
      // delete-all by filtering on a never-null column
      const { error } = await supabase.from(t).delete().not("id", "is", null);
      if (error && !/column .* does not exist/i.test(error.message)) {
        // fallback for tables without id (sales_history has bigint id, ok)
        const { error: e2 } = await supabase.from(t).delete().gte("created_at", "1900-01-01");
        if (e2) console.warn(`truncate ${t}:`, error.message, e2.message);
      }
    }

    // Re-seed by calling seed-data stages
    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const headers = {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    };
    await fetch(`${base}/seed-data?stage=core`, { headers });
    // sales in chunks - keep small for demo
    for (let off = 0; off < 200; off += 50) {
      await fetch(`${base}/seed-data?stage=sales&offset=${off}&limit=50`, { headers });
    }

    // Row counts
    const counts: Record<string, number> = {};
    for (const t of DYNAMIC_TABLES) {
      const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
      counts[t] = count ?? 0;
    }

    return new Response(
      JSON.stringify({ reset_at: new Date().toISOString(), row_counts_per_table: counts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
