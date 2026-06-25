
-- SUBCATEGORIES
CREATE TABLE public.subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, slug)
);
GRANT SELECT ON public.subcategories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategories TO authenticated;
GRANT ALL ON public.subcategories TO service_role;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read subcategories" ON public.subcategories FOR SELECT USING (true);
CREATE POLICY "Admins manage subcategories" ON public.subcategories FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- SLIDERS
CREATE TABLE public.sliders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_url text,
  link_url text,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sliders TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sliders TO authenticated;
GRANT ALL ON public.sliders TO service_role;
ALTER TABLE public.sliders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read active sliders" ON public.sliders FOR SELECT USING (active = true);
CREATE POLICY "Admins manage sliders" ON public.sliders FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- PAGES
CREATE TABLE public.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  content text,
  meta_title text,
  meta_description text,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT ALL ON public.pages TO service_role;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read published pages" ON public.pages FOR SELECT USING (published = true);
CREATE POLICY "Admins manage pages" ON public.pages FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- SUBSCRIBERS
CREATE TABLE public.subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.subscribers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscribers TO authenticated;
GRANT ALL ON public.subscribers TO service_role;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can subscribe" ON public.subscribers FOR INSERT TO anon WITH CHECK (length(btrim(email)) > 0);
CREATE POLICY "Authed can subscribe" ON public.subscribers FOR INSERT TO authenticated WITH CHECK (length(btrim(email)) > 0);
CREATE POLICY "Admins read subscribers" ON public.subscribers FOR SELECT TO authenticated USING (private.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins update subscribers" ON public.subscribers FOR UPDATE TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete subscribers" ON public.subscribers FOR DELETE TO authenticated USING (private.has_role(auth.uid(),'admin'));

-- ADS
CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  placement text NOT NULL DEFAULT 'sidebar',
  image_url text,
  link_url text,
  html text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads TO authenticated;
GRANT ALL ON public.ads TO service_role;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read active ads" ON public.ads FOR SELECT USING (active = true);
CREATE POLICY "Admins manage ads" ON public.ads FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- MENUS
CREATE TABLE public.menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  url text NOT NULL,
  location text NOT NULL DEFAULT 'header',
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.menus TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO authenticated;
GRANT ALL ON public.menus TO service_role;
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read active menus" ON public.menus FOR SELECT USING (active = true);
CREATE POLICY "Admins manage menus" ON public.menus FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- EMAIL TEMPLATES
CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage email templates" ON public.email_templates FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- TRANSLATIONS
CREATE TABLE public.translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (locale, key)
);
GRANT SELECT ON public.translations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translations TO authenticated;
GRANT ALL ON public.translations TO service_role;
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read translations" ON public.translations FOR SELECT USING (true);
CREATE POLICY "Admins manage translations" ON public.translations FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- SITE SETTINGS
CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read site settings" ON public.site_settings FOR SELECT USING (true);
CREATE POLICY "Admins manage site settings" ON public.site_settings FOR ALL TO authenticated USING (private.has_role(auth.uid(),'admin')) WITH CHECK (private.has_role(auth.uid(),'admin'));

-- updated_at triggers
CREATE TRIGGER trg_subcategories_updated BEFORE UPDATE ON public.subcategories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sliders_updated BEFORE UPDATE ON public.sliders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pages_updated BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ads_updated BEFORE UPDATE ON public.ads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_menus_updated BEFORE UPDATE ON public.menus FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_email_templates_updated BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_translations_updated BEFORE UPDATE ON public.translations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_site_settings_updated BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
