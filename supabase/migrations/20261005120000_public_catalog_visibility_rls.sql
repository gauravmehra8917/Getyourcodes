BEGIN;

DROP POLICY "stores public read" ON public.stores;
CREATE POLICY "stores public read"
ON public.stores
FOR SELECT
TO anon, authenticated
USING (
  NOT (
    COALESCE(lifecycle_managed, false)
    AND COALESCE(lifecycle_hidden, false)
  )
);

DROP POLICY "coupons public read" ON public.coupons;
CREATE POLICY "coupons public read"
ON public.coupons
FOR SELECT
TO anon, authenticated
USING (
  status = 'active'
  AND (start_date IS NULL OR start_date <= (now() AT TIME ZONE 'UTC')::date)
  AND (expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'UTC')::date)
  AND EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = coupons.store_id
      AND NOT (
        COALESCE(s.lifecycle_managed, false)
        AND COALESCE(s.lifecycle_hidden, false)
      )
  )
);

DROP POLICY "clicks anyone insert" ON public.coupon_clicks;
CREATE POLICY "clicks anyone insert"
ON public.coupon_clicks
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.coupons c
    JOIN public.stores s ON s.id = c.store_id
    WHERE c.id = coupon_clicks.coupon_id
      AND c.status = 'active'
      AND (c.start_date IS NULL OR c.start_date <= (now() AT TIME ZONE 'UTC')::date)
      AND (c.expiry_date IS NULL OR c.expiry_date >= (now() AT TIME ZONE 'UTC')::date)
      AND NOT (
        COALESCE(s.lifecycle_managed, false)
        AND COALESCE(s.lifecycle_hidden, false)
      )
  )
);

COMMIT;
