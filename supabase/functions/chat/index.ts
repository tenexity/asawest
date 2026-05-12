import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const SYSTEM_PROMPT = `You are an inventory analyst for a plumbing/HVAC wholesale distributor with 5 branches (Atlanta, Charlotte, Phoenix, Dallas, Nashville) and ~10,000 SKUs. You answer questions about inventory, demand, suppliers, and stockout risk by querying the database via the provided tools.

When a question can be answered with one of the structured tools (find_skus, get_sku_detail, get_branch_summary, get_supplier_summary), prefer that. Use run_inventory_query for arbitrary aggregations.

Schema summary:
- branches(id, name, city, state, climate_zone)
- suppliers(id, name, lead_time_days, reliability_score, rebate_program_active)
- products(id, sku, description, category, abc_class, xyz_class, is_intermittent, seasonality_pattern, is_phase_down, substitute_product_id)
- supplier_products(supplier_id, product_id, is_primary)
- inventory_levels(branch_id, product_id, on_hand, on_order, safety_stock, reorder_point)
- sales_history(branch_id, product_id, sale_date, quantity, customer_type)
- purchase_orders(supplier_id, branch_id, ordered_date, expected_date, received_date, status)

## Output format (STRICT — the UI renders Markdown via react-markdown + remark-gfm)

Structure every answer EXACTLY in this order, with blank lines between sections:

1. **Headline answer** — one bold sentence directly answering the question.
2. **Supporting detail** — short paragraph(s) with context. Use **bold** for key numbers and SKUs.
3. **Data table** — when comparing branches/SKUs/suppliers, use a proper GitHub-flavored Markdown table. ALWAYS include the header separator row. Example:

   | Branch | Critical Items | Units Short | On Order |
   | --- | --- | --- | --- |
   | Atlanta | 22 PEX items | 168 | 4 |
   | Dallas | 12 PEX items | 112 | 3 |

   Never put multiple columns of data on one line as space-separated text — it will render as one wall of text.
4. **Worst offenders / callouts** — optional bullet list with \`-\` markers.
5. **Suggested next question** — END the message with EXACTLY this format on its own final line:

   \`NEXT_QUESTION: <one specific follow-up question the user might ask>\`

   The literal token \`NEXT_QUESTION:\` must be present so the UI can render it as a clickable button. No other text after it.

Rules:
- Use \`##\` for any section headings, never plain bold-as-heading.
- Always blank lines BEFORE and AFTER tables, headings, and lists, or Markdown will not render correctly.
- Be concise. If the question is ambiguous, ask before querying (and skip the NEXT_QUESTION line).`;

const TOOLS = [
  {
    name: "find_skus",
    description: "Find SKUs filtered by category, branch, status, seasonality, supplier, phase-down.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string" },
        branch_name: { type: "string" },
        status: { type: "string", enum: ["healthy", "at_risk", "stockout", "excess"] },
        seasonality: { type: "string" },
        supplier_name: { type: "string" },
        is_phase_down: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  { name: "get_sku_detail", description: "Full SKU record + inventory across branches + 90d demand stats + primary supplier.", input_schema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } },
  { name: "get_branch_summary", description: "Branch info, top problem SKUs, fill rate, stockout count, late POs.", input_schema: { type: "object", properties: { branch_name: { type: "string" } }, required: ["branch_name"] } },
  { name: "get_supplier_summary", description: "Supplier info, SKU count, lead time, on-time %, late POs, 90d spend.", input_schema: { type: "object", properties: { supplier_name: { type: "string" } }, required: ["supplier_name"] } },
  { name: "run_inventory_query", description: "Run a read-only SELECT query against the inventory database. Limit to 200 rows.", input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
];

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment)\b/i;

