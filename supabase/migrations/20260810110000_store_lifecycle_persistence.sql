-- Catalog Lifecycle Phase 3C: execute application-decided store lifecycle
-- actions inside the existing all-or-nothing import transaction.
CREATE OR REPLACE FUNCTION public.import_apply(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _provider text := coalesce(_payload->>'provider', 'unknown');
  rec jsonb;
  cat_map jsonb := '{}'::jsonb;
  store_map jsonb := '{}'::jsonb;
  new_id uuid;
  existing_id uuid;
  conflicting_id uuid;
  target_store uuid;
  created int := 0;
  updated int := 0;
  skipped int := 0;
  v_status coupon_status;
  v_start date;
  v_end date;
  v_action text;
  v_provider_entity_id text;
  v_requested_existing_id text;
  v_slug text;
  v_source jsonb;
  v_legacy_store jsonb;
  v_legacy_store_count integer;
  v_existing_lifecycle_managed boolean;
  v_existing_lifecycle_hidden boolean;
  jwt_role text := coalesce((current_setting('request.jwt.claims', true)::jsonb->>'role'), '');
BEGIN
  IF NOT (jwt_role = 'service_role' OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- A lifecycle-aware payload is explicit and must be well formed. Any error
  -- aborts this function and therefore rolls back its complete transaction.
  IF _payload ? 'store_lifecycle'
     AND jsonb_typeof(_payload->'store_lifecycle') <> 'array' THEN
    RAISE EXCEPTION 'invalid_store_lifecycle_payload';
  END IF;

  -- Categories
  FOR rec IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'categories', '[]'::jsonb))
  LOOP
    SELECT id INTO existing_id FROM public.categories
      WHERE provider = _provider AND provider_entity_id = rec->>'provider_entity_id';
    IF existing_id IS NULL THEN
      SELECT id INTO existing_id FROM public.categories WHERE slug = rec->>'slug';
    END IF;

    IF existing_id IS NULL THEN
      INSERT INTO public.categories (name, slug, provider, provider_entity_id, imported_at)
      VALUES (rec->>'name', rec->>'slug', _provider, rec->>'provider_entity_id', now())
      RETURNING id INTO new_id;
      created := created + 1;
    ELSE
      UPDATE public.categories
        SET name = coalesce(rec->>'name', name),
            provider = _provider,
            provider_entity_id = coalesce(rec->>'provider_entity_id', provider_entity_id),
            imported_at = now()
        WHERE id = existing_id
        RETURNING id INTO new_id;
      updated := updated + 1;
    END IF;
    cat_map := cat_map || jsonb_build_object(rec->>'provider_entity_id', new_id);
  END LOOP;

  IF _payload ? 'store_lifecycle' THEN
    -- Lifecycle-aware imports do not execute the legacy `stores` loop. The
    -- lifecycle action is the sole authority for every store mutation.
    FOR rec IN SELECT * FROM jsonb_array_elements(_payload->'store_lifecycle')
    LOOP
      v_action := rec->>'action';
      v_provider_entity_id := nullif(btrim(rec->>'providerEntityId'), '');
      v_requested_existing_id := nullif(btrim(rec->>'existingId'), '');
      v_slug := nullif(btrim(rec->>'slug'), '');
      v_source := rec->'source';

      IF v_action IS NULL OR v_action NOT IN (
        'create_store',
        'update_store',
        'lifecycle_hide_store',
        'lifecycle_republish_store'
      ) THEN
        RAISE EXCEPTION 'invalid_store_lifecycle_action: %', coalesce(v_action, 'null');
      END IF;

      IF v_provider_entity_id IS NULL OR jsonb_typeof(v_source) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid_store_lifecycle_payload';
      END IF;

      IF v_action IN ('update_store', 'lifecycle_hide_store', 'lifecycle_republish_store')
         AND v_requested_existing_id IS NULL THEN
        RAISE EXCEPTION 'store_lifecycle_existing_id_required';
      END IF;

      -- Phase 3B sends legacy presentation fields for create/update actions.
      -- They enrich this one lifecycle mutation only; they never decide it.
      v_legacy_store := NULL;
      IF v_action IN ('create_store', 'update_store')
         AND jsonb_typeof(coalesce(_payload->'stores', '[]'::jsonb)) = 'array' THEN
        SELECT count(*) INTO v_legacy_store_count
        FROM jsonb_array_elements(_payload->'stores') AS candidate
        WHERE candidate->>'provider_entity_id' = v_provider_entity_id;

        IF v_legacy_store_count > 1 THEN
          RAISE EXCEPTION 'duplicate_legacy_store_payload: %', v_provider_entity_id;
        ELSIF v_legacy_store_count = 1 THEN
          SELECT candidate INTO v_legacy_store
          FROM jsonb_array_elements(_payload->'stores') AS candidate
          WHERE candidate->>'provider_entity_id' = v_provider_entity_id;
        END IF;
      END IF;

      SELECT id, lifecycle_managed, lifecycle_hidden
        INTO existing_id, v_existing_lifecycle_managed, v_existing_lifecycle_hidden
      FROM public.stores
      WHERE provider = _provider
        AND provider_entity_id = v_provider_entity_id;

      IF existing_id IS NOT NULL
         AND v_requested_existing_id IS NOT NULL
         AND existing_id::text <> v_requested_existing_id THEN
        RAISE EXCEPTION 'store_lifecycle_existing_id_mismatch';
      END IF;

      IF v_action = 'create_store' THEN
        IF existing_id IS NULL THEN
          IF v_slug IS NULL THEN
            RAISE EXCEPTION 'store_lifecycle_slug_required';
          END IF;

          SELECT id INTO conflicting_id
          FROM public.stores
          WHERE slug = v_slug;

          IF conflicting_id IS NOT NULL THEN
            RAISE EXCEPTION 'provider_store_slug_conflict';
          END IF;

          INSERT INTO public.stores (
            name, slug, description, logo_url, logo_source_url, affiliate_url, category_id,
            country, shipping_regions, metadata,
            seo_title, seo_description, seo_canonical_url,
            provider, provider_entity_id, imported_at,
            import_origin, lifecycle_managed, lifecycle_hidden,
            last_qualification_result, last_qualified_at
          )
          VALUES (
            coalesce(v_legacy_store->>'name', v_source->>'name'),
            v_slug,
            coalesce(v_legacy_store->>'description', v_source->>'description'),
            coalesce(v_legacy_store->>'logo_url', v_source->>'logo'),
            coalesce(v_legacy_store->>'logo_source_url', v_source->>'logo'),
            coalesce(v_legacy_store->>'affiliate_url', v_source->>'website'),
            nullif(cat_map->>coalesce(v_legacy_store->>'category_provider_id', ''), '')::uuid,
            coalesce(v_legacy_store->>'country', v_source->>'country'),
            coalesce((
              SELECT array_agg(value::text)
              FROM jsonb_array_elements_text(coalesce(
                v_legacy_store->'shipping_regions',
                v_source->'metadata'->'shippingRegions',
                v_source->'metadata'->'ShippingRegions',
                '[]'::jsonb
              )) AS value
            ), '{}'),
            coalesce(v_legacy_store->'metadata', v_source->'metadata', '{}'::jsonb),
            v_legacy_store->>'seo_title',
            v_legacy_store->>'seo_description',
            v_legacy_store->>'seo_canonical_url',
            _provider, v_provider_entity_id, now(),
            'provider', true, false,
            'qualified', now()
          )
          RETURNING id INTO new_id;
          created := created + 1;
        ELSE
          -- A concurrent or repeated create can only refresh a known
          -- lifecycle-managed provider row; it can never take over a manual row.
          IF v_existing_lifecycle_managed IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'store_lifecycle_unmanaged_store';
          END IF;

          UPDATE public.stores
          SET name = coalesce(v_legacy_store->>'name', v_source->>'name', name),
              description = coalesce(nullif(btrim(description), ''), v_legacy_store->>'description', v_source->>'description'),
              logo_url = coalesce(v_legacy_store->>'logo_url', v_source->>'logo', logo_url),
              logo_source_url = coalesce(v_legacy_store->>'logo_source_url', v_source->>'logo', logo_source_url),
              affiliate_url = coalesce(v_legacy_store->>'affiliate_url', v_source->>'website', affiliate_url),
              category_id = coalesce(nullif(cat_map->>coalesce(v_legacy_store->>'category_provider_id', ''), '')::uuid, category_id),
              country = coalesce(v_legacy_store->>'country', v_source->>'country', country),
              shipping_regions = CASE
                WHEN coalesce(v_legacy_store->'shipping_regions', v_source->'metadata'->'shippingRegions', v_source->'metadata'->'ShippingRegions') IS NOT NULL
                  AND jsonb_array_length(coalesce(v_legacy_store->'shipping_regions', v_source->'metadata'->'shippingRegions', v_source->'metadata'->'ShippingRegions', '[]'::jsonb)) > 0
                THEN (SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(v_legacy_store->'shipping_regions', v_source->'metadata'->'shippingRegions', v_source->'metadata'->'ShippingRegions')) AS value)
                ELSE shipping_regions END,
              metadata = metadata || coalesce(v_legacy_store->'metadata', v_source->'metadata', '{}'::jsonb),
              seo_title = coalesce(nullif(btrim(seo_title), ''), v_legacy_store->>'seo_title'),
              seo_description = coalesce(nullif(btrim(seo_description), ''), v_legacy_store->>'seo_description'),
              seo_canonical_url = coalesce(nullif(btrim(seo_canonical_url), ''), v_legacy_store->>'seo_canonical_url'),
              import_origin = 'provider',
              lifecycle_managed = true,
              lifecycle_hidden = false,
              last_qualification_result = 'qualified',
              last_qualified_at = now(),
              imported_at = now(),
              updated_at = now()
          WHERE id = existing_id
          RETURNING id INTO new_id;
          updated := updated + 1;
        END IF;

      ELSIF v_action = 'update_store' THEN
        IF existing_id IS NULL OR v_existing_lifecycle_managed IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'store_lifecycle_unmanaged_store';
        END IF;

        UPDATE public.stores
        SET name = coalesce(v_legacy_store->>'name', v_source->>'name', name),
            description = coalesce(nullif(btrim(description), ''), v_legacy_store->>'description', v_source->>'description'),
            logo_url = coalesce(v_legacy_store->>'logo_url', v_source->>'logo', logo_url),
            logo_source_url = coalesce(v_legacy_store->>'logo_source_url', v_source->>'logo', logo_source_url),
            affiliate_url = coalesce(v_legacy_store->>'affiliate_url', v_source->>'website', affiliate_url),
            category_id = coalesce(nullif(cat_map->>coalesce(v_legacy_store->>'category_provider_id', ''), '')::uuid, category_id),
            country = coalesce(v_legacy_store->>'country', v_source->>'country', country),
            shipping_regions = CASE
              WHEN coalesce(v_legacy_store->'shipping_regions', v_source->'metadata'->'shippingRegions', v_source->'metadata'->'ShippingRegions') IS NOT NULL
                AND jsonb_array_length(coalesce(v_legacy_store->'shipping_regions', v_source->'metadata'->'shippingRegions', v_source->'metadata'->'ShippingRegions', '[]'::jsonb)) > 0
              THEN (SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(v_legacy_store->'shipping_regions', v_source->'metadata'->'shippingRegions', v_source->'metadata'->'ShippingRegions')) AS value)
              ELSE shipping_regions END,
            metadata = metadata || coalesce(v_legacy_store->'metadata', v_source->'metadata', '{}'::jsonb),
            seo_title = coalesce(nullif(btrim(seo_title), ''), v_legacy_store->>'seo_title'),
            seo_description = coalesce(nullif(btrim(seo_description), ''), v_legacy_store->>'seo_description'),
            seo_canonical_url = coalesce(nullif(btrim(seo_canonical_url), ''), v_legacy_store->>'seo_canonical_url'),
            last_qualification_result = 'qualified',
            last_qualified_at = now(),
            imported_at = now(),
            updated_at = now()
        WHERE id = existing_id
        RETURNING id INTO new_id;
        updated := updated + 1;

      ELSIF v_action = 'lifecycle_hide_store' THEN
        IF existing_id IS NULL OR v_existing_lifecycle_managed IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'store_lifecycle_unmanaged_store';
        END IF;

        UPDATE public.stores
        SET lifecycle_hidden = true,
            last_qualification_result = 'unqualified',
            updated_at = now()
        WHERE id = existing_id
        RETURNING id INTO new_id;
        updated := updated + 1;

      ELSIF v_action = 'lifecycle_republish_store' THEN
        IF existing_id IS NULL OR v_existing_lifecycle_managed IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'store_lifecycle_unmanaged_store';
        END IF;
        IF v_existing_lifecycle_hidden IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'store_lifecycle_not_hidden';
        END IF;

        UPDATE public.stores
        SET lifecycle_hidden = false,
            last_qualification_result = 'qualified',
            last_qualified_at = now(),
            updated_at = now()
        WHERE id = existing_id
        RETURNING id INTO new_id;
        updated := updated + 1;
      END IF;

      store_map := store_map || jsonb_build_object(v_provider_entity_id, new_id);
    END LOOP;

  ELSE
    -- Backward-compatible path for callers that predate `store_lifecycle`.
    FOR rec IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'stores', '[]'::jsonb))
    LOOP
      SELECT id INTO existing_id FROM public.stores
        WHERE provider = _provider AND provider_entity_id = rec->>'provider_entity_id';
      IF existing_id IS NULL THEN
        SELECT id INTO existing_id FROM public.stores WHERE slug = rec->>'slug';
      END IF;

      IF existing_id IS NULL THEN
        INSERT INTO public.stores (
          name, slug, description, logo_url, logo_source_url, affiliate_url, category_id,
          country, shipping_regions, metadata,
          seo_title, seo_description, seo_canonical_url,
          provider, provider_entity_id, imported_at
        )
        VALUES (
          rec->>'name', rec->>'slug', rec->>'description', rec->>'logo_url', rec->>'logo_source_url', rec->>'affiliate_url',
          nullif(cat_map->>coalesce(rec->>'category_provider_id', ''), '')::uuid,
          rec->>'country',
          coalesce((SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(rec->'shipping_regions', '[]'::jsonb)) AS value), '{}'),
          coalesce(rec->'metadata', '{}'::jsonb),
          rec->>'seo_title', rec->>'seo_description', rec->>'seo_canonical_url',
          _provider, rec->>'provider_entity_id', now()
        )
        RETURNING id INTO new_id;
        created := created + 1;
      ELSE
        UPDATE public.stores
          SET name = coalesce(rec->>'name', name),
              description = coalesce(nullif(btrim(description), ''), rec->>'description'),
              logo_url = coalesce(rec->>'logo_url', logo_url),
              logo_source_url = coalesce(rec->>'logo_source_url', logo_source_url),
              affiliate_url = coalesce(rec->>'affiliate_url', affiliate_url),
              category_id = coalesce(nullif(cat_map->>coalesce(rec->>'category_provider_id', ''), '')::uuid, category_id),
              country = coalesce(rec->>'country', country),
              shipping_regions = CASE
                WHEN rec->'shipping_regions' IS NOT NULL AND jsonb_array_length(coalesce(rec->'shipping_regions', '[]'::jsonb)) > 0
                THEN (SELECT array_agg(value::text) FROM jsonb_array_elements_text(rec->'shipping_regions') AS value)
                ELSE shipping_regions END,
              metadata = metadata || coalesce(rec->'metadata', '{}'::jsonb),
              seo_title = coalesce(nullif(btrim(seo_title), ''), rec->>'seo_title'),
              seo_description = coalesce(nullif(btrim(seo_description), ''), rec->>'seo_description'),
              seo_canonical_url = coalesce(nullif(btrim(seo_canonical_url), ''), rec->>'seo_canonical_url'),
              provider = _provider,
              provider_entity_id = coalesce(rec->>'provider_entity_id', provider_entity_id),
              imported_at = now(),
              updated_at = now()
          WHERE id = existing_id
          RETURNING id INTO new_id;
        updated := updated + 1;
      END IF;
      store_map := store_map || jsonb_build_object(rec->>'provider_entity_id', new_id);
    END LOOP;
  END IF;

  -- Coupons and deals
  FOR rec IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'coupons', '[]'::jsonb))
  LOOP
    target_store := nullif(store_map->>coalesce(rec->>'store_provider_id', ''), '')::uuid;
    IF target_store IS NULL AND rec->>'store_provider_id' IS NOT NULL THEN
      SELECT id INTO target_store FROM public.stores
        WHERE provider = _provider AND provider_entity_id = rec->>'store_provider_id';
    END IF;
    IF target_store IS NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    v_start := nullif(rec->>'start_date', '')::date;
    v_end := nullif(rec->>'expiry_date', '')::date;

    IF v_end IS NOT NULL AND v_end < current_date THEN
      v_status := 'expired';
    ELSIF v_start IS NOT NULL AND v_start > current_date THEN
      v_status := 'draft';
    ELSE
      v_status := coalesce(nullif(rec->>'status', ''), 'active')::coupon_status;
      IF v_status = 'expired' AND (v_end IS NULL OR v_end >= current_date) THEN
        v_status := 'active';
      END IF;
    END IF;

    SELECT id INTO existing_id FROM public.coupons
      WHERE provider = _provider AND provider_entity_id = rec->>'provider_entity_id';

    IF existing_id IS NULL THEN
      INSERT INTO public.coupons (
        store_id, title, description, coupon_code, coupon_type, affiliate_url,
        expiry_date, start_date, status, terms,
        discount_type, discount_value, landing_page_url, structured_terms, metadata,
        seo_title, seo_description, seo_canonical_url,
        provider, provider_entity_id, imported_at
      )
      VALUES (
        target_store, rec->>'title', rec->>'description', rec->>'coupon_code',
        coalesce(rec->>'coupon_type', 'deal')::coupon_type,
        rec->>'affiliate_url',
        v_end, v_start, v_status,
        rec->>'terms',
        rec->>'discount_type',
        nullif(rec->>'discount_value', '')::numeric,
        rec->>'landing_page_url',
        rec->'structured_terms',
        coalesce(rec->'metadata', '{}'::jsonb),
        rec->>'seo_title', rec->>'seo_description', rec->>'seo_canonical_url',
        _provider, rec->>'provider_entity_id', now()
      );
      created := created + 1;
    ELSE
      UPDATE public.coupons
        SET store_id = target_store,
            title = coalesce(rec->>'title', title),
            description = coalesce(nullif(btrim(description), ''), rec->>'description'),
            coupon_code = rec->>'coupon_code',
            coupon_type = coalesce(rec->>'coupon_type', coupon_type::text)::coupon_type,
            affiliate_url = coalesce(rec->>'affiliate_url', affiliate_url),
            expiry_date = v_end,
            start_date = coalesce(v_start, start_date),
            status = v_status,
            terms = coalesce(nullif(btrim(terms), ''), rec->>'terms'),
            discount_type = coalesce(rec->>'discount_type', discount_type),
            discount_value = coalesce(nullif(rec->>'discount_value', '')::numeric, discount_value),
            landing_page_url = coalesce(rec->>'landing_page_url', landing_page_url),
            structured_terms = coalesce(structured_terms, rec->'structured_terms'),
            metadata = metadata || coalesce(rec->'metadata', '{}'::jsonb),
            seo_title = coalesce(nullif(btrim(seo_title), ''), rec->>'seo_title'),
            seo_description = coalesce(nullif(btrim(seo_description), ''), rec->>'seo_description'),
            seo_canonical_url = coalesce(nullif(btrim(seo_canonical_url), ''), rec->>'seo_canonical_url'),
            imported_at = now(),
            updated_at = now()
        WHERE id = existing_id;
      updated := updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
END;
$fn$;
