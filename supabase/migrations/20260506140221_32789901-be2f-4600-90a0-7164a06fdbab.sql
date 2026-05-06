
CREATE TABLE public.saved_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  supplier_id UUID NOT NULL,
  delay_days INTEGER NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.saved_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own simulations" ON public.saved_simulations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own simulations" ON public.saved_simulations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own simulations" ON public.saved_simulations FOR DELETE USING (auth.uid() = user_id);