async function runTool(sb: any, name: string, input: any): Promise<{ result: any; sql?: string }> {
  switch (name) {
    case "find_skus": {
      let q = sb.from("products").select("id, sku, description, category, abc_class, xyz_class, seasonality_pattern, is_phase_down, unit_price, unit_cost").limit(input.limit ?? 50);
      if (input.category) q = q.eq("category", input.category);
      if (input.seasonality) q = q.eq("seasonality_pattern", input.seasonality);
      if (input.is_phase_down !== undefined) q = q.eq("is_phase_down", input.is_phase_down);
      const { data: products, error } = await q;
      if (error) return { result: { error: error.message } };
      let rows = products ?? [];
      if (input.supplier_name) {
        const { data: sup } = await sb.from("suppliers").select("id").ilike("name", `%${input.supplier_name}%`).maybeSingle();
        if (sup) {
          const { data: sps } = await sb.from("supplier_products").select("product_id").eq("supplier_id", sup.id);
          const ids = new Set(sps?.map((s: any) => s.product_id));
          rows = rows.filter((r: any) => ids.has(r.id));
        }
      }
      if (input.branch_name || input.status) {
        const { data: branches } = await sb.from("branches").select("id, name");
        const branchId = input.branch_name ? branches?.find((b: any) => b.name.toLowerCase().includes(input.branch_name.toLowerCase()))?.id : null;
        let invQ = sb.from("inventory_levels").select("product_id, branch_id, on_hand, safety_stock, reorder_point").in("product_id", rows.map((r: any) => r.id));
        if (branchId) invQ = invQ.eq("branch_id", branchId);
        const { data: inv } = await invQ;
        const byProduct = new Map<string, any[]>();
        for (const r of inv ?? []) {
          if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
          byProduct.get(r.product_id)!.push(r);
        }
        rows = rows.map((r: any) => {
          const i = byProduct.get(r.id) ?? [];
          const total = i.reduce((a, x) => a + x.on_hand, 0);
          const safety = i.reduce((a, x) => a + x.safety_stock, 0);
          let status = "healthy";
          if (total === 0) status = "stockout";
          else if (total < safety) status = "at_risk";
          else if (total > safety * 6) status = "excess";
          return { ...r, on_hand: total, status };
        });
        if (input.status) rows = rows.filter((r: any) => r.status === input.status);
      }
      return { result: rows.slice(0, input.limit ?? 50) };
    }
    case "get_sku_detail": {
      const { data: p } = await sb.from("products").select("*").eq("sku", input.sku).maybeSingle();
      if (!p) return { result: { error: "SKU not found" } };
      const { data: inv } = await sb.from("inventory_levels").select("branch_id, on_hand, on_order, safety_stock, reorder_point").eq("product_id", p.id);
      const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const { data: sales } = await sb.from("sales_history").select("quantity, sale_date, branch_id").eq("product_id", p.id).gte("sale_date", since);
      const total90 = (sales ?? []).reduce((a, s) => a + s.quantity, 0);
      const { data: sp } = await sb.from("supplier_products").select("supplier_id, cost, moq, is_primary").eq("product_id", p.id).eq("is_primary", true).maybeSingle();
      const supplier = sp ? (await sb.from("suppliers").select("name, lead_time_days, reliability_score").eq("id", sp.supplier_id).maybeSingle()).data : null;
      const { data: rec } = await sb.from("reorder_recommendations").select("urgency, suggested_qty, financial_impact, days_of_supply").eq("product_id", p.id).limit(5);
      return { result: { product: p, inventory: inv, demand_90d: { total_units: total90, avg_per_day: (total90 / 90).toFixed(2) }, primary_supplier: supplier, recommendations: rec } };
    }
    case "get_branch_summary": {
      const { data: br } = await sb.from("branches").select("*").ilike("name", `%${input.branch_name}%`).maybeSingle();
      if (!br) return { result: { error: "Branch not found" } };
      const { data: inv } = await sb.from("inventory_levels").select("product_id, on_hand, safety_stock, products(sku, description, unit_cost, unit_price)").eq("branch_id", br.id);
      const stockouts = (inv ?? []).filter((r: any) => r.on_hand === 0).length;
      const atRisk = (inv ?? []).filter((r: any) => r.on_hand < r.safety_stock).length;
      const totalValue = (inv ?? []).reduce((a: number, r: any) => a + r.on_hand * Number(r.products?.unit_cost ?? 0), 0);
      const problems = (inv ?? []).filter((r: any) => r.on_hand < r.safety_stock).slice(0, 10).map((r: any) => ({ sku: r.products?.sku, on_hand: r.on_hand, safety_stock: r.safety_stock }));
      const { data: latePOs } = await sb.from("purchase_orders").select("id").eq("branch_id", br.id).eq("status", "late");
      return { result: { branch: br, stockout_count: stockouts, at_risk_count: atRisk, fill_rate: ((1 - stockouts / Math.max(inv?.length ?? 1, 1)) * 100).toFixed(1) + "%", total_inventory_value_usd: Math.round(totalValue), top_problem_skus: problems, late_po_count: latePOs?.length ?? 0 } };
    }
    case "get_supplier_summary": {
      const { data: s } = await sb.from("suppliers").select("*").ilike("name", `%${input.supplier_name}%`).maybeSingle();
      if (!s) return { result: { error: "Supplier not found" } };
      const { data: sp } = await sb.from("supplier_products").select("product_id").eq("supplier_id", s.id);
      const { data: pos } = await sb.from("purchase_orders").select("id, status, ordered_date, expected_date, received_date").eq("supplier_id", s.id);
      const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const recent = (pos ?? []).filter((p: any) => p.ordered_date >= since90);
      const onTime = recent.filter((p: any) => p.received_date && p.received_date <= p.expected_date).length;
      const totalReceived = recent.filter((p: any) => p.received_date).length;
      const { data: items } = await sb.from("purchase_order_items").select("quantity, unit_cost, po_id").in("po_id", recent.map((p: any) => p.id));
      const spend = (items ?? []).reduce((a: number, i: any) => a + Number(i.quantity) * Number(i.unit_cost), 0);
      return { result: { supplier: s, sku_count: sp?.length ?? 0, late_pos: (pos ?? []).filter((p: any) => p.status === "late").length, on_time_pct: totalReceived ? Math.round((onTime / totalReceived) * 100) : null, spend_90d_usd: Math.round(spend) } };
    }
    case "run_inventory_query": {
      const sql = String(input.sql ?? "").trim();
      if (!/^select\s/i.test(sql)) return { result: { error: "Only SELECT queries are allowed" }, sql };
      if (FORBIDDEN.test(sql)) return { result: { error: "Forbidden keyword in query" }, sql };
      const limited = /\blimit\s+\d+/i.test(sql) ? sql : `${sql.replace(/;\s*$/, "")} LIMIT 200`;
      const { data, error } = await sb.rpc("exec_readonly_sql", { query: limited });
      if (error) return { result: { error: error.message }, sql: limited };
      return { result: data, sql: limited };
    }
  }
  return { result: { error: "Unknown tool" } };
}

