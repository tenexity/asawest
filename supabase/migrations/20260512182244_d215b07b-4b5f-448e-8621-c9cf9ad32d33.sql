
CREATE OR REPLACE FUNCTION public.skus_overview(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  result jsonb;
  d_30 date := current_date - 30;
BEGIN
  WITH inv AS (
    SELECT il.product_id, il.on_hand, il.reorder_point
    FROM inventory_levels il
    WHERE p_branch_id IS NULL OR il.branch_id = p_branch_id
  ),
  inv_agg AS (
    SELECT product_id, SUM(on_hand)::int AS total_on_hand, SUM(reorder_point)::int AS total_rp
    FROM inv GROUP BY product_id
  ),
  sales AS (
    SELECT product_id, SUM(quantity)::numeric AS qty30
    FROM sales_history
    WHERE sale_date >= d_30
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    GROUP BY product_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', p.id,
    'sku', p.sku,
    'description', p.description,
    'category', p.category,
    'abc', p.abc_class,
    'xyz', p.xyz_class,
    'totalOnHand', COALESCE(ia.total_on_hand, 0),
    'totalRP', COALESCE(ia.total_rp, 0),
    'qty30', COALESCE(s.qty30, 0)
  ))
  INTO result
  FROM products p
  LEFT JOIN inv_agg ia ON ia.product_id = p.id
  LEFT JOIN sales s ON s.product_id = p.id;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
