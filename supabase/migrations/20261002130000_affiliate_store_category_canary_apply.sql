-- P1C-A2: one private category enrichment transaction; no bulk execution surface.
CREATE FUNCTION public.apply_affiliate_store_category_canary_v1(
  p_store_id uuid,
  p_campaign_id text,
  p_category_id uuid,
  p_provider_category_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_store record;
  v_key_count integer;
  v_best_priority integer;
  v_target_count integer;
  v_target uuid;
  v_affected integer;
BEGIN
  IF p_store_id IS NULL OR p_category_id IS NULL
     OR p_campaign_id IS NULL OR char_length(p_campaign_id) NOT BETWEEN 1 AND 1024
     OR octet_length(p_campaign_id) > 4096
     OR p_provider_category_keys IS NULL
     OR array_ndims(p_provider_category_keys) IS DISTINCT FROM 1
     OR array_lower(p_provider_category_keys, 1) IS DISTINCT FROM 1
     OR cardinality(p_provider_category_keys) NOT BETWEEN 1 AND 32 THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'invalid_request');
  END IF;

  -- Validate bounded keys, without transforming or inferring provider evidence.
  IF EXISTS (
    SELECT 1 FROM unnest(p_provider_category_keys) AS evidence(key)
    WHERE key IS NULL OR char_length(key) NOT BETWEEN 1 AND 320
      OR octet_length(key) > 1280 OR key ~ '[[:cntrl:]]'
      OR key <> lower(btrim(regexp_replace(key, '[[:space:]]+', ' ', 'g')))
  ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'invalid_request');
  END IF;
  SELECT count(DISTINCT key COLLATE "C") INTO v_key_count
    FROM unnest(p_provider_category_keys) AS evidence(key);
  IF v_key_count <> cardinality(p_provider_category_keys) THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'invalid_request');
  END IF;

  -- Primary-key lookup locks at most one store, even on identity mismatch.
  SELECT id, provider, provider_entity_namespace, provider_entity_id, category_id
    INTO v_store FROM public.stores WHERE id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'store_identity_mismatch');
  END IF;
  IF v_store.provider IS DISTINCT FROM 'impact'
     OR v_store.provider_entity_namespace IS DISTINCT FROM 'campaign'
     OR (v_store.provider_entity_id COLLATE "C") IS DISTINCT FROM (p_campaign_id COLLATE "C") THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'store_identity_mismatch');
  END IF;
  IF v_store.category_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'noop_existing_category', 'outcome', 'noop_existing_category');
  END IF;

  -- Stabilize mapping edits AND newly enabled/inserted keys until commit.
  -- A row-only lock would miss phantoms that become the strongest mapping.
  LOCK TABLE public.affiliate_store_category_mappings IN SHARE MODE;
  PERFORM id FROM public.categories WHERE id = p_category_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'category_not_found');
  END IF;

  SELECT min(priority) INTO v_best_priority
    FROM public.affiliate_store_category_mappings
    WHERE provider = 'impact' AND enabled = true
      AND (normalized_provider_category_key COLLATE "C") = ANY(p_provider_category_keys);
  IF v_best_priority IS NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'mapping_unmapped');
  END IF;
  SELECT count(DISTINCT category_id), (array_agg(DISTINCT category_id))[1]
    INTO v_target_count, v_target
    FROM public.affiliate_store_category_mappings
    WHERE provider = 'impact' AND enabled = true
      AND (normalized_provider_category_key COLLATE "C") = ANY(p_provider_category_keys)
      AND priority = v_best_priority;
  IF v_target_count <> 1 THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'mapping_ambiguous');
  END IF;
  IF v_target IS DISTINCT FROM p_category_id THEN
    RETURN jsonb_build_object('status', 'blocked', 'outcome', 'mapping_stale');
  END IF;

  UPDATE public.stores SET category_id = v_target
    WHERE id = p_store_id AND provider = 'impact'
      AND provider_entity_namespace = 'campaign'
      AND (provider_entity_id COLLATE "C") = (p_campaign_id COLLATE "C")
      AND category_id IS NULL;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected = 1 THEN
    RETURN jsonb_build_object('status', 'assigned', 'outcome', 'assigned');
  END IF;
  IF v_affected <> 0 THEN
    -- Exception rolls back this function's changes before returning a closed failure.
    RAISE EXCEPTION 'category_canary_row_count';
  END IF;
  -- No unsafe retry, including if a pre-existing trigger suppressed the update.
  SELECT id, provider, provider_entity_namespace, provider_entity_id, category_id
    INTO v_store FROM public.stores WHERE id = p_store_id;
  IF FOUND AND v_store.provider = 'impact'
     AND v_store.provider_entity_namespace = 'campaign'
     AND (v_store.provider_entity_id COLLATE "C") = (p_campaign_id COLLATE "C")
     AND v_store.category_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'noop_existing_category', 'outcome', 'noop_existing_category');
  END IF;
  RETURN jsonb_build_object('status', 'blocked', 'outcome', 'internal_failure');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status', 'blocked', 'outcome', 'internal_failure');
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_affiliate_store_category_canary_v1(uuid, text, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_affiliate_store_category_canary_v1(uuid, text, uuid, text[])
  TO service_role;
