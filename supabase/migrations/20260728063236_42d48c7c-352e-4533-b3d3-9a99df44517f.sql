ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_entity_id text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_entity_id text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_entity_id text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS stores_provider_entity_uidx
  ON public.stores (provider, provider_entity_id)
  WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_provider_entity_uidx
  ON public.categories (provider, provider_entity_id)
  WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coupons_provider_entity_uidx
  ON public.coupons (provider, provider_entity_id)
  WHERE provider IS NOT NULL AND provider_entity_id IS NOT NULL;

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
      INSERT INTO public.stores (name, slug, description, logo_url, affiliate_url, category_id, provider, provider_entity_id, imported_at)
      VALUES (
        rec->>'name', rec->>'slug', rec->>'description', rec->>'logo_url', rec->>'affiliate_url',
        nullif(cat_map->>coalesce(rec->>'category_provider_id',''), '')::uuid,
        _provider, rec->>'provider_entity_id', now()
      ) RETURNING id INTO new_id;
      created := created + 1;
    ELSE
      UPDATE public.stores
        SET name = coalesce(rec->>'name', name),
            description = coalesce(rec->>'description', description),
            logo_url = coalesce(rec->>'logo_url', logo_url),
            affiliate_url = coalesce(rec->>'affiliate_url', affiliate_url),
            category_id = coalesce(nullif(cat_map->>coalesce(rec->>'category_provider_id',''), '')::uuid, category_id),
            provider = _provider,
            provider_entity_id = coalesce(rec->>'provider_entity_id', provider_entity_id),
            imported_at = now()
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

    SELECT id INTO existing_id FROM public.coupons
      WHERE provider = _provider AND provider_entity_id = rec->>'provider_entity_id';

    IF existing_id IS NULL THEN
      INSERT INTO public.coupons (store_id, title, description, coupon_code, coupon_type, affiliate_url, expiry_date, status, terms, provider, provider_entity_id, imported_at)
      VALUES (
        target_store, rec->>'title', rec->>'description', rec->>'coupon_code',
        coalesce(rec->>'coupon_type', 'deal')::coupon_type,
        rec->>'affiliate_url',
        nullif(rec->>'expiry_date','')::date,
        coalesce(rec->>'status', 'active')::coupon_status,
        rec->>'terms', _provider, rec->>'provider_entity_id', now()
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
            expiry_date = nullif(rec->>'expiry_date','')::date,
            status = coalesce(rec->>'status', status::text)::coupon_status,
            terms = coalesce(rec->>'terms', terms),
            imported_at = now()
        WHERE id = existing_id;
      updated := updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_apply(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_apply(jsonb) TO authenticated, service_role;