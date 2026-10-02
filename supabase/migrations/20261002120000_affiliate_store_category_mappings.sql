-- P1C-A1: taxonomy mapping foundation only. No catalog writes or seeded mappings.
CREATE TABLE public.affiliate_store_category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_category_label text NOT NULL,
  normalized_provider_category_key text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_store_category_provider_valid
    CHECK (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT affiliate_store_category_label_valid
    CHECK (char_length(provider_category_label) BETWEEN 1 AND 160
      AND provider_category_label !~ '^[[:space:]]*$'),
  CONSTRAINT affiliate_store_category_key_valid
    CHECK (char_length(normalized_provider_category_key) BETWEEN 1 AND 320
      AND normalized_provider_category_key =
        lower(btrim(regexp_replace(normalized_provider_category_key, '[[:space:]]+', ' ', 'g')))
      AND normalized_provider_category_key !~ '[[:cntrl:]]'),
  CONSTRAINT affiliate_store_category_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX affiliate_store_category_active_key_unique
  ON public.affiliate_store_category_mappings (provider, normalized_provider_category_key)
  WHERE enabled;
CREATE INDEX affiliate_store_category_target_idx
  ON public.affiliate_store_category_mappings (category_id);

COMMENT ON TABLE public.affiliate_store_category_mappings IS
  'Maps external provider taxonomy into GetYourCodes editorial taxonomy. P1C-A1 is preview only; this table grants no store category ownership.';
COMMENT ON COLUMN public.affiliate_store_category_mappings.normalized_provider_category_key IS
  'Deterministic lowercase key with trimmed/collapsed whitespace, authored using the isolated category normalization helper. Punctuation remains significant; no fuzzy taxonomy matching.';
COMMENT ON COLUMN public.affiliate_store_category_mappings.priority IS
  'Lower numeric priority is stronger. Different categories tied at the strongest priority are ambiguous; never choose arbitrarily.';
COMMENT ON COLUMN public.affiliate_store_category_mappings.category_id IS
  'Existing editorial category. Deletion is restricted until mappings are explicitly removed; never retarget automatically.';

ALTER TABLE public.affiliate_store_category_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.affiliate_store_category_mappings
  FROM PUBLIC, anon, authenticated, service_role;
-- The preview service may only read mappings. Mapping maintenance is explicit admin work.
GRANT SELECT ON TABLE public.affiliate_store_category_mappings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.affiliate_store_category_mappings TO authenticated;
CREATE POLICY "Admins maintain external store category mappings"
  ON public.affiliate_store_category_mappings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Timestamp maintenance is limited to the new mapping table; no stores trigger.
CREATE FUNCTION public.affiliate_store_category_mapping_timestamp_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_store_category_mapping_timestamp_v1()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER affiliate_store_category_mapping_timestamp_v1
  BEFORE UPDATE ON public.affiliate_store_category_mappings
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_store_category_mapping_timestamp_v1();
