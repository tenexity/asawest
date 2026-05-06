import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const SYSTEM = `You are an autonomous inventory agent. Given this evidence, write (1) a clear 3-4 sentence narrative explaining the situation in business terms, and (2) a specific recommended action including SKU, branch, quantity, and timing. Be concrete. Avoid generic advice. Reply as JSON: {"narrative": "...", "action": "..."}`;

async function callClaude(evidence: any, type: string): Promise<{ narrative: string; action: string }> {
  const prompt = `Insight type: ${type}\nEvidence:\n${JSON.stringify(evidence, null, 2)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("anthropic error", res.status, txt);
    return { narrative: "Auto-narrative unavailable.", action: "Review evidence and decide manually." };
  }
  const json = await res.json();
  const text = json.content?.[0]?.text ?? "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch (_) {}
  return { narrative: text.slice(0, 600), action: "See narrative." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = body.ids;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    let insights: any[] = [];
    if (ids?.length) {
      const { data, error } = await sb.from("insights").select("id, type, evidence_json, recommended_action_json").in("id", ids);
      if (error) throw error;
      insights = data ?? [];
    } else {
      const { data, error } = await sb.from("insights").select("id, type, evidence_json, recommended_action_json").eq("status", "new").or("narrative.is.null,narrative.eq.").limit(50);
      if (error) throw error;
      insights = data ?? [];
    }
    let updated = 0;
    for (const ins of insights ?? []) {
      const { narrative, action } = await callClaude(ins.evidence_json, ins.type);
      const newAction = { ...(ins.recommended_action_json ?? {}), summary: action };
      await sb.from("insights").update({ narrative, recommended_action_json: newAction }).eq("id", ins.id);
      updated++;
    }
    return new Response(JSON.stringify({ updated }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("decide error", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
