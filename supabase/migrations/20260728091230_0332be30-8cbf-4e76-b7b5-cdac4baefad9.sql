
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS shipping_regions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS logo_source_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS landing_page_url text,
  ADD COLUMN IF NOT EXISTS structured_terms jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.import_apply(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _provider text := coalesce(_payload->>'provider', 'unknown');
  rec jsonb;
  cat_map jsonb := '{}'::jsonb;
  store_map jsonb := '{}'::jsonb;
  new_id uuid;
  existing_id uuid;
  target_store uuid;
  created int := 0;
  updated int := 0;
  skipped int := 0;
  v_status coupon_status;
  v_start date;
  v_end date;
  jwt_role text := coalesce((current_setting('request.jwt.claims', true)::jsonb->>'role'), '');
BEGIN
  IF NOT (jwt_role = 'service_role' OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
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

  -- Stores
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
        nullif(cat_map->>coalesce(rec->>'category_provider_id',''), '')::uuid,
        rec->>'country',
        coalesce((SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(rec->'shipping_regions','[]'::jsonb)) AS value), '{}'),
        coalesce(rec->'metadata', '{}'::jsonb),
        rec->>'seo_title', rec->>'seo_description', rec->>'seo_canonical_url',
        _provider, rec->>'provider_entity_id', now()
      ) RETURNING id INTO new_id;
      created := created + 1;
    ELSE
      UPDATE public.stores
        SET name = coalesce(rec->>'name', name),
            description = coalesce(rec->>'description', description),
            logo_url = coalesce(rec->>'logo_url', logo_url),
            logo_source_url = coalesce(rec->>'logo_source_url', logo_source_url),
            affiliate_url = coalesce(rec->>'affiliate_url', affiliate_url),
            category_id = coalesce(nullif(cat_map->>coalesce(rec->>'category_provider_id',''), '')::uuid, category_id),
            country = coalesce(rec->>'country', country),
            shipping_regions = CASE
              WHEN rec->'shipping_regions' IS NOT NULL AND jsonb_array_length(coalesce(rec->'shipping_regions','[]'::jsonb)) > 0
              THEN (SELECT array_agg(value::text) FROM jsonb_array_elements_text(rec->'shipping_regions') AS value)
              ELSE shipping_regions END,
            metadata = metadata || coalesce(rec->'metadata', '{}'::jsonb),
            -- generated SEO only fills empty fields; admin edits are never overwritten
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

  -- Coupons and deals
  FOR rec IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'coupons', '[]'::jsonb))
  LOOP
    target_store := nullif(store_map->>coalesce(rec->>'store_provider_id',''), '')::uuid;
    IF target_store IS NULL AND rec->>'store_provider_id' IS NOT NULL THEN
      SELECT id INTO target_store FROM public.stores
        WHERE provider = _provider AND provider_entity_id = rec->>'store_provider_id';
    END IF;
    IF target_store IS NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    v_start := nullif(rec->>'start_date','')::date;
    v_end := nullif(rec->>'expiry_date','')::date;

    -- Publishing rules: future offers stay draft, past offers expired,
    -- otherwise the provider status decides (default active).
    IF v_end IS NOT NULL AND v_end < current_date THEN
      v_status := 'expired';
    ELSIF v_start IS NOT NULL AND v_start > current_date THEN
      v_status := 'draft';
    ELSE
      v_status := coalesce(nullif(rec->>'status',''), 'active')::coupon_status;
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
        nullif(rec->>'discount_value','')::numeric,
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
            description = coalesce(rec->>'description', description),
            coupon_code = rec->>'coupon_code',
            coupon_type = coalesce(rec->>'coupon_type', coupon_type::text)::coupon_type,
            affiliate_url = coalesce(rec->>'affiliate_url', affiliate_url),
            expiry_date = v_end,
            start_date = coalesce(v_start, start_date),
            status = v_status,
            terms = coalesce(rec->>'terms', terms),
            discount_type = coalesce(rec->>'discount_type', discount_type),
            discount_value = coalesce(nullif(rec->>'discount_value','')::numeric, discount_value),
            landing_page_url = coalesce(rec->>'landing_page_url', landing_page_url),
            structured_terms = coalesce(rec->'structured_terms', structured_terms),
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
$function$;
