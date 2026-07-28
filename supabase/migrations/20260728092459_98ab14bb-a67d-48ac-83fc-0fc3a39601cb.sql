DROP POLICY IF EXISTS "System and admins insert activity log" ON public.admin_activity_log;
CREATE POLICY "Admins insert activity log"
ON public.admin_activity_log
FOR INSERT
TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "clicks anyone insert" ON public.coupon_clicks;
CREATE POLICY "clicks anyone insert"
ON public.coupon_clicks
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.coupons c
    WHERE c.id = coupon_clicks.coupon_id AND c.status = 'active'::coupon_status
  )
);