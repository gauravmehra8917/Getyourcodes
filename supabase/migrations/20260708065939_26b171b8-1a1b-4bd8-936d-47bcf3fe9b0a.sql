
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS seo_og_image text;
