DROP POLICY IF EXISTS "clicks anyone insert" ON public.coupon_clicks;
CREATE POLICY "clicks anyone insert" ON public.coupon_clicks
  FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.coupons c WHERE c.id = coupon_id AND c.status = 'active'));

DROP POLICY IF EXISTS "logos public read" ON storage.objects;