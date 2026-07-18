import { supabase } from "@/integrations/supabase/client";

// Picks a "hero" SKU that will demo well: has both recent sales volume
// AND on-hand inventory across branches, so the SKU Detail page shows a
// populated demand history, a real forecast tournament, and a filled
// inventory-by-branch table.
export async function ensureDemoHero(): Promise<{ heroSkuId?: string }> {
  try {
    // skus_overview returns { id, sku, description, category, qty30, totalOnHand }
    const { data } = await supabase.rpc("skus_overview", { p_branch_id: null });
    const rows = (data as Array<{
      id: string;
      sku: string;
      description: string;
      category: string;
      qty30: number;
      totalOnHand: number;
    }> | null) ?? [];

    if (rows.length) {
      // Filter to SKUs that will visibly demo: real recent demand AND stock on shelves.
      const candidates = rows.filter((r) => r.qty30 >= 30 && r.totalOnHand >= 50);
      // Prefer PEX / fittings — they match the workshop narrative — then fall
      // back to any high-signal SKU.
      const preferred =
        candidates.find((r) =>
          /pex|fitting|elbow|tee|copper/i.test(`${r.sku} ${r.description} ${r.category}`),
        ) ??
        candidates.sort((a, b) => b.qty30 - a.qty30)[0];
      if (preferred) return { heroSkuId: preferred.id };
    }

    // Fallback: any product at all
    const { data: any1 } = await supabase.from("products").select("id").limit(1);
    return { heroSkuId: any1?.[0]?.id };
  } catch {
    return {};
  }
}
