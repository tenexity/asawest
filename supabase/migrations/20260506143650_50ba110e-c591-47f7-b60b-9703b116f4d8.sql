
CREATE TYPE insight_type AS ENUM ('stockout_risk','excess_inventory','supplier_delay_impact','substitution_opportunity','rebate_opportunity','inter_branch_transfer');
CREATE TYPE insight_severity AS ENUM ('critical','high','medium','low');
CREATE TYPE insight_status AS ENUM ('new','approved','rejected','snoozed','executed');
CREATE TYPE transfer_status AS ENUM ('pending','in_transit','received','cancelled');

CREATE TABLE public.insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type insight_type NOT NULL,
  severity insight_severity NOT NULL,
  title text NOT NULL,
  narrative text NOT NULL DEFAULT '',
  financial_impact_usd numeric NOT NULL DEFAULT 0,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_action_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status insight_status NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX idx_insights_status ON public.insights(status);
CREATE INDEX idx_insights_severity ON public.insights(severity);
ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read insights" ON public.insights FOR SELECT USING (true);
CREATE POLICY "auth insert insights" ON public.insights FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update insights" ON public.insights FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete insights" ON public.insights FOR DELETE TO authenticated USING (true);

CREATE TABLE public.transfer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_branch_id uuid NOT NULL,
  dest_branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL,
  status transfer_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expected_arrival date
);
ALTER TABLE public.transfer_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read transfers" ON public.transfer_orders FOR SELECT USING (true);
CREATE POLICY "auth insert transfers" ON public.transfer_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update transfers" ON public.transfer_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.markdown_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  excess_qty integer NOT NULL,
  estimated_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.markdown_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read mdc" ON public.markdown_candidates FOR SELECT USING (true);
CREATE POLICY "auth insert mdc" ON public.markdown_candidates FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE public.promoted_substitutes (
  product_id uuid PRIMARY KEY,
  substitute_product_id uuid NOT NULL,
  promoted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.promoted_substitutes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read promo" ON public.promoted_substitutes FOR SELECT USING (true);
CREATE POLICY "auth upsert promo" ON public.promoted_substitutes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update promo" ON public.promoted_substitutes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
