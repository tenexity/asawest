
CREATE OR REPLACE FUNCTION public.sku_balance_plan(p_branch_id uuid DEFAULT NULL)
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
  WITH sales30 AS (
    SELECT product_id, branch_id, SUM(quantity)::numeric AS qty30
    FROM sales_history
    WHERE sale_date >= d_30
    GROUP BY product_id, branch_id
  ),
  inv AS (
    SELECT il.branch_id, il.product_id, il.on_hand, il.reorder_point, il.safety_stock,
           p.sku, p.description, p.category, p.unit_cost,
           b.name AS branch_name,
           COALESCE(s.qty30, 0) AS qty30
    FROM inventory_levels il
    JOIN products p ON p.id = il.product_id
    JOIN branches b ON b.id = il.branch_id
    LEFT JOIN sales30 s ON s.product_id = il.product_id AND s.branch_id = il.branch_id
  ),
  -- Excess candidates: on_hand > 0 AND (no 30-day demand OR >180 days of supply)
  excess_raw AS (
    SELECT *,
           CASE WHEN qty30 > 0 THEN on_hand / (qty30 / 30.0) ELSE 999 END AS dos,
           (on_hand * unit_cost)::numeric AS tied_capital
    FROM inv
    WHERE on_hand > 0
      AND (qty30 = 0 OR on_hand > (qty30 / 30.0) * 180)
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  ),
  -- Stockout / redeploy candidates: below ROP with real 30-day demand
  short_raw AS (
    SELECT *,
           GREATEST(reorder_point - on_hand, 0) AS units_short,
           (GREATEST(reorder_point - on_hand, 0) * unit_cost)::numeric AS cash_needed,
           -- priority: how many days out of stock over next 30 days
           CASE WHEN qty30 > 0
                THEN (qty30 / 30.0) * 14 * unit_cost
                ELSE 0 END AS priority_score
    FROM inv
    WHERE qty30 > 0
      AND on_hand < reorder_point
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  ),
  -- For each excess row, does another branch need this product?
  transfer_targets AS (
    SELECT e.branch_id AS from_branch, e.product_id,
           (SELECT jsonb_build_object('branch_id', s.branch_id, 'branch_name', s.branch_name, 'units_short', s.units_short)
            FROM short_raw s
            WHERE s.product_id = e.product_id AND s.branch_id <> e.branch_id
            ORDER BY s.units_short DESC LIMIT 1) AS target
    FROM excess_raw e
  ),
  -- For each excess, is there a fast mover in same category at same branch (bundle candidate)?
  bundle_targets AS (
    SELECT e.branch_id, e.product_id,
           (SELECT jsonb_build_object('sku', s.sku, 'description', s.description)
            FROM short_raw s
            WHERE s.category = e.category AND s.branch_id = e.branch_id AND s.product_id <> e.product_id
            ORDER BY s.priority_score DESC LIMIT 1) AS target
    FROM excess_raw e
  ),
  excess_disp AS (
    SELECT e.*,
           tt.target AS transfer_target,
           bt.target AS bundle_target,
           CASE
             WHEN tt.target IS NOT NULL THEN 'Transfer'
             WHEN e.tied_capital >= 500
                  AND EXISTS (SELECT 1 FROM supplier_products sp
                              JOIN suppliers su ON su.id = sp.supplier_id
                              WHERE sp.product_id = e.product_id
                                AND (su.rebate_program_active OR su.reliability_score >= 0.85))
             THEN 'Return'
             WHEN bt.target IS NOT NULL THEN 'Bundle'
             ELSE 'Markdown'
           END AS disposition
    FROM excess_raw e
    LEFT JOIN transfer_targets tt ON tt.from_branch = e.branch_id AND tt.product_id = e.product_id
    LEFT JOIN bundle_targets bt ON bt.branch_id = e.branch_id AND bt.product_id = e.product_id
  ),
  excess_final AS (
    SELECT sku, description, category, branch_id, branch_name, product_id,
           on_hand, unit_cost, tied_capital, dos, disposition,
           transfer_target, bundle_target,
           CASE disposition
             WHEN 'Transfer' THEN tied_capital
             WHEN 'Return'   THEN tied_capital * 0.85
             WHEN 'Bundle'   THEN tied_capital * 1.00
             ELSE                 tied_capital * 0.75
           END AS recoverable_cash,
           CASE disposition
             WHEN 'Transfer' THEN 'Send to ' || COALESCE(transfer_target->>'branch_name','branch')
             WHEN 'Return'   THEN 'Return to primary supplier (~85% recovery)'
             WHEN 'Bundle'   THEN 'Bundle with ' || COALESCE(bundle_target->>'sku','')
             ELSE                 'Markdown 25% to clear'
           END AS disposition_detail
    FROM excess_disp
    ORDER BY tied_capital DESC
    LIMIT 20
  ),
  short_final AS (
    SELECT sku, description, category, branch_id, branch_name, product_id,
           on_hand, reorder_point, qty30, unit_cost,
           units_short, cash_needed, priority_score,
           CASE
             WHEN on_hand = 0 THEN 'Critical'
             WHEN on_hand < reorder_point * 0.5 THEN 'Below ROP'
             ELSE 'Trending up'
           END AS priority_label
    FROM short_raw
    ORDER BY priority_score DESC
    LIMIT 20
  ),
  totals AS (
    SELECT
      (SELECT COALESCE(SUM(recoverable_cash),0) FROM excess_final) AS cash_freed,
      (SELECT COALESCE(SUM(tied_capital),0) FROM excess_final) AS capital_tied,
      (SELECT COALESCE(SUM(cash_needed),0) FROM short_final) AS cash_needed,
      (SELECT COUNT(*) FROM excess_final) AS release_count,
      (SELECT COUNT(*) FROM short_final) AS redeploy_count
  )
  SELECT jsonb_build_object(
    'releases',  (SELECT COALESCE(jsonb_agg(to_jsonb(ef)), '[]'::jsonb) FROM excess_final ef),
    'redeploys', (SELECT COALESCE(jsonb_agg(to_jsonb(sf)), '[]'::jsonb) FROM short_final sf),
    'totals',    (SELECT to_jsonb(t) FROM totals t)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sku_balance_plan(uuid) TO anon, authenticated, service_role;
