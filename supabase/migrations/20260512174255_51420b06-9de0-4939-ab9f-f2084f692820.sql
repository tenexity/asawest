
CREATE OR REPLACE FUNCTION public.dashboard_summary(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  result jsonb;
  d_today date := current_date;
  d_30 date := current_date - 30;
  d_60 date := current_date - 60;
  d_90 date := current_date - 90;
BEGIN
  WITH inv AS (
    SELECT il.branch_id, il.product_id, il.on_hand, il.reorder_point, il.safety_stock,
           p.unit_cost, p.sku, p.description
    FROM inventory_levels il
    JOIN products p ON p.id = il.product_id
    WHERE p_branch_id IS NULL OR il.branch_id = p_branch_id
  ),
  s90 AS (
    SELECT branch_id, product_id, sale_date, quantity
    FROM sales_history
    WHERE sale_date >= d_90
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  ),
  pair_30 AS (
    SELECT branch_id, product_id, SUM(quantity)::numeric AS qty30
    FROM s90 WHERE sale_date >= d_30
    GROUP BY branch_id, product_id
  ),
  active_pairs AS (
    SELECT DISTINCT branch_id, product_id FROM s90
  ),
  inv_with_demand AS (
    SELECT i.*,
           COALESCE(p30.qty30, 0) AS qty30,
           CASE WHEN COALESCE(p30.qty30, 0) > 0
                THEN i.on_hand / (p30.qty30 / 30.0)
                WHEN i.on_hand > 0 THEN 999
                ELSE 0 END AS dos,
           EXISTS (SELECT 1 FROM active_pairs ap
                   WHERE ap.branch_id = i.branch_id AND ap.product_id = i.product_id) AS active90
    FROM inv i
    LEFT JOIN pair_30 p30
      ON p30.branch_id = i.branch_id AND p30.product_id = i.product_id
  ),
  kpi_totals AS (
    SELECT
      SUM(on_hand * unit_cost)::numeric AS total_value,
      COUNT(*) FILTER (WHERE on_hand = 0) AS stockout_pairs,
      COUNT(*) AS total_pairs,
      -- Active pairs (had any sale in last 90d) used for fill-rate denominator
      COUNT(*) FILTER (WHERE active90) AS active_pairs,
      -- Adequately stocked = active AND on_hand >= safety_stock (and >0)
      COUNT(*) FILTER (WHERE active90 AND on_hand >= safety_stock AND on_hand > 0) AS well_stocked_pairs,
      SUM(CASE WHEN on_hand > 0 AND NOT active90
               THEN on_hand * unit_cost ELSE 0 END)::numeric AS dead_value,
      AVG(CASE WHEN qty30 > 0 THEN on_hand / (qty30/30.0) END)::numeric AS avg_dos
    FROM inv_with_demand
  ),
  cogs_totals AS (
    SELECT
      SUM(s.quantity * COALESCE(p.unit_cost,0))::numeric AS cogs90,
      SUM(s.quantity) FILTER (WHERE s.sale_date >= d_30)::numeric AS demand30,
      SUM(s.quantity) FILTER (WHERE s.sale_date >= d_60 AND s.sale_date < d_30)::numeric AS demand_prev,
      SUM(s.quantity * COALESCE(p.unit_cost,0)) FILTER (WHERE s.sale_date >= d_30)::numeric AS cogs30,
      SUM(s.quantity * COALESCE(p.unit_cost,0)) FILTER (WHERE s.sale_date >= d_60 AND s.sale_date < d_30)::numeric AS cogs_prev
    FROM s90 s
    JOIN products p ON p.id = s.product_id
  ),
  daily AS (
    SELECT g::date AS day FROM generate_series(d_today - 29, d_today, '1 day') g
  ),
  daily_sales AS (
    SELECT s.sale_date AS day,
           SUM(s.quantity)::int AS demand,
           SUM(s.quantity * COALESCE(p.unit_cost,0))::numeric AS cogs,
           COUNT(DISTINCT s.branch_id::text || '|' || s.product_id::text) AS pairs_sold
    FROM s90 s JOIN products p ON p.id = s.product_id
    WHERE s.sale_date >= d_today - 29
    GROUP BY s.sale_date
  ),
  daily_full AS (
    SELECT d.day,
           COALESCE(ds.demand, 0) AS demand,
           COALESCE(ds.cogs, 0) AS cogs,
           COALESCE(ds.pairs_sold, 0) AS pairs_sold
    FROM daily d LEFT JOIN daily_sales ds ON ds.day = d.day
    ORDER BY d.day
  ),
  problems AS (
    SELECT sku, description AS desc,
           CASE
             WHEN on_hand = 0 AND qty30 > 0 THEN 'Stockout'
             WHEN reorder_point > 0 AND on_hand < reorder_point AND qty30 > 0 THEN 'Below ROP'
             WHEN dos > 180 AND on_hand > 0 THEN 'Excess'
           END AS reason,
           on_hand, reorder_point AS rp, dos,
           CASE
             WHEN on_hand = 0 AND qty30 > 0 THEN (qty30/30.0) * 14 * unit_cost
             WHEN reorder_point > 0 AND on_hand < reorder_point AND qty30 > 0 THEN (reorder_point - on_hand) * unit_cost
             WHEN dos > 180 AND on_hand > 0 THEN on_hand * unit_cost
           END AS impact,
           CASE
             WHEN on_hand = 0 AND qty30 > 0 THEN 1 + ((qty30/30.0)*14*unit_cost)/1e6
             WHEN reorder_point > 0 AND on_hand < reorder_point AND qty30 > 0
               THEN 0.5 + LEAST(0.49, ((reorder_point - on_hand)::numeric / NULLIF(reorder_point,0)) * 0.49)
             WHEN dos > 180 AND on_hand > 0 THEN 0.3 + LEAST(0.2, on_hand*unit_cost/1e6)
           END AS severity
    FROM inv_with_demand
  ),
  problems_top AS (
    SELECT * FROM problems WHERE reason IS NOT NULL ORDER BY severity DESC NULLS LAST LIMIT 10
  ),
  branch_rows AS (
    SELECT b.id, b.name,
           COUNT(*) FILTER (WHERE i.active90) AS active,
           COUNT(*) FILTER (WHERE i.active90 AND i.on_hand >= i.safety_stock AND i.on_hand > 0) AS well_stocked,
           COUNT(*) FILTER (WHERE i.on_hand = 0) AS so,
           SUM(i.on_hand * i.unit_cost)::numeric AS value,
           COUNT(*) FILTER (WHERE i.dos > 180 AND i.qty30 > 0) AS excess,
           AVG(CASE WHEN i.qty30 > 0 THEN i.on_hand / (i.qty30/30.0) END)::numeric AS dos
    FROM branches b
    LEFT JOIN inv_with_demand i ON i.branch_id = b.id
    WHERE p_branch_id IS NULL OR b.id = p_branch_id
    GROUP BY b.id, b.name
    ORDER BY b.name
  )
  SELECT jsonb_build_object(
    'branches', (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name) FROM branches),
    'kpis', (SELECT jsonb_build_object(
      'total_value', COALESCE(kt.total_value,0),
      'stockout_pairs', kt.stockout_pairs,
      'total_pairs', kt.total_pairs,
      'active_pairs', kt.active_pairs,
      'well_stocked_pairs', kt.well_stocked_pairs,
      'avg_dos', COALESCE(kt.avg_dos, 0),
      'dead_value', COALESCE(kt.dead_value, 0),
      'demand30', COALESCE(ct.demand30,0),
      'demand_prev', COALESCE(ct.demand_prev,0),
      'cogs30', COALESCE(ct.cogs30,0),
      'cogs_prev', COALESCE(ct.cogs_prev,0),
      'cogs90', COALESCE(ct.cogs90,0)
    ) FROM kpi_totals kt, cogs_totals ct),
    'daily', (SELECT jsonb_agg(jsonb_build_object('day', day, 'demand', demand, 'cogs', cogs, 'pairs_sold', pairs_sold) ORDER BY day) FROM daily_full),
    'total_active_pairs', (SELECT COUNT(*) FROM active_pairs),
    'stockout_pair_keys', (SELECT COALESCE(jsonb_agg(branch_id::text || '|' || product_id::text), '[]'::jsonb)
                           FROM inv_with_demand WHERE on_hand = 0),
    'problems', (SELECT COALESCE(jsonb_agg(to_jsonb(problems_top)), '[]'::jsonb) FROM problems_top),
    'branch_rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name,
        'so', so, 'excess', excess, 'value', COALESCE(value,0), 'dos', COALESCE(dos,0),
        'fr', CASE WHEN active > 0
                   THEN (well_stocked::numeric / active) * 100
                   ELSE 0 END
      )), '[]'::jsonb) FROM branch_rows)
  ) INTO result;

  RETURN result;
END;
$$;
