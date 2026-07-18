import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// ── Vocabulary cache ─────────────────────────────────────────────
type Vocab = {
  categories: string[];
  branches: string[];
  suppliers: string[];
  seasonality: string[];
  customer_types: string[];
  abc: string[];
  xyz: string[];
};
let vocabCache: { data: Vocab; ts: number } | null = null;
const VOCAB_TTL_MS = 5 * 60 * 1000;

async function loadVocab(sb: any): Promise<Vocab> {
  if (vocabCache && Date.now() - vocabCache.ts < VOCAB_TTL_MS) return vocabCache.data;
  const [{ data: cats }, { data: brs }, { data: sups }, { data: seas }, { data: cust }] = await Promise.all([
    sb.rpc("exec_readonly_sql", { query: "SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category" }),
    sb.from("branches").select("name").order("name"),
    sb.from("suppliers").select("name").order("name").limit(50),
    sb.rpc("exec_readonly_sql", { query: "SELECT DISTINCT seasonality_pattern FROM products WHERE seasonality_pattern IS NOT NULL" }),
    sb.rpc("exec_readonly_sql", { query: "SELECT DISTINCT customer_type FROM sales_history WHERE customer_type IS NOT NULL" }),
  ]);
  const data: Vocab = {
    categories: (cats ?? []).map((r: any) => r.category).filter(Boolean),
    branches: (brs ?? []).map((r: any) => r.name),
    suppliers: (sups ?? []).map((r: any) => r.name),
    seasonality: (seas ?? []).map((r: any) => r.seasonality_pattern).filter(Boolean),
    customer_types: (cust ?? []).map((r: any) => r.customer_type).filter(Boolean),
    abc: ["A", "B", "C"],
    xyz: ["X", "Y", "Z"],
  };
  vocabCache = { data, ts: Date.now() };
  return data;
}

