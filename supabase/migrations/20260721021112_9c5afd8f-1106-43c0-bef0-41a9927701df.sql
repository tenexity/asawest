CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON public.sales_history (sale_date);

CREATE OR REPLACE FUNCTION public.network_graph_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  result jsonb;
  since_date date := current_date - 90;
BEGIN
  WITH sales90 AS (
    SELECT s.branch_id, s.customer_type, s.product_id,
           p.category, p.unit_cost,
           (s.quantity * COALESCE(p.unit_cost, 0))::numeric AS cogs
    FROM sales_history s
    JOIN products p ON p.id = s.product_id
    WHERE s.sale_date >= since_date
  ),
  prod_supplier AS (
    SELECT sp.product_id,
           (ARRAY_AGG(sp.supplier_id) FILTER (WHERE sp.is_primary))[1] AS primary_supplier,
           ARRAY_AGG(sp.supplier_id) AS all_suppliers
    FROM supplier_products sp
    GROUP BY sp.product_id
  ),
  prod_cogs AS (
    SELECT product_id, category, SUM(cogs) AS cogs
    FROM sales90
    GROUP BY product_id, category
  ),
  sup_cat AS (
    SELECT
      COALESCE(ps.primary_supplier, unnested.sid) AS supplier_id,
      pc.category,
      CASE WHEN ps.primary_supplier IS NOT NULL
           THEN pc.cogs
           ELSE pc.cogs / GREATEST(array_length(ps.all_suppliers, 1), 1)
      END AS cogs
    FROM prod_cogs pc
    JOIN prod_supplier ps ON ps.product_id = pc.product_id
    LEFT JOIN LATERAL UNNEST(
      CASE WHEN ps.primary_supplier IS NULL THEN ps.all_suppliers ELSE ARRAY[ps.primary_supplier] END
    ) AS unnested(sid) ON true
  ),
  sup_cat_agg AS (
    SELECT supplier_id, category, SUM(cogs) AS cogs
    FROM sup_cat
    GROUP BY supplier_id, category
  ),
  cat_branch AS (
    SELECT category, branch_id, SUM(cogs) AS cogs
    FROM sales90
    GROUP BY category, branch_id
  ),
  branch_cust AS (
    SELECT branch_id, customer_type, SUM(cogs) AS cogs
    FROM sales90
    GROUP BY branch_id, customer_type
  )
  SELECT jsonb_build_object(
    'suppliers', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name)) FROM suppliers),
    'branches', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name)) FROM branches),
    'categories', (SELECT jsonb_agg(DISTINCT category) FROM products),
    'customer_types', (SELECT jsonb_agg(DISTINCT customer_type) FROM sales90),
    'supplier_category', (
      SELECT COALESCE(jsonb_object_agg(supplier_id::text || '|' || category::text, cogs), '{}'::jsonb)
      FROM sup_cat_agg
    ),
    'category_branch', (
      SELECT COALESCE(jsonb_object_agg(category::text || '|' || branch_id::text, cogs), '{}'::jsonb)
      FROM cat_branch
    ),
    'branch_customer', (
      SELECT COALESCE(jsonb_object_agg(branch_id::text || '|' || customer_type::text, cogs), '{}'::jsonb)
      FROM branch_cust
    )
  ) INTO result;

  RETURN result;
END;
$function$;