const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { summary, top_at_risk } = await req.json();
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

    const ctx = `Supplier delayed: ${summary.supplier_name}
Delay: ${summary.delay_days} days
SKUs at risk: ${summary.skus_at_risk}
Branches hit: ${summary.branches_hit}
Units affected: ${summary.units_affected}
Revenue at risk: $${summary.revenue_at_risk.toLocaleString()}

Top at-risk SKUs:
${top_at_risk
  .slice(0, 20)
  .map(
    (r: any) =>
      `- ${r.sku} (${r.description}) at ${r.branch_name}: on_hand=${r.on_hand}, days_to_stockout=${r.days_to_stockout}, units_short=${r.units_short}, substitute=${r.substitute_sku ?? "none"}, transfer_from=${r.transfer_branch ?? "none"} (${r.transfer_units ?? 0} units available)`
  )
  .join("\n")}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system:
          "You are a senior supply chain manager. Given this disruption simulation, recommend 3-5 concrete actions the distributor should take in the next 48 hours. Be specific: name SKUs, branches, and quantities where possible. Consider: alternate suppliers, inter-branch transfers, customer prioritization, substitute products (especially for R-410A → R-32/R-454B refrigerant cases), expediting existing POs. Format as a numbered list.",
        messages: [{ role: "user", content: ctx }],
      }),
    });
    const data = await resp.json();
    const text = data?.content?.[0]?.text ?? "Unable to generate recommendations.";
    return new Response(JSON.stringify({ recommendations: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
