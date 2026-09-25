-- Source activation only: retain historical dispatch and delegate Ads-2 to its private transaction.
CREATE OR REPLACE FUNCTION public.apply_affiliate_persistence_plan_v2(
  _integration_id uuid,
  _provider text,
  _persistence_contract_version text,
  _plan_fingerprint_algorithm text,
  _plan_fingerprint text,
  _evaluation_timestamp timestamptz,
  _triggered_by uuid,
  _expected_counts jsonb,
  _store_instructions jsonb,
  _offer_instructions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF _persistence_contract_version = 'v2-a9b-2' THEN
    RETURN public.affiliate_sync_v2_apply_promotions_plan_internal(
      _integration_id,
      _provider,
      _persistence_contract_version,
      _plan_fingerprint_algorithm,
      _plan_fingerprint,
      _evaluation_timestamp,
      _triggered_by,
      _expected_counts,
      _store_instructions,
      _offer_instructions
    );
  END IF;

  IF _persistence_contract_version = 'v2-a11-ads-1' THEN
    RETURN public.affiliate_sync_v2_apply_ads_plan_internal(
      _integration_id,
      _provider,
      _persistence_contract_version,
      _plan_fingerprint_algorithm,
      _plan_fingerprint,
      _evaluation_timestamp,
      _triggered_by,
      _expected_counts,
      _store_instructions,
      _offer_instructions
    );
  END IF;

  IF _persistence_contract_version = 'v2-a11-ads-2' THEN
    RETURN public.affiliate_sync_v2_apply_ads_refresh_plan_internal(
      _integration_id,
      _provider,
      _persistence_contract_version,
      _plan_fingerprint_algorithm,
      _plan_fingerprint,
      _evaluation_timestamp,
      _triggered_by,
      _expected_counts,
      _store_instructions,
      _offer_instructions
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'blocked',
    'stage', 'request_validation',
    'reason', 'invalid_request'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'failed',
    'stage', 'request_validation',
    'reason', 'internal_failure'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_affiliate_persistence_plan_v2(
  uuid, text, text, text, text, timestamptz, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_affiliate_persistence_plan_v2(
  uuid, text, text, text, text, timestamptz, uuid, jsonb, jsonb, jsonb
) TO service_role;
