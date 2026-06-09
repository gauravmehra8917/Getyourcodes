ALTER POLICY "clicks admin read" ON public.coupon_clicks
USING (private.has_role(auth.uid(), 'admin'));