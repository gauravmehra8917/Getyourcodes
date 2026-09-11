-- A11-S4-I2 coded Impact Ads persistence regression matrix.
-- Run only after all repository migrations on a disposable local database.
-- Every fixture and mutation is wrapped in this transaction and rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(1);

CREATE FUNCTION pg_temp.assert_true(_condition boolean, _label text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF _condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion_failed: %', _label;
  END IF;
END;
$function$;

CREATE FUNCTION pg_temp.ads_expected_counts(
  _store_create integer DEFAULT 0,
  _store_existing integer DEFAULT 0,
  _store_unmatched integer DEFAULT 0,
  _offer_create integer DEFAULT 0,
  _offer_existing integer DEFAULT 0,
  _offer_held integer DEFAULT 0,
  _offer_unresolved integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'stores', jsonb_build_object(
      'create', _store_create,
      'noopExisting', _store_existing,
      'blockedAmbiguous', 0,
      'noopUnmatched', _store_unmatched
    ),
    'offers', jsonb_build_object(
      'create', _offer_create,
      'noopExisting', _offer_existing,
      'noopHeld', _offer_held,
      'noopUnresolved', _offer_unresolved
    ),
    'writableStores', _store_create,
    'writableOffers', _offer_create,
    'writableEntities', _store_create + _offer_create
  );
$function$;

CREATE FUNCTION pg_temp.ads_store_create(
  _ordinal integer,
  _campaign_id text,
  _campaign_name text,
  _slug text,
  _evaluated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'create',
    'provider', 'impact',
    'providerEntityNamespace', 'campaign',
    'providerEntityId', _campaign_id,
    'expectedExistingStoreId', NULL,
    'qualified', true,
    'projection', jsonb_build_object(
      'name', _campaign_name,
      'slugCandidate', _slug,
      'description', NULL,
      'affiliateUrl', 'https://destination.invalid/campaign/' || _campaign_id,
      'destinationUrl', 'https://destination.invalid/campaign/' || _campaign_id,
      'country', NULL,
      'shippingRegions', '[]'::jsonb,
      'logoSourceUrl', NULL,
      'metadata', jsonb_build_object(
        'advertiserId', 'advertiser-' || _campaign_id,
        'campaignId', _campaign_id,
        'campaignName', _campaign_name,
        'destinationUrl', 'https://destination.invalid/campaign/' || _campaign_id,
        'trackingUrl', 'https://tracking.invalid/campaign/' || _campaign_id
      ),
      'importOrigin', 'provider',
      'lifecycleManaged', true,
      'lifecycleHidden', false,
      'lastQualificationResult', 'qualified',
      'lastQualifiedAt', _evaluated_at,
      'seoTitle', _campaign_name || ' Coupon Codes',
      'seoDescription', 'Save with verified offers from ' || _campaign_name || '.',
      'seoCanonicalUrl', 'https://site.invalid/' || _slug || '-coupons'
    )
  );
$function$;

CREATE FUNCTION pg_temp.ads_store_existing(
  _ordinal integer,
  _campaign_id text,
  _store_id uuid
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'noop_existing',
    'provider', 'impact',
    'providerEntityNamespace', 'campaign',
    'providerEntityId', _campaign_id,
    'expectedExistingStoreId', _store_id,
    'qualified', true,
    'projection', NULL
  );
$function$;

CREATE FUNCTION pg_temp.ads_offer_create(
  _ordinal integer,
  _ad_id text,
  _campaign_id text,
  _campaign_name text,
  _expected_store_id uuid DEFAULT NULL,
  _coupon_code text DEFAULT 'SAVE 20!'
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'create',
    'provider', 'impact',
    'providerEntityNamespace', 'ad',
    'providerEntityId', _ad_id,
    'kind', 'coupon',
    'existingOfferId', NULL,
    'parentProviderEntityNamespace', 'campaign',
    'parentProviderEntityId', _campaign_id,
    'expectedParentStoreId', _expected_store_id,
    'projection', jsonb_build_object(
      'title', 'Save 20% at ' || _campaign_name,
      'description', 'Provider description for ' || _ad_id,
      'couponCode', _coupon_code,
      'couponType', 'code',
      'affiliateUrl', 'https://tracking.invalid/ad/' || _ad_id,
      'landingPageUrl', 'https://landing.invalid/ad/' || _ad_id,
      'startDate', '2026-09-01',
      'expiryDate', '2026-12-31',
      'status', 'active',
      'terms', 'Minimum purchase applies.',
      'discountType', 'percentage',
      'discountValue', 20,
      'structuredTerms', jsonb_build_object(
        'minimumPurchase', 50,
        'maximumSavings', 100,
        'purchaseLimit', 1,
        'scope', 'sitewide',
        'currency', 'USD',
        'text', 'Minimum purchase applies.'
      ),
      'metadata', jsonb_build_object(
        'adId', _ad_id,
        'campaignId', _campaign_id,
        'advertiserId', 'advertiser-' || _campaign_id,
        'dealId', 'deal-' || _ad_id,
        'campaignName', _campaign_name,
        'adName', 'Save 20% at ' || _campaign_name,
        'dealStartDate', '2026-09-01T00:00:00Z',
        'dealEndDate', '2026-12-31T23:59:59Z',
        'startDate', '2026-08-01T00:00:00Z',
        'endDate', '2027-01-31T23:59:59Z'
      ),
      'seoTitle', 'Save 20% at ' || _campaign_name,
      'seoDescription', 'Use this verified coupon at ' || _campaign_name || '.',
      'seoCanonicalUrl', 'https://site.invalid/' || _campaign_id || '-coupons#save-20'
    )
  );
$function$;

CREATE FUNCTION pg_temp.ads_offer_existing(
  _ordinal integer,
  _ad_id text,
  _offer_id uuid,
  _campaign_id text,
  _store_id uuid
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'instructionOrdinal', _ordinal,
    'action', 'noop_existing',
    'provider', 'impact',
    'providerEntityNamespace', 'ad',
    'providerEntityId', _ad_id,
    'kind', 'coupon',
    'existingOfferId', _offer_id,
    'parentProviderEntityNamespace', 'campaign',
    'parentProviderEntityId', _campaign_id,
    'expectedParentStoreId', _store_id,
    'projection', NULL
  );
$function$;

CREATE FUNCTION pg_temp.fail_ads_store_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.provider = 'impact'
    AND NEW.provider_entity_namespace = 'campaign'
    AND NEW.provider_entity_id = 'campaign-store-failure'
  THEN
    RAISE EXCEPTION 'forced_ads_store_failure';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION pg_temp.fail_ads_offer_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.provider = 'impact'
    AND NEW.provider_entity_namespace = 'ad'
    AND NEW.provider_entity_id = 'ad-offer-failure'
  THEN
    RAISE EXCEPTION 'forced_ads_offer_failure';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION pg_temp.fail_ads_run_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.persistence_contract_version = 'v2-a11-ads-1'
    AND NEW.plan_fingerprint = repeat('3', 64)
  THEN
    RAISE EXCEPTION 'forced_ads_run_failure';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION pg_temp.fail_ads_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.provider_entity_namespace = 'ad'
    AND NEW.provider_entity_id = 'ad-ledger-failure'
  THEN
    RAISE EXCEPTION 'forced_ads_ledger_failure';
  END IF;
  RETURN NEW;
END;
$function$;

DO $test$
DECLARE
  integration_a constant uuid := 'a1120000-0000-4000-8000-000000000001';
  integration_b constant uuid := 'a1120000-0000-4000-8000-000000000002';
  actor_id constant uuid := 'a1120000-0000-4000-8000-000000000003';
  evaluated_at constant timestamptz := '2026-09-09T00:00:00Z';
  result_one jsonb;
  result_two jsonb;
  counts jsonb;
  stores jsonb;
  offers jsonb;
  campaign_store_id uuid;
  other_store_id uuid;
  ad_offer_id uuid;
  row_count integer;
  before_row jsonb;
  after_row jsonb;
  durable_counts_before jsonb;
  durable_counts_after jsonb;
  function_search_path text[];
  unique_constraint_name text;
BEGIN
  INSERT INTO public.affiliate_integrations (
    id, integration_name, provider_name, provider_type,
    authentication_type, base_url, is_enabled
  ) VALUES
    (
      integration_a, 'A11 Ads fixture A', 'Impact', 'affiliate',
      'basic', 'https://fixture-a.invalid', true
    ),
    (
      integration_b, 'A11 Ads fixture B', 'impact.com', 'affiliate',
      'basic', 'https://fixture-b.invalid', true
    );

  -- The public dispatcher must preserve the settled Promotions contract.
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_b, 'impact', 'v2-a9b-2', 'sha256-canonical-plan-v1',
    repeat('a0', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(), '[]'::jsonb, '[]'::jsonb
  ) INTO result_one;
  PERFORM pg_temp.assert_true(
    result_one->>'status' = 'committed'
      AND result_one->>'persistenceContractVersion' = 'v2-a9b-2',
    'Promotions v2-a9b-2 still dispatches unchanged'
  );

  -- A Promotion and Ad with the same literal ID must coexist by namespace.
  INSERT INTO public.stores (name, slug)
  VALUES ('Manual parent', 'a11-i2-manual-parent')
  RETURNING id INTO other_store_id;
  INSERT INTO public.coupons (
    store_id, title, provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    other_store_id, 'Existing Promotion literal', 'impact', 'promotion', 'shared-literal-id'
  );

  counts := pg_temp.ads_expected_counts(1, 0, 0, 1, 0, 0, 0);
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-one', 'Campaign One', 'campaign-one', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'shared-literal-id', 'campaign-one', 'Campaign One'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('a1', 32), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_one;
  PERFORM pg_temp.assert_true(
    result_one->>'status' = 'committed'
      AND result_one#>>'{counts,actual,storesCreated}' = '1'
      AND result_one#>>'{counts,actual,offersCreated}' = '1'
      AND result_one#>>'{counts,actual,ledgerRows}' = '2',
    'Ads create commits one exact Campaign store and one exact Ad coupon'
  );

  SELECT id INTO STRICT campaign_store_id
  FROM public.stores
  WHERE provider = 'impact'
    AND provider_entity_namespace = 'campaign'
    AND provider_entity_id = 'campaign-one';
  SELECT id INTO STRICT ad_offer_id
  FROM public.coupons
  WHERE provider = 'impact'
    AND provider_entity_namespace = 'ad'
    AND provider_entity_id = 'shared-literal-id';
  PERFORM pg_temp.assert_true(
    (SELECT name = 'Campaign One'
      AND slug = 'campaign-one'
      AND affiliate_url = 'https://destination.invalid/campaign/campaign-one'
      AND metadata->>'destinationUrl' = 'https://destination.invalid/campaign/campaign-one'
      AND metadata->>'trackingUrl' = 'https://tracking.invalid/campaign/campaign-one'
      AND metadata->>'trackingUrl' <> affiliate_url
      AND metadata->>'campaignId' = 'campaign-one'
      AND seo_title = 'Campaign One Coupon Codes'
      AND seo_canonical_url = 'https://site.invalid/campaign-one-coupons'
     FROM public.stores WHERE id = campaign_store_id),
    'Campaign store projection is persisted exactly'
  );
  PERFORM pg_temp.assert_true(
    (SELECT store_id = campaign_store_id
      AND coupon_code = 'SAVE 20!'
      AND coupon_type::text = 'code'
      AND affiliate_url = 'https://tracking.invalid/ad/shared-literal-id'
      AND landing_page_url = 'https://landing.invalid/ad/shared-literal-id'
      AND start_date = DATE '2026-09-01'
      AND expiry_date = DATE '2026-12-31'
      AND structured_terms->>'scope' = 'sitewide'
      AND metadata->>'adId' = 'shared-literal-id'
      AND metadata->>'campaignId' = 'campaign-one'
      AND seo_canonical_url = 'https://site.invalid/campaign-one-coupons#save-20'
     FROM public.coupons WHERE id = ad_offer_id),
    'coded Ad fields, provider metadata, dates, landing URL and SEO persist exactly'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) = 2 FROM public.coupons
     WHERE provider = 'impact'
       AND provider_entity_id = 'shared-literal-id'
       AND provider_entity_namespace IN ('promotion', 'ad')),
    'same literal Promotion and Ad identities coexist'
  );

  -- DB-level namespace guards apply to every writer, including writes that do
  -- not pass through the V2 RPC. Promotion and Ad stay independent, while a
  -- legacy identity cannot coexist with either proven offer namespace or an
  -- exact Campaign store identity.
  unique_constraint_name := NULL;
  BEGIN
    INSERT INTO public.stores (
      name, slug, provider, provider_entity_namespace, provider_entity_id
    ) VALUES (
      'Conflicting legacy Campaign', 'conflicting-legacy-campaign',
      'impact', 'legacy', 'campaign-one'
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS unique_constraint_name = CONSTRAINT_NAME;
  END;
  PERFORM pg_temp.assert_true(
    unique_constraint_name = 'stores_impact_campaign_legacy_identity_uidx'
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'legacy'
          AND provider_entity_id = 'campaign-one'
      ),
    'direct legacy store writer cannot cross the Campaign namespace'
  );

  INSERT INTO public.coupons (
    store_id, title, provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    other_store_id, 'Promotion guard fixture',
    'impact', 'promotion', 'promotion-legacy-guard'
  );
  unique_constraint_name := NULL;
  BEGIN
    INSERT INTO public.coupons (
      store_id, title, provider, provider_entity_namespace, provider_entity_id
    ) VALUES (
      other_store_id, 'Conflicting legacy Promotion',
      'impact', 'legacy', 'promotion-legacy-guard'
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS unique_constraint_name = CONSTRAINT_NAME;
  END;
  PERFORM pg_temp.assert_true(
    unique_constraint_name = 'coupons_impact_promotion_legacy_identity_uidx',
    'direct legacy offer writer cannot cross the Promotion namespace'
  );

  INSERT INTO public.coupons (
    store_id, title, provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    other_store_id, 'Ad guard fixture',
    'impact', 'ad', 'ad-legacy-guard'
  );
  unique_constraint_name := NULL;
  BEGIN
    INSERT INTO public.coupons (
      store_id, title, provider, provider_entity_namespace, provider_entity_id
    ) VALUES (
      other_store_id, 'Conflicting legacy Ad',
      'impact', 'legacy', 'ad-legacy-guard'
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS unique_constraint_name = CONSTRAINT_NAME;
  END;
  PERFORM pg_temp.assert_true(
    unique_constraint_name = 'coupons_impact_ad_legacy_identity_uidx',
    'direct legacy offer writer cannot cross the Ad namespace'
  );
  PERFORM pg_temp.assert_true(
    (SELECT count(*) = 2
     FROM public.affiliate_import_run_mutations_v2
     WHERE run_id = (result_one->>'runId')::uuid)
      AND
    (SELECT count(*) = 1
     FROM public.affiliate_import_run_mutations_v2
     WHERE run_id = (result_one->>'runId')::uuid
       AND entity_kind = 'offer'
       AND provider_entity_namespace = 'ad'
       AND parent_provider_entity_namespace = 'campaign'
       AND parent_entity_id = campaign_store_id
       AND offer_kind = 'coupon'),
    'Ads mutation ledger retains exact namespace and Campaign parent evidence'
  );

  -- Exact fingerprint replay returns the durable result without duplication.
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('a1', 32), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two->>'status' = 'replayed_existing'
      AND result_two->>'runId' = result_one->>'runId'
      AND result_two->'counts' = result_one->'counts'
      AND (SELECT count(*) = 1 FROM public.coupons
           WHERE provider = 'impact'
             AND provider_entity_namespace = 'ad'
             AND provider_entity_id = 'shared-literal-id'),
    'Ads replay is deterministic and creates no duplicate Ad identity'
  );

  -- A fresh create plan contending with already committed exact identities may
  -- reconcile only to exact compatible no-ops.
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('a2', 32), evaluated_at, actor_id, counts, stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two->>'status' = 'committed'
      AND result_two#>>'{counts,actual,storesCreated}' = '0'
      AND result_two#>>'{counts,actual,storesNoopExisting}' = '1'
      AND result_two#>>'{counts,actual,offersCreated}' = '0'
      AND result_two#>>'{counts,actual,offersNoopExisting}' = '1',
    'fresh exact create contention reconciles to compatible no-ops'
  );

  -- Explicit no-op must neither rewrite curated fields nor create identities.
  SELECT to_jsonb(store) INTO before_row
  FROM public.stores AS store WHERE store.id = campaign_store_id;
  stores := jsonb_build_array(pg_temp.ads_store_existing(
    0, 'campaign-one', campaign_store_id
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_existing(
    1, 'shared-literal-id', ad_offer_id, 'campaign-one', campaign_store_id
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('a3', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1, 0, 0, 1, 0, 0), stores, offers
  ) INTO result_two;
  SELECT to_jsonb(store) INTO after_row
  FROM public.stores AS store WHERE store.id = campaign_store_id;
  PERFORM pg_temp.assert_true(
    result_two->>'status' = 'committed'
      AND result_two#>>'{counts,actual,storesNoopExisting}' = '1'
      AND result_two#>>'{counts,actual,offersNoopExisting}' = '1'
      AND before_row = after_row,
    'exact Ads no-op does not overwrite existing Campaign content'
  );

  -- Action validation must reject SQL-NULL-producing and non-string JSON
  -- shapes before catalog or durable audit work begins.
  SELECT jsonb_build_object(
    'stores', (SELECT count(*) FROM public.stores),
    'coupons', (SELECT count(*) FROM public.coupons),
    'runs', (SELECT count(*) FROM public.affiliate_import_runs),
    'ledger', (SELECT count(*) FROM public.affiliate_import_run_mutations_v2)
  ) INTO durable_counts_before;

  stores := jsonb_build_array(jsonb_set(
    pg_temp.ads_store_existing(0, 'campaign-one', campaign_store_id),
    '{action}', 'null'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e1', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1), stores, '[]'::jsonb
  ) INTO result_two;
  SELECT jsonb_build_object(
    'stores', (SELECT count(*) FROM public.stores),
    'coupons', (SELECT count(*) FROM public.coupons),
    'runs', (SELECT count(*) FROM public.affiliate_import_runs),
    'ledger', (SELECT count(*) FROM public.affiliate_import_run_mutations_v2)
  ) INTO durable_counts_after;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_store_instruction"}'::jsonb
      AND durable_counts_after = durable_counts_before,
    'JSON-null store action is rejected before any durable mutation'
  );

  stores := jsonb_build_array(
    pg_temp.ads_store_existing(0, 'campaign-one', campaign_store_id) - 'action'
  );
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e2', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_store_instruction"}'::jsonb,
    'missing store action is rejected'
  );

  stores := jsonb_build_array(jsonb_set(
    pg_temp.ads_store_existing(0, 'campaign-one', campaign_store_id),
    '{action}', '[]'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e3', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_store_instruction"}'::jsonb,
    'non-string store action is rejected'
  );

  stores := jsonb_build_array(jsonb_set(
    pg_temp.ads_store_existing(0, 'campaign-one', campaign_store_id),
    '{action}', '""'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e4', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_store_instruction"}'::jsonb,
    'empty store action is rejected by the closed vocabulary'
  );

  stores := jsonb_build_array(jsonb_set(
    pg_temp.ads_store_existing(0, 'campaign-one', campaign_store_id),
    '{action}', '"update"'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e5', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_store_instruction"}'::jsonb,
    'unsupported store action is rejected by the closed vocabulary'
  );

  stores := jsonb_build_array(pg_temp.ads_store_existing(
    0, 'campaign-one', campaign_store_id
  ));
  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_existing(
      1, 'shared-literal-id', ad_offer_id, 'campaign-one', campaign_store_id
    ),
    '{action}', 'null'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e6', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1, 0, 0, 1), stores, offers
  ) INTO result_two;
  SELECT jsonb_build_object(
    'stores', (SELECT count(*) FROM public.stores),
    'coupons', (SELECT count(*) FROM public.coupons),
    'runs', (SELECT count(*) FROM public.affiliate_import_runs),
    'ledger', (SELECT count(*) FROM public.affiliate_import_run_mutations_v2)
  ) INTO durable_counts_after;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_instruction"}'::jsonb
      AND durable_counts_after = durable_counts_before,
    'JSON-null offer action is rejected before any durable mutation'
  );

  offers := jsonb_build_array(
    pg_temp.ads_offer_existing(
      1, 'shared-literal-id', ad_offer_id, 'campaign-one', campaign_store_id
    ) - 'action'
  );
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('e7', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1, 0, 0, 1), stores, offers
  ) INTO result_two;
  SELECT jsonb_build_object(
    'stores', (SELECT count(*) FROM public.stores),
    'coupons', (SELECT count(*) FROM public.coupons),
    'runs', (SELECT count(*) FROM public.affiliate_import_runs),
    'ledger', (SELECT count(*) FROM public.affiliate_import_run_mutations_v2)
  ) INTO durable_counts_after;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_instruction"}'::jsonb
      AND durable_counts_after = durable_counts_before,
    'missing offer action is rejected without any durable mutation'
  );

  -- Store legacy collision blocks before an exact Campaign can be created.
  INSERT INTO public.stores (
    name, slug, provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    'Legacy Campaign', 'legacy-campaign', 'impact', 'legacy', 'campaign-legacy'
  );
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-legacy', 'Campaign Legacy', 'campaign-legacy', evaluated_at
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b1', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"store_revalidation","reason":"legacy_identity_collision"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-legacy'
      ),
    'exact store legacy collision blocks without a Campaign duplicate'
  );

  -- Offer legacy collision rolls a newly inserted parent back atomically.
  INSERT INTO public.coupons (
    store_id, title, provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    other_store_id, 'Legacy Ad', 'impact', 'legacy', 'ad-legacy'
  );
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-offer-legacy', 'Offer Legacy', 'offer-legacy', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'ad-legacy', 'campaign-offer-legacy', 'Offer Legacy'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b2', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"offer_revalidation","reason":"legacy_identity_collision"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-offer-legacy'
      ),
    'exact offer legacy collision blocks and rolls parent creation back'
  );

  -- A same Ad identity attached to another exact Campaign never gets adopted.
  INSERT INTO public.coupons (
    store_id, title, coupon_type,
    provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    other_store_id, 'Wrong-parent Ad', 'code',
    'impact', 'ad', 'ad-wrong-parent'
  );
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-parent-check', 'Parent Check', 'parent-check', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'ad-wrong-parent', 'campaign-parent-check', 'Parent Check'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b3', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"offer_revalidation","reason":"parent_store_mismatch"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-parent-check'
      ),
    'incompatible exact Ad parent blocks and rolls back parent creation'
  );

  -- An exact Ad identity that races with or already belongs to a no-code deal
  -- is not a compatible coded-coupon no-op. The new parent must roll back.
  INSERT INTO public.coupons (
    store_id, title, coupon_type,
    provider, provider_entity_namespace, provider_entity_id
  ) VALUES (
    other_store_id, 'Wrong-kind Ad', 'deal',
    'impact', 'ad', 'ad-wrong-kind'
  );
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-kind-check', 'Kind Check', 'kind-check', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'ad-wrong-kind', 'campaign-kind-check', 'Kind Check'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b8', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"offer_revalidation","reason":"offer_kind_conflict"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-kind-check'
      ),
    'incompatible exact Ad kind blocks and rolls back parent creation'
  );

  -- Slug collision is only a blocker, never a store-adoption path.
  INSERT INTO public.stores (name, slug)
  VALUES ('Manual slug owner', 'manual-slug-collision');
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-slug-collision', 'Slug Collision',
    'manual-slug-collision', evaluated_at
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b4', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"store_revalidation","reason":"store_slug_collision"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-slug-collision'
      ),
    'manual slug collision blocks without fuzzy adoption'
  );

  -- Invalid code and an alternate offer namespace fail before catalog work.
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-invalid-code', 'Invalid Code', 'invalid-code', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'ad-invalid-code', 'campaign-invalid-code', 'Invalid Code', NULL, 'N/A'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b5', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'placeholder coupon code is rejected fail-closed'
  );
  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-wrong-namespace', 'campaign-invalid-code', 'Invalid Code'
    ),
    '{providerEntityNamespace}', '"promotion"'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b6', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_instruction"}'::jsonb,
    'Ads contract rejects the Promotion namespace'
  );

  -- The closed projection accepts only the existing coupon_status values and
  -- persists the trusted presentation result rather than forcing active.
  stores := jsonb_build_array(pg_temp.ads_store_existing(
    0, 'campaign-one', campaign_store_id
  ));
  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-draft-status', 'campaign-one', 'Campaign One', campaign_store_id
    ),
    '{projection,status}', '"draft"'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d1', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two->>'status' = 'committed'
      AND (SELECT status::text = 'draft' FROM public.coupons
           WHERE provider = 'impact'
             AND provider_entity_namespace = 'ad'
             AND provider_entity_id = 'ad-draft-status'),
    'draft presentation status is persisted exactly'
  );

  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-expired-status', 'campaign-one', 'Campaign One', campaign_store_id
    ),
    '{projection,status}', '"expired"'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d2', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(0, 1, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two->>'status' = 'committed'
      AND (SELECT status::text = 'expired' FROM public.coupons
           WHERE provider = 'impact'
             AND provider_entity_namespace = 'ad'
             AND provider_entity_id = 'ad-expired-status'),
    'expired presentation status is persisted exactly'
  );

  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-invalid-projection', 'Invalid Projection',
    'invalid-projection', evaluated_at
  ));
  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-invalid-status', 'campaign-invalid-projection', 'Invalid Projection'
    ),
    '{projection,status}', '"published"'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d3', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'status outside active/expired/draft is rejected'
  );

  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-negative-discount', 'campaign-invalid-projection', 'Invalid Projection'
    ),
    '{projection,discountValue}', '-1'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d4', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'negative discount value is rejected'
  );

  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-incoherent-discount', 'campaign-invalid-projection', 'Invalid Projection'
    ),
    '{projection,discountType}', 'null'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d5', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'discount type and value must be present or absent together'
  );

  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-negative-minimum', 'campaign-invalid-projection', 'Invalid Projection'
    ),
    '{projection,structuredTerms,minimumPurchase}', '-1'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d6', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'negative minimum purchase is rejected'
  );

  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-negative-maximum', 'campaign-invalid-projection', 'Invalid Projection'
    ),
    '{projection,structuredTerms,maximumSavings}', '-1'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d8', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'negative maximum savings is rejected'
  );

  offers := jsonb_build_array(jsonb_set(
    pg_temp.ads_offer_create(
      1, 'ad-zero-limit', 'campaign-invalid-projection', 'Invalid Projection'
    ),
    '{projection,structuredTerms,purchaseLimit}', '0'::jsonb
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('d7', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"invalid_offer_projection"}'::jsonb,
    'nonpositive purchase limit is rejected'
  );

  -- Instruction-count mismatch cannot write catalog or durable evidence.
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('b7', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(), stores, '[]'::jsonb
  ) INTO result_two;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"blocked","stage":"request_validation","reason":"instruction_count_mismatch"}'::jsonb,
    'expected-count mismatch fails before writes'
  );

  -- Forced catalog, run, and ledger errors prove the inner transaction block
  -- rolls back every earlier write before returning a bounded failure.
  CREATE TRIGGER a11_i2_fail_store
    BEFORE INSERT ON public.stores
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_ads_store_insert();
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-store-failure', 'Store Failure', 'store-failure', evaluated_at
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('c1', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1), stores, '[]'::jsonb
  ) INTO result_two;
  DROP TRIGGER a11_i2_fail_store ON public.stores;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"failed","stage":"store_insert","reason":"internal_failure"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-store-failure'
      ),
    'store insert failure leaves no partial catalog row'
  );

  CREATE TRIGGER a11_i2_fail_offer
    BEFORE INSERT ON public.coupons
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_ads_offer_insert();
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-offer-failure', 'Offer Failure', 'offer-failure', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'ad-offer-failure', 'campaign-offer-failure', 'Offer Failure'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('c2', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  DROP TRIGGER a11_i2_fail_offer ON public.coupons;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"failed","stage":"offer_insert","reason":"internal_failure"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-offer-failure'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.coupons
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'ad'
          AND provider_entity_id = 'ad-offer-failure'
      ),
    'coupon insert failure rolls its parent Campaign store back'
  );

  CREATE TRIGGER a11_i2_fail_run
    BEFORE INSERT ON public.affiliate_import_runs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_ads_run_insert();
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-run-failure', 'Run Failure', 'run-failure', evaluated_at
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('3', 64), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1), stores, '[]'::jsonb
  ) INTO result_two;
  DROP TRIGGER a11_i2_fail_run ON public.affiliate_import_runs;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"failed","stage":"audit_persistence","reason":"internal_failure"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-run-failure'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.affiliate_import_runs
        WHERE integration_id = integration_a
          AND plan_fingerprint = repeat('3', 64)
      ),
    'run evidence failure rolls catalog mutation back'
  );

  CREATE TRIGGER a11_i2_fail_ledger
    BEFORE INSERT ON public.affiliate_import_run_mutations_v2
    FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_ads_ledger_insert();
  stores := jsonb_build_array(pg_temp.ads_store_create(
    0, 'campaign-ledger-failure', 'Ledger Failure', 'ledger-failure', evaluated_at
  ));
  offers := jsonb_build_array(pg_temp.ads_offer_create(
    1, 'ad-ledger-failure', 'campaign-ledger-failure', 'Ledger Failure'
  ));
  SELECT public.apply_affiliate_persistence_plan_v2(
    integration_a, 'impact', 'v2-a11-ads-1', 'sha256-canonical-plan-v1',
    repeat('c4', 32), evaluated_at, actor_id,
    pg_temp.ads_expected_counts(1, 0, 0, 1), stores, offers
  ) INTO result_two;
  DROP TRIGGER a11_i2_fail_ledger ON public.affiliate_import_run_mutations_v2;
  PERFORM pg_temp.assert_true(
    result_two @> '{"status":"failed","stage":"audit_persistence","reason":"internal_failure"}'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.stores
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'campaign'
          AND provider_entity_id = 'campaign-ledger-failure'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.coupons
        WHERE provider = 'impact'
          AND provider_entity_namespace = 'ad'
          AND provider_entity_id = 'ad-ledger-failure'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.affiliate_import_runs
        WHERE integration_id = integration_a
          AND plan_fingerprint = repeat('c4', 32)
      ),
    'ledger failure rolls catalog and run evidence back'
  );

  -- The public RPC is the only service-role executable. Internal dispatch
  -- targets are inaccessible to every application role.
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'authenticated',
      'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)',
      'EXECUTE'
    )
      AND NOT has_function_privilege(
        'anon',
        'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)',
        'EXECUTE'
      )
      AND has_function_privilege(
        'service_role',
        'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        'public.affiliate_sync_v2_apply_ads_plan_internal(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        'public.affiliate_sync_v2_apply_promotions_plan_internal(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)',
        'EXECUTE'
      ),
    'only the public dispatcher is executable by service_role'
  );
  SELECT procedure.proconfig INTO function_search_path
  FROM pg_proc AS procedure
  WHERE procedure.oid =
    'public.apply_affiliate_persistence_plan_v2(uuid,text,text,text,text,timestamptz,uuid,jsonb,jsonb,jsonb)'::regprocedure;
  PERFORM pg_temp.assert_true(
    function_search_path @> ARRAY['search_path=pg_catalog, public'],
    'public Ads dispatcher has a fixed search_path'
  );

  SELECT count(*) INTO row_count
  FROM public.affiliate_import_runs
  WHERE integration_id = integration_a
    AND persistence_contract_version = 'v2-a11-ads-1';
  PERFORM pg_temp.assert_true(
    row_count = 5,
    'only create, fresh reconciliation, explicit no-op, and two status projections persist'
  );
END;
$test$;

SELECT extensions.pass('A11-S4-I2 Ads persistence assertion matrix completed');
SELECT * FROM extensions.finish();

ROLLBACK;
