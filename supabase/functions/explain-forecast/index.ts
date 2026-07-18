const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
        max_tokens: 320,
        system:
          "You brief a new inventory planner on a forecast pick they have to act on. Audience is business, not statistical — do NOT use jargon like 'WMAPE', 'Croston', 'exponential smoothing', 'alpha', 'level/trend'. Describe models in plain terms (e.g. 'flat recent average', 'trend + repeating seasonal pattern', 'intermittent-demand model that spaces out orders').\n\nReturn 3 short bullets, each ONE sentence, no preamble, no headings:\n• **Pattern:** what this SKU's demand actually looks like — call out the specific signal (seasonal peak month, spikiness, steady vs lumpy, trend up/down) using the stats provided. Cite one concrete number.\n• **Why this model wins:** why the winning model fits that pattern AND why the runners-up are worse for it (reference the error gap in plain terms like 'about X% more accurate on recent weeks').\n• **What to do:** one concrete planning action tied to the pattern — e.g. 'pre-build stock before the summer peak', 'keep safety stock high, order small and often', 'watch for the downtrend and cut reorder qty ~15%'.\n\nBe specific to the numbers. If nothing seasonal or intermittent shows up, say so plainly instead of inventing it.",


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
