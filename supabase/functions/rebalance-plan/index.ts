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

    const { releases, redeploys, totals } = await req.json();

    const relLines = (releases ?? [])
      .slice(0, 20)
      .map((r: any) =>
        `- ${r.sku} @ ${r.branch_name}: ${r.on_hand} units, $${Math.round(r.tied_capital).toLocaleString()} tied — ${r.disposition} (${r.disposition_detail}), recovers ~$${Math.round(r.recoverable_cash).toLocaleString()}`,
      )
      .join("\n");

    const redLines = (redeploys ?? [])
      .slice(0, 20)
      .map((r: any) =>
        `- ${r.sku} @ ${r.branch_name}: short ${r.units_short} units, needs $${Math.round(r.cash_needed).toLocaleString()} — ${r.priority_label}`,
      )
      .join("\n");

    const userPrompt = `WORKING CAPITAL REBALANCE PLAN

Totals:
- Capital tied in excess: $${Math.round(totals?.capital_tied ?? 0).toLocaleString()}
- Cash recoverable via disposition: $${Math.round(totals?.cash_freed ?? 0).toLocaleString()}
- Cash needed to fix stockouts: $${Math.round(totals?.cash_needed ?? 0).toLocaleString()}

RELEASE candidates (excess → cash):
${relLines || "(none)"}

REDEPLOY candidates (cash → fast movers):
${redLines || "(none)"}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system:
          "You brief a working-capital rebalance plan for a distributor. Audience is business, not statistical. No jargon. Return exactly 3 short markdown bullets, each ONE sentence, no preamble, no headings:\n" +
          "• **The play:** one sentence naming the dollars freed, dollars redeployed, and net working-capital lift.\n" +
          "• **Why now:** name the 2–3 specific SKUs (with branch) that drive most of the value, and what makes them the biggest wins.\n" +
          "• **First move this week:** the single highest-ROI action to take in the next 5 business days — name the SKU, branch, disposition, and dollar amount.\n" +
          "Be concrete. Use the numbers provided. Never invent SKUs.",
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
    const plan = data?.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "";
    return new Response(JSON.stringify({ plan }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("rebalance-plan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
