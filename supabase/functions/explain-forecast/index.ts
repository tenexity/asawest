import { corsHeaders } from "@supabase/supabase-js/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctx = await req.json();
    const userPrompt = `SKU: ${ctx.sku}
Category: ${ctx.category}
ABC/XYZ: ${ctx.abc_xyz}
Intermittent: ${ctx.is_intermittent}
Seasonal: ${ctx.is_seasonal} (${ctx.seasonality_pattern})
Recent demand stats: ${JSON.stringify(ctx.recent_demand_stats)}
Tournament results: ${JSON.stringify(ctx.tournament_results)}

Explain why the WINNING model is appropriate for this SKU.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        system:
          "You are an inventory analyst. In 2-3 sentences, explain why the winning forecast model is appropriate for this SKU's demand pattern. Be specific to the data — don't give generic explanations. If the demand is intermittent, say so. If seasonal, say so.",
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Anthropic error:", resp.status, text);
      return new Response(JSON.stringify({ error: `Anthropic error ${resp.status}`, detail: text }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const explanation =
      data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    return new Response(JSON.stringify({ explanation }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("explain-forecast error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
