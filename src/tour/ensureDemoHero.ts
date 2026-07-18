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

    let heroId: string | undefined;
    if (rows.length) {
      const candidates = rows.filter((r) => r.qty30 >= 30 && r.totalOnHand >= 50);
      const preferred =
        candidates.find((r) =>
          /pex|fitting|elbow|tee|copper/i.test(`${r.sku} ${r.description} ${r.category}`),
        ) ??
        candidates.sort((a, b) => b.qty30 - a.qty30)[0];
      heroId = preferred?.id;
    }
    if (!heroId) {
      const { data: any1 } = await supabase.from("products").select("id").limit(1);
      heroId = any1?.[0]?.id;
    }
    if (!heroId) return {};

    // Ensure the hero has enough history for the forecast tournament (needs
    // ~60+ weeks of weekly data). Backfill is idempotent — it only inserts
    // dates that aren't already present, so calling on every tour launch is
    // cheap after the first run.
    try {
      const { data: hist } = await supabase
        .from("sales_history")
        .select("sale_date")
        .eq("product_id", heroId)
        .order("sale_date", { ascending: true })
        .limit(1);
      const earliest = hist?.[0]?.sale_date as string | undefined;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 400); // require ~13+ months
      if (!earliest || new Date(earliest) > cutoff) {
        await supabase.functions.invoke("backfill-hero-history", {
          body: { product_id: heroId, days: 540 },
        });
      }
    } catch {
      // non-fatal — tour still runs, chart just uses whatever history exists
    }

    return { heroSkuId: heroId };
  } catch {
    return {};
  }
}