function buildSystemPrompt(v: Vocab): string {
  return `You are an inventory analyst for a plumbing/HVAC wholesale distributor. You answer questions about inventory, demand, suppliers, and stockout risk by querying the database via the provided tools.

## Available vocabulary (use these EXACT values, case-sensitive)

- Branches (${v.branches.length}): ${v.branches.join(", ")}
- Categories (${v.categories.length}): ${v.categories.join(", ")}
- Seasonality patterns: ${v.seasonality.join(", ") || "(none)"}
- Customer types: ${v.customer_types.join(", ") || "(none)"}
- ABC classes: A, B, C.  XYZ classes: X (steady), Y (variable), Z (erratic)
- Top suppliers (partial list, use ilike on suppliers.name for others): ${v.suppliers.slice(0, 30).join(", ")}

If a user's phrasing doesn't exactly match, map it to the closest value above before calling a tool (e.g. "atlanta warehouse" → "Atlanta"; "copper fittings" → category "Copper" OR "Fittings", pick one and note the assumption).

## Tool selection

- Prefer structured tools when they fit: find_skus, get_sku_detail, get_branch_summary, get_supplier_summary.
- Use run_inventory_query for anything the structured tools can't express (aggregations, cross-branch imbalances, ranking, joins).
- **If a tool returns { "error": ... } or an empty array, DO NOT give up.** Read the error, correct your input (fix a category name, add ilike, join a missing table), and retry. You may make up to 6 tool calls per turn.

## Schema (Postgres)

- branches(id uuid pk, name text, city text, state text, climate_zone text)
- suppliers(id uuid pk, name text, lead_time_days int, reliability_score numeric, rebate_program_active bool)
- products(id uuid pk, sku text, description text, category text, abc_class text, xyz_class text, is_intermittent bool, seasonality_pattern text, is_phase_down bool, substitute_product_id uuid, unit_price numeric, unit_cost numeric)
- supplier_products(supplier_id uuid, product_id uuid, is_primary bool, cost numeric, moq int)
- inventory_levels(branch_id uuid, product_id uuid, on_hand int, on_order int, safety_stock int, reorder_point int)
- sales_history(branch_id uuid, product_id uuid, sale_date date, quantity int, customer_type text)  -- ~500k+ rows, always filter by sale_date
- purchase_orders(id uuid, supplier_id uuid, branch_id uuid, ordered_date date, expected_date date, received_date date, status text)  -- status ∈ {open, received, late, cancelled}
- purchase_order_items(po_id uuid, product_id uuid, quantity int, unit_cost numeric)
- reorder_recommendations(product_id uuid, branch_id uuid, urgency text, suggested_qty int, financial_impact numeric, days_of_supply numeric)

## SQL patterns to imitate (for run_inventory_query)

Cross-branch imbalance (excess at one branch, short at another):
\`\`\`sql
WITH s30 AS (
  SELECT product_id, branch_id, SUM(quantity)::numeric AS q
  FROM sales_history WHERE sale_date >= current_date - 30
  GROUP BY product_id, branch_id
),
snap AS (
  SELECT il.product_id, il.branch_id, il.on_hand, il.reorder_point,
         COALESCE(s.q,0) AS q30,
         CASE WHEN COALESCE(s.q,0) > 0 THEN il.on_hand / (s.q/30.0) ELSE 999 END AS dos
  FROM inventory_levels il LEFT JOIN s30 s USING (product_id, branch_id)
)
SELECT p.sku, p.description,
       be.name AS excess_branch, ex.on_hand AS excess_on_hand, ex.dos AS excess_dos,
       bs.name AS short_branch,  sh.on_hand AS short_on_hand,  sh.reorder_point AS short_rp
FROM snap ex JOIN snap sh ON ex.product_id = sh.product_id AND ex.branch_id <> sh.branch_id
JOIN products p ON p.id = ex.product_id
JOIN branches be ON be.id = ex.branch_id
JOIN branches bs ON bs.id = sh.branch_id
WHERE ex.dos > 180 AND sh.on_hand < sh.reorder_point AND sh.q30 > 0
ORDER BY (sh.reorder_point - sh.on_hand) DESC LIMIT 25;
\`\`\`

Top stockouts by branch:
\`\`\`sql
SELECT b.name, COUNT(*) AS stockouts
FROM inventory_levels il JOIN branches b ON b.id = il.branch_id
WHERE il.on_hand = 0 GROUP BY b.name ORDER BY stockouts DESC;
\`\`\`

Supplier on-time performance (90d):
\`\`\`sql
SELECT s.name,
  COUNT(*) FILTER (WHERE po.received_date IS NOT NULL) AS received,
  COUNT(*) FILTER (WHERE po.received_date <= po.expected_date) AS on_time,
  ROUND(100.0 * COUNT(*) FILTER (WHERE po.received_date <= po.expected_date)
        / NULLIF(COUNT(*) FILTER (WHERE po.received_date IS NOT NULL),0), 1) AS on_time_pct
FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
WHERE po.ordered_date >= current_date - 90
GROUP BY s.name ORDER BY on_time_pct NULLS LAST;
\`\`\`

Rules for run_inventory_query: SELECT only; no semicolons mid-query; always LIMIT (default 100); always filter sales_history by sale_date; use ilike '%foo%' for text matching.

## Output format (STRICT — UI renders Markdown via react-markdown + remark-gfm)

Structure every answer in this order, blank lines between sections:

1. **Headline** — one bold sentence directly answering the question.
2. **Detail** — short paragraph(s) with context. Bold key numbers/SKUs.
3. **Table** — when comparing branches/SKUs/suppliers, use a GFM table with header separator:

   | Column | Column |
   | --- | --- |
   | value | value |

4. **Callouts** — optional \`-\` bullets for worst offenders.
5. **Follow-up** — END with EXACTLY this line, nothing after:

   \`NEXT_QUESTION: <one specific follow-up>\`

Use \`##\` for section headings (never bold-as-heading). Blank lines before/after tables, headings, and lists. Be concise. If the question is truly ambiguous, ask before querying (and skip NEXT_QUESTION).`;
}

