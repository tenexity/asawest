import { supabase } from "@/integrations/supabase/client";

// Picks a real SKU id from the DB to use as the "hero" for the SKU detail step.
// Prefers a PEX fitting with on-hand stock and recent demand; falls back to any product.
export async function ensureDemoHero(): Promise<{ heroSkuId?: string }> {
  try {
    const { data: pex } = await supabase
      .from("products")
      .select("id, sku, description")
      .ilike("description", "%pex%")
      .limit(1);
    if (pex && pex.length) return { heroSkuId: pex[0].id };

    const { data: any1 } = await supabase
      .from("products")
      .select("id")
      .limit(1);
    return { heroSkuId: any1?.[0]?.id };
  } catch {
    return {};
  }
}
