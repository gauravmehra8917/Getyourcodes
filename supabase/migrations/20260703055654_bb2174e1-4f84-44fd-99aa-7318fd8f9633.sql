
ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

UPDATE public.subscribers SET unsubscribe_token = gen_random_uuid() WHERE unsubscribe_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscribers_unsubscribe_token_key ON public.subscribers(unsubscribe_token);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_lower_idx ON public.subscribers(lower(email));

CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected int;
BEGIN
  IF _token IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.subscribers
    SET active = false
    WHERE unsubscribe_token = _token;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(uuid) TO anon, authenticated;
