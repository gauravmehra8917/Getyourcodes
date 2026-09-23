-- P1R-D4D1
-- Ads-2 provider-managed refresh SQL compatibility foundation.
--
-- This migration deliberately establishes compatibility only.
--
-- It does NOT:
--   * implement the Ads-2 persistence transaction;
--   * add an Ads-2 dispatcher branch;
--   * execute provider refreshes;
--   * redefine historical Ads-1 count-helper semantics.
--
-- Historical contracts continue using:
--   public.affiliate_sync_v2_valid_expected_counts(jsonb)
--   public.affiliate_sync_v2_valid_persistence_counts(jsonb)
--
-- Ads-2 receives separate update-aware count helpers.

CREATE OR REPLACE FUNCTION
  public.affiliate_sync_ads_v2_valid_refresh_expected_counts(
    _counts jsonb
  )
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.affiliate_sync_v2_has_exact_keys(
      _counts,
      ARRAY[
        'stores',
        'offers',
        'writableStores',
        'writableOffers',
        'writableEntities'
      ]
    )
    OR NOT public.affiliate_sync_v2_has_exact_keys(
      _counts->'stores',
      ARRAY[
        'create',
        'updateExisting',
        'noopExisting',
        'blockedAmbiguous',
        'noopUnmatched'
      ]
    )
    OR NOT public.affiliate_sync_v2_has_exact_keys(
      _counts->'offers',
      ARRAY[
        'create',
        'updateExisting',
        'noopExisting',
        'noopHeld',
        'noopUnresolved'
      ]
    )
  THEN
    RETURN false;
  END IF;

  IF NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{stores,create}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{stores,updateExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{stores,noopExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{stores,blockedAmbiguous}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{stores,noopUnmatched}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{offers,create}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{offers,updateExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{offers,noopExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{offers,noopHeld}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{offers,noopUnresolved}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts->'writableStores'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts->'writableOffers'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts->'writableEntities'
    )
  THEN
    RETURN false;
  END IF;

  RETURN
    (_counts#>>'{stores,blockedAmbiguous}')::numeric = 0

    AND (_counts->>'writableStores')::numeric =
      (_counts#>>'{stores,create}')::numeric
      + (_counts#>>'{stores,updateExisting}')::numeric

    AND (_counts->>'writableOffers')::numeric =
      (_counts#>>'{offers,create}')::numeric
      + (_counts#>>'{offers,updateExisting}')::numeric

    AND (_counts->>'writableEntities')::numeric =
      (_counts->>'writableStores')::numeric
      + (_counts->>'writableOffers')::numeric

    AND (
      (_counts#>>'{stores,create}')::numeric
      + (_counts#>>'{stores,updateExisting}')::numeric
      + (_counts#>>'{stores,noopExisting}')::numeric
    ) <= 2147483647

    AND (
      (_counts#>>'{offers,create}')::numeric
      + (_counts#>>'{offers,updateExisting}')::numeric
      + (_counts#>>'{offers,noopExisting}')::numeric
      + (_counts#>>'{offers,noopHeld}')::numeric
      + (_counts#>>'{offers,noopUnresolved}')::numeric
    ) <= 2147483647

    AND (
      (_counts->>'writableStores')::numeric
      + (_counts->>'writableOffers')::numeric
    ) <= 2147483647

    AND (
      (_counts#>>'{stores,create}')::numeric
      + (_counts#>>'{stores,updateExisting}')::numeric
      + (_counts#>>'{stores,noopExisting}')::numeric
      + (_counts#>>'{stores,noopUnmatched}')::numeric
      + (_counts#>>'{offers,create}')::numeric
      + (_counts#>>'{offers,updateExisting}')::numeric
      + (_counts#>>'{offers,noopExisting}')::numeric
      + (_counts#>>'{offers,noopHeld}')::numeric
      + (_counts#>>'{offers,noopUnresolved}')::numeric
    ) <= 2147483647;

EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;


CREATE OR REPLACE FUNCTION
  public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(
    _counts jsonb
  )
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.affiliate_sync_v2_has_exact_keys(
      _counts,
      ARRAY[
        'expected',
        'actual'
      ]
    )
    OR NOT public.affiliate_sync_ads_v2_valid_refresh_expected_counts(
      _counts->'expected'
    )
    OR NOT public.affiliate_sync_v2_has_exact_keys(
      _counts->'actual',
      ARRAY[
        'storesCreated',
        'storesUpdatedExisting',
        'storesNoopExisting',
        'offersCreated',
        'offersUpdatedExisting',
        'offersNoopExisting',
        'ledgerRows'
      ]
    )
  THEN
    RETURN false;
  END IF;

  IF NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,storesCreated}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,storesUpdatedExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,storesNoopExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,offersCreated}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,offersUpdatedExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,offersNoopExisting}'
    )
    OR NOT public.affiliate_sync_v2_is_nonnegative_integer(
      _counts#>'{actual,ledgerRows}'
    )
  THEN
    RETURN false;
  END IF;

  RETURN
    (_counts#>>'{actual,ledgerRows}')::numeric =
      (_counts#>>'{actual,storesCreated}')::numeric
      + (_counts#>>'{actual,storesUpdatedExisting}')::numeric
      + (_counts#>>'{actual,storesNoopExisting}')::numeric
      + (_counts#>>'{actual,offersCreated}')::numeric
      + (_counts#>>'{actual,offersUpdatedExisting}')::numeric
      + (_counts#>>'{actual,offersNoopExisting}')::numeric

    -- Ads-2 is deterministic after optimistic revalidation.
    --
    -- CREATE does not silently adopt or degrade into NOOP.
    -- An unexpected exact entity during CREATE blocks the future transaction.
    AND (_counts#>>'{actual,storesCreated}')::numeric =
      (_counts#>>'{expected,stores,create}')::numeric

    AND (_counts#>>'{actual,storesUpdatedExisting}')::numeric =
      (_counts#>>'{expected,stores,updateExisting}')::numeric

    AND (_counts#>>'{actual,storesNoopExisting}')::numeric =
      (_counts#>>'{expected,stores,noopExisting}')::numeric

    AND (_counts#>>'{actual,offersCreated}')::numeric =
      (_counts#>>'{expected,offers,create}')::numeric

    AND (_counts#>>'{actual,offersUpdatedExisting}')::numeric =
      (_counts#>>'{expected,offers,updateExisting}')::numeric

    AND (_counts#>>'{actual,offersNoopExisting}')::numeric =
      (_counts#>>'{expected,offers,noopExisting}')::numeric;

EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;


CREATE OR REPLACE FUNCTION
  public.affiliate_sync_ads_v2_refresh_records_updated(
    _counts jsonb
  )
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(
    _counts
  ) THEN
    RETURN NULL;
  END IF;

  RETURN (
    (_counts#>>'{actual,storesUpdatedExisting}')::numeric
    + (_counts#>>'{actual,offersUpdatedExisting}')::numeric
  )::integer;

EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;


REVOKE ALL ON FUNCTION
  public.affiliate_sync_ads_v2_valid_refresh_expected_counts(jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.affiliate_sync_ads_v2_refresh_records_updated(jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.affiliate_sync_ads_v2_valid_refresh_expected_counts(jsonb)
  TO service_role;

GRANT EXECUTE ON FUNCTION
  public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(jsonb)
  TO service_role;

GRANT EXECUTE ON FUNCTION
  public.affiliate_sync_ads_v2_refresh_records_updated(jsonb)
  TO service_role;


-- Shared mutation evidence remains in
-- public.affiliate_import_run_mutations_v2.
--
-- Existing CREATE / NOOP semantics are retained for historical contracts.
-- Ads-2 adds one new exact optimistic UPDATE action/outcome pair.

ALTER TABLE public.affiliate_import_run_mutations_v2
  DROP CONSTRAINT
    affiliate_import_run_mutations_v2_planned_action_check,

  DROP CONSTRAINT
    affiliate_import_run_mutations_v2_outcome_check,

  DROP CONSTRAINT
    affiliate_import_run_mutations_v2_action_outcome_check,

  ADD CONSTRAINT
    affiliate_import_run_mutations_v2_planned_action_check
    CHECK (
      planned_action IN (
        'create',
        'noop_existing',
        'update_existing'
      )
    ),

  ADD CONSTRAINT
    affiliate_import_run_mutations_v2_outcome_check
    CHECK (
      outcome IN (
        'created',
        'noop_existing',
        'updated_existing'
      )
    ),

  ADD CONSTRAINT
    affiliate_import_run_mutations_v2_action_outcome_check
    CHECK (
      (
        planned_action = 'noop_existing'
        AND expected_entity_id IS NOT NULL
        AND outcome = 'noop_existing'
        AND entity_id = expected_entity_id
      )
      OR
      (
        planned_action = 'create'
        AND expected_entity_id IS NULL
        AND outcome IN (
          'created',
          'noop_existing'
        )
      )
      OR
      (
        planned_action = 'update_existing'
        AND expected_entity_id IS NOT NULL
        AND outcome = 'updated_existing'
        AND entity_id = expected_entity_id
      )
    );


-- Run-level coherence becomes contract-version-specific.
--
-- Historical contracts retain the exact generic helper and
-- records_updated = 0 invariant.
--
-- Ads-2 alone is update-aware.

ALTER TABLE public.affiliate_import_runs
  DROP CONSTRAINT
    affiliate_import_runs_v2_persistence_coherence_check,

  ADD CONSTRAINT
    affiliate_import_runs_v2_persistence_coherence_check
    CHECK (
      (
        persistence_contract_version IS NULL
        AND plan_fingerprint_algorithm IS NULL
        AND plan_fingerprint IS NULL
        AND plan_evaluated_at IS NULL
        AND persistence_execution_status IS NULL
        AND persistence_counts IS NULL
      )
      OR
      (
        persistence_contract_version IS NOT NULL
        AND plan_fingerprint_algorithm IS NOT NULL
        AND plan_fingerprint IS NOT NULL
        AND persistence_counts IS NOT NULL

        AND persistence_contract_version IN (
          'v2-a9b-1',
          'v2-a9b-2',
          'v2-a11-ads-1',
          'v2-a11-ads-2'
        )

        AND plan_fingerprint_algorithm =
          'sha256-canonical-plan-v1'

        AND plan_fingerprint ~
          '^[0-9a-f]{64}$'

        AND plan_evaluated_at IS NOT NULL

        AND persistence_execution_status
          IS NOT DISTINCT FROM 'committed'

        AND (
          (
            persistence_contract_version IN (
              'v2-a9b-1',
              'v2-a9b-2',
              'v2-a11-ads-1'
            )

            AND public.affiliate_sync_v2_valid_persistence_counts(
              persistence_counts
            )

            AND records_updated = 0
          )
          OR
          (
            persistence_contract_version =
              'v2-a11-ads-2'

            AND public.affiliate_sync_ads_v2_valid_refresh_persistence_counts(
              persistence_counts
            )

            AND records_updated =
              public.affiliate_sync_ads_v2_refresh_records_updated(
                persistence_counts
              )
          )
        )

        AND provider = 'impact'
        AND preview = false
        AND success = true
        AND finished_at IS NOT NULL
        AND error_message IS NULL
        AND triggered_by IS NOT NULL
      )
    );