const TOOLS = [
  {
    name: "find_skus",
    description: "Find SKUs filtered by category (fuzzy), branch, status, seasonality, supplier (fuzzy), phase-down. Use for 'show me SKUs where X'.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Partial or full category name; fuzzy matched." },
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
  { name: "run_inventory_query", description: "Run a read-only SELECT against the inventory DB. Use for aggregations, cross-branch analysis, rankings. Always include LIMIT.", input_schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] } },
];

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment)\b/i;

async function runTool(sb: any, name: string, input: any): Promise<{ result: any; sql?: string }> {
  switch (name) {
    case "find_skus": {
      let q = sb.from("products").select("id, sku, description, category, abc_class, xyz_class, seasonality_pattern, is_phase_down, unit_price, unit_cost").limit(input.limit ?? 50);
      if (input.category) q = q.ilike("category", `%${input.category}%`);
      if (input.seasonality) q = q.ilike("seasonality_pattern", `%${input.seasonality}%`);
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
        } else {
          return { result: { error: `No supplier matched "${input.supplier_name}". Try a partial name.` } };
        }
      }
      if (input.branch_name || input.status) {
        const { data: branches } = await sb.from("branches").select("id, name");
        const branchId = input.branch_name ? branches?.find((b: any) => b.name.toLowerCase().includes(input.branch_name.toLowerCase()))?.id : null;
        if (input.branch_name && !branchId) {
          return { result: { error: `No branch matched "${input.branch_name}". Valid branches: ${branches?.map((b: any) => b.name).join(", ")}` } };
        }
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
      const { data: p } = await sb.from("products").select("*").ilike("sku", input.sku).maybeSingle();
      if (!p) return { result: { error: `SKU "${input.sku}" not found. Try find_skus first.` } };
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
      if (!br) return { result: { error: `Branch "${input.branch_name}" not found.` } };
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
      if (!s) return { result: { error: `Supplier "${input.supplier_name}" not found.` } };
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
      if (!/^select\s/i.test(sql)) return { result: { error: "Only SELECT queries are allowed. Rewrite your query starting with SELECT." }, sql };
      if (FORBIDDEN.test(sql)) return { result: { error: "Forbidden keyword in query (insert/update/delete/etc)." }, sql };
      const limited = /\blimit\s+\d+/i.test(sql) ? sql : `${sql.replace(/;\s*$/, "")} LIMIT 100`;
      const { data, error } = await sb.rpc("exec_readonly_sql", { query: limited });
      if (error) return { result: { error: `SQL error: ${error.message}. Fix the query and try again — check column names against the schema in your system prompt.` }, sql: limited };
      return { result: data, sql: limited };
    }
  }
  return { result: { error: "Unknown tool" } };
}

async function callClaude(messages: any[], system: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      system,
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
    const vocab = await loadVocab(sb);
    const systemPrompt = buildSystemPrompt(vocab);

    const messages: any[] = (history ?? []).map((m: any) => ({ role: m.role, content: m.content }));

    const sqlExecuted: string[] = [];
    let finalText = "";
    let lastToolResultsEmpty = false;
    for (let i = 0; i < 10; i++) {
      const resp = await callClaude(messages, systemPrompt);
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
        const hasData = Array.isArray(result)
          ? result.length > 0
          : result && typeof result === "object" && !("error" in result) && Object.keys(result).length > 0;
        if (hasData) lastToolResultsEmpty = false;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 14000) });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (!finalText.trim()) {
      finalText = lastToolResultsEmpty
        ? "I ran the queries but didn't find matching records. This can happen when the demo dataset doesn't contain the specific pattern you asked about. Try a related question — e.g. *which branches have the most stockouts?* or *which SKUs are excess at Phoenix?*\n\nNEXT_QUESTION: Which branches have the most stockouts right now?"
        : "I queried the data but couldn't compose a final answer. Please try rephrasing your question.\n\nNEXT_QUESTION: Which suppliers have the worst on-time performance this quarter?";
    }

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
