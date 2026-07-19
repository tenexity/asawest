
CREATE OR REPLACE FUNCTION public.sku_balance_plan(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
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
  excess_raw AS (
    SELECT *,
           CASE WHEN qty30 > 0 THEN on_hand / (qty30 / 30.0) ELSE 999 END AS dos,
           (on_hand * unit_cost)::numeric AS tied_capital
    FROM inv
    WHERE on_hand > 0
      AND (qty30 = 0 OR on_hand > (qty30 / 30.0) * 180)
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  ),
  short_raw AS (
    SELECT *,
           GREATEST(reorder_point - on_hand, 0) AS units_short,
           (GREATEST(reorder_point - on_hand, 0) * unit_cost)::numeric AS cash_needed,
           CASE WHEN qty30 > 0
                THEN (qty30 / 30.0) * 14 * unit_cost
                ELSE 0 END AS priority_score
    FROM inv
    WHERE qty30 > 0
      AND on_hand < reorder_point
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
  ),
  transfer_targets AS (
    SELECT e.branch_id AS from_branch, e.product_id,
           (SELECT jsonb_build_object('branch_id', s.branch_id, 'branch_name', s.branch_name, 'units_short', s.units_short)
            FROM short_raw s
            WHERE s.product_id = e.product_id AND s.branch_id <> e.branch_id
            ORDER BY s.units_short DESC LIMIT 1) AS target
    FROM excess_raw e
  ),
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
  -- Absorption candidates: every OTHER branch carrying this product with real velocity.
  -- Headroom = units it could take before hitting 180 days of supply. Excludes source.
  absorption_all AS (
    SELECT e.product_id, e.branch_id AS from_branch,
           i2.branch_id AS to_branch_id, i2.branch_name AS to_branch_name,
           i2.on_hand AS dest_on_hand, i2.reorder_point AS dest_rop, i2.qty30 AS dest_qty30,
           (i2.qty30 / 30.0)::numeric AS velocity_per_day,
           CASE WHEN i2.qty30 > 0 THEN i2.on_hand / (i2.qty30 / 30.0) ELSE 999 END AS dest_dos,
           GREATEST(FLOOR((i2.qty30 / 30.0) * 180 - i2.on_hand)::int, 0) AS headroom_units,
           CASE
             WHEN i2.on_hand < i2.reorder_point AND i2.qty30 > 0 THEN 'covers_shortage'
             WHEN i2.qty30 > 0 AND (i2.on_hand / NULLIF(i2.qty30 / 30.0, 0)) < 90 THEN 'safety_cushion'
             WHEN i2.qty30 > 0 THEN 'slow_absorption'
             ELSE 'no_velocity'
           END AS tier
    FROM excess_final e
    JOIN inv i2 ON i2.product_id = e.product_id AND i2.branch_id <> e.branch_id
    WHERE i2.qty30 > 0
  ),
  absorption_ranked AS (
    SELECT product_id, from_branch, to_branch_id, to_branch_name,
           dest_on_hand, dest_rop, dest_qty30, velocity_per_day, dest_dos, headroom_units, tier,
           ROW_NUMBER() OVER (
             PARTITION BY product_id, from_branch
             ORDER BY
               CASE tier
                 WHEN 'covers_shortage' THEN 1
                 WHEN 'safety_cushion' THEN 2
                 WHEN 'slow_absorption' THEN 3
                 ELSE 4
               END,
               velocity_per_day DESC
           ) AS rn
    FROM absorption_all
    WHERE headroom_units > 0
  ),
  absorption_by_release AS (
    SELECT product_id, from_branch,
           jsonb_agg(
             jsonb_build_object(
               'branch_id', to_branch_id,
               'branch_name', to_branch_name,
               'dest_on_hand', dest_on_hand,
               'dest_reorder_point', dest_rop,
               'velocity_per_day', ROUND(velocity_per_day, 2),
               'current_dos', ROUND(dest_dos, 1),
               'headroom_units', headroom_units,
               'tier', tier
             ) ORDER BY
               CASE tier
                 WHEN 'covers_shortage' THEN 1
                 WHEN 'safety_cushion' THEN 2
                 WHEN 'slow_absorption' THEN 3
                 ELSE 4
               END,
               velocity_per_day DESC
           ) AS targets
    FROM absorption_ranked
    WHERE rn <= 8
    GROUP BY product_id, from_branch
  ),
  excess_with_targets AS (
    SELECT ef.*,
           COALESCE(ab.targets, '[]'::jsonb) AS absorption_targets
    FROM excess_final ef
    LEFT JOIN absorption_by_release ab
      ON ab.product_id = ef.product_id AND ab.from_branch = ef.branch_id
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
    'releases',  (SELECT COALESCE(jsonb_agg(to_jsonb(ewt)), '[]'::jsonb) FROM excess_with_targets ewt),
    'redeploys', (SELECT COALESCE(jsonb_agg(to_jsonb(sf)), '[]'::jsonb) FROM short_final sf),
    'totals',    (SELECT to_jsonb(t) FROM totals t)
  ) INTO result;

  RETURN result;
END;
$function$;
