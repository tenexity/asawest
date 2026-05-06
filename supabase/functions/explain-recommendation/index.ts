// Generates a 2-3 sentence narrative explaining a reorder recommendation.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { recommendation_id } = await req.json();
    if (!recommendation_id) {
      return new Response(JSON.stringify({ error: "recommendation_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: rec, error } = await sb
      .from("reorder_recommendations")
      .select("*")
      .eq("id", recommendation_id)
      .maybeSingle();
    if (error || !rec) {
      return new Response(JSON.stringify({ error: error?.message || "not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const [{ data: product }, { data: branch }, { data: supplier }] = await Promise.all([
      sb.from("products").select("sku, description, abc_class, seasonality_pattern").eq("id", rec.product_id).maybeSingle(),
      sb.from("branches").select("name, city, climate_zone").eq("id", rec.branch_id).maybeSingle(),
      rec.supplier_id ? sb.from("suppliers").select("name, rebate_program_active").eq("id", rec.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const facts = {
      sku: product?.sku, description: product?.description, abc: product?.abc_class,
      branch: branch?.name, climate: branch?.climate_zone,
      supplier: supplier?.name,
      avg_daily_demand: rec.avg_daily_demand, demand_stddev: rec.demand_stddev,
      recent_max_day: rec.recent_max_day, lead_time_days: rec.lead_time_days,
      lead_time_var_days: rec.lead_time_var_days,
      safety_stock: rec.safety_stock, reorder_point: rec.reorder_point,
      on_hand: rec.on_hand, on_order: rec.on_order, days_of_supply: rec.days_of_supply,
      suggested_qty: rec.suggested_qty, moq: rec.moq, urgency: rec.urgency,
      seasonality_boost: rec.seasonality_boost, seasonality_pattern: rec.seasonality_pattern,
      rebate_opportunity: rec.rebate_opportunity, rebate_threshold: rec.rebate_threshold,
      rebate_bumped_qty: rec.rebate_bumped_qty,
      financial_impact_usd: rec.financial_impact,
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 220,
        system: "You are an inventory analyst explaining a reorder recommendation to a branch manager. Be specific to the numbers shown. Mention seasonality or rebates only if they were factors. 2-3 sentences max.",
        messages: [{ role: "user", content: `Explain this recommendation:\n${JSON.stringify(facts, null, 2)}` }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: `Anthropic ${res.status}: ${txt}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const text = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    return new Response(JSON.stringify({ narrative: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("explain-recommendation error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
