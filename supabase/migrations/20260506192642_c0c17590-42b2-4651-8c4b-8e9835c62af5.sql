
CREATE TABLE public.action_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_id uuid NOT NULL,
  user_id uuid,
  action_type text NOT NULL,
  insight_type text NOT NULL,
  insight_title text NOT NULL,
  financial_impact_usd numeric NOT NULL DEFAULT 0,
  action_summary text,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_aal_insight ON public.action_audit_log(insight_id);
CREATE INDEX idx_aal_created ON public.action_audit_log(created_at DESC);

ALTER TABLE public.action_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read audit log" ON public.action_audit_log FOR SELECT USING (true);
CREATE POLICY "auth insert audit log" ON public.action_audit_log FOR INSERT TO authenticated WITH CHECK (true);
