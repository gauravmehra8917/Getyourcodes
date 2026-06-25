DROP POLICY "Users can update their own pending reviews" ON public.store_reviews;
CREATE POLICY "Users can update their own pending reviews" ON public.store_reviews
FOR UPDATE
USING (auth.uid() = user_id AND status = 'pending')
WITH CHECK (auth.uid() = user_id AND status = 'pending');