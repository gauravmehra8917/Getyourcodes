
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Auto-promote first signup to admin
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Enums
CREATE TYPE public.coupon_type AS ENUM ('code', 'deal');
CREATE TYPE public.coupon_status AS ENUM ('active', 'expired', 'draft');

-- Categories
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read" ON public.categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "categories admin all" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Stores
CREATE TABLE public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  affiliate_url TEXT,
  featured BOOLEAN NOT NULL DEFAULT false,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stores_featured ON public.stores(featured) WHERE featured = true;
GRANT SELECT ON public.stores TO anon, authenticated;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stores public read" ON public.stores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "stores admin all" ON public.stores FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Coupons
CREATE TABLE public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  coupon_code TEXT,
  coupon_type coupon_type NOT NULL DEFAULT 'code',
  affiliate_url TEXT,
  expiry_date DATE,
  status coupon_status NOT NULL DEFAULT 'active',
  terms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coupons_store ON public.coupons(store_id);
CREATE INDEX idx_coupons_status ON public.coupons(status);
GRANT SELECT ON public.coupons TO anon, authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupons public read" ON public.coupons FOR SELECT TO anon, authenticated USING (status = 'active');
CREATE POLICY "coupons admin all" ON public.coupons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Coupon clicks
CREATE TABLE public.coupon_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_page TEXT
);
GRANT INSERT ON public.coupon_clicks TO anon, authenticated;
GRANT SELECT ON public.coupon_clicks TO authenticated;
GRANT ALL ON public.coupon_clicks TO service_role;
ALTER TABLE public.coupon_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clicks anyone insert" ON public.coupon_clicks FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "clicks admin read" ON public.coupon_clicks FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Storage bucket for store logos
INSERT INTO storage.buckets (id, name, public) VALUES ('store-logos', 'store-logos', true);

CREATE POLICY "logos public read" ON storage.objects FOR SELECT USING (bucket_id = 'store-logos');
CREATE POLICY "logos admin write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'store-logos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "logos admin update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'store-logos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "logos admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'store-logos' AND public.has_role(auth.uid(), 'admin'));
