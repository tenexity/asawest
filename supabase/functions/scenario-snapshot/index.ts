import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SNAP_TABLES = ["inventory_levels", "purchase_orders", "purchase_order_items", "insights", "reorder_recommendations", "transfer_orders"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const body = await req.json().catch(() => ({}));
  const action = body.action as "save" | "restore";

  try {
    if (action === "save") {
      const snapshot: Record<string, any[]> = {};
      for (const t of SNAP_TABLES) {
        const { data } = await supabase.from(t).select("*").limit(10000);
        snapshot[t] = data ?? [];
      }
      const { data: row, error } = await supabase
        .from("saved_scenarios")
        .insert({ name: body.name || `Snapshot ${new Date().toLocaleString()}`, snapshot_json: snapshot })
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ id: row.id, tables: Object.fromEntries(SNAP_TABLES.map(t => [t, snapshot[t].length])) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "restore") {
      const { data: scen, error } = await supabase.from("saved_scenarios").select("*").eq("id", body.id).single();
      if (error) throw error;
      const snap = scen.snapshot_json as Record<string, any[]>;
      // wipe + reload (order matters: child tables first)
      const order = ["purchase_order_items", "transfer_orders", "insights", "reorder_recommendations", "purchase_orders", "inventory_levels"];
      for (const t of order) {
        await supabase.from(t).delete().not("id", "is", null);
      }
      const reload = ["inventory_levels", "purchase_orders", "purchase_order_items", "reorder_recommendations", "insights", "transfer_orders"];
      for (const t of reload) {
        const rows = snap[t] || [];
        if (rows.length === 0) continue;
        for (let i = 0; i < rows.length; i += 500) {
          await supabase.from(t).insert(rows.slice(i, i + 500));
        }
      }
      return new Response(JSON.stringify({ restored: scen.name }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
