
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS seo_og_image text;

ALTER TABLE public.subcategories
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS seo_og_image text;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS seo_og_image text;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS seo_og_image text;

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_robots text NOT NULL DEFAULT 'index,follow',
  ADD COLUMN IF NOT EXISTS seo_og_image text;
