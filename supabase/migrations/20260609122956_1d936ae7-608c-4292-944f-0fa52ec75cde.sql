CREATE POLICY "logos admin read"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'store-logos' AND public.has_role(auth.uid(), 'admin'));