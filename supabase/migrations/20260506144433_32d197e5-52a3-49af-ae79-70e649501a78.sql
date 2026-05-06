
CREATE OR REPLACE FUNCTION public.exec_readonly_sql(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  cleaned text;
BEGIN
  cleaned := btrim(query);
  IF cleaned !~* '^select\s' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  IF cleaned ~* '(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|;)\s' THEN
    -- still allow trailing semicolon; reject mid-query semicolons
    IF cleaned ~* ';\s*\S' THEN
      RAISE EXCEPTION 'Multiple statements are not allowed';
    END IF;
  END IF;

  SET LOCAL statement_timeout = '5s';
  SET LOCAL transaction_read_only = on;

  EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', rtrim(cleaned, ';')) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_readonly_sql(text) FROM public;
GRANT EXECUTE ON FUNCTION public.exec_readonly_sql(text) TO service_role;
