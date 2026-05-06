
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY,
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  last_reset_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings select" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own settings insert" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings update" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.saved_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  snapshot_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID
);
ALTER TABLE public.saved_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read scenarios" ON public.saved_scenarios FOR SELECT USING (true);
CREATE POLICY "auth insert scenarios" ON public.saved_scenarios FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update scenarios" ON public.saved_scenarios FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete scenarios" ON public.saved_scenarios FOR DELETE TO authenticated USING (true);