async function callClaude(messages: any[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const sbAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await sbAuth.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { conversation_id, history } = await req.json();
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const messages: any[] = (history ?? []).map((m: any) => ({ role: m.role, content: m.content }));

    const sqlExecuted: string[] = [];
    let finalText = "";
    let lastToolResultsEmpty = false;
    for (let i = 0; i < 8; i++) {
      const resp = await callClaude(messages);
      messages.push({ role: "assistant", content: resp.content });
      const toolUses = resp.content.filter((c: any) => c.type === "tool_use");
      if (!toolUses.length) {
        finalText = resp.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        break;
      }
      const toolResults = [];
      lastToolResultsEmpty = true;
      for (const tu of toolUses) {
        const { result, sql } = await runTool(sb, tu.name, tu.input);
        if (sql) sqlExecuted.push(sql);
        if (tu.name !== "run_inventory_query" && tu.input) {
          sqlExecuted.push(`-- tool: ${tu.name}(${JSON.stringify(tu.input)})`);
        }
        // Track whether any tool returned data
        const hasData = Array.isArray(result)
          ? result.length > 0
          : result && typeof result === "object" && !("error" in result) && Object.keys(result).length > 0;
        if (hasData) lastToolResultsEmpty = false;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 12000) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // Fallback if Claude returned no text (e.g. exhausted tool loop or stopped after a tool call)
    if (!finalText.trim()) {
      finalText = lastToolResultsEmpty
        ? "I ran the queries but didn't find any matching records in the current data. This can happen when the demo dataset doesn't contain the specific pattern you're asking about (for example, the same SKU being excess at one branch *and* at-risk at another). Try a related question — e.g. *which branches have the most stockouts?* or *which SKUs are excess at Phoenix?* — or reset the demo data from the Demo panel.\n\nNEXT_QUESTION: Which branches have the most stockouts right now?"
        : "I queried the data but couldn't compose a final answer. Please try rephrasing your question.\n\nNEXT_QUESTION: Which suppliers have the worst on-time performance this quarter?";
    }

    // Persist messages
    const lastUser = (history ?? []).filter((m: any) => m.role === "user").pop();
    if (lastUser) {
      await sb.from("chat_messages").insert({ conversation_id, user_id: user.id, role: "user", content: lastUser.content });
    }
    await sb.from("chat_messages").insert({
      conversation_id, user_id: user.id, role: "assistant", content: finalText, tool_calls: sqlExecuted,
    });
    await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation_id);

    return new Response(JSON.stringify({ content: finalText, sql: sqlExecuted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("chat error", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
