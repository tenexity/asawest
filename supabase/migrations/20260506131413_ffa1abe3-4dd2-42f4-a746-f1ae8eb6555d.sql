
-- Enums
CREATE TYPE climate_zone AS ENUM ('cold','temperate','hot','freeze_prone');
CREATE TYPE product_category AS ENUM ('PVC','copper','PEX','water_heaters','refrigerants','HVAC_equipment','controls','service_parts','fittings','valves');
CREATE TYPE abc_class AS ENUM ('A','B','C');
CREATE TYPE xyz_class AS ENUM ('X','Y','Z');
CREATE TYPE seasonality_pattern AS ENUM ('cooling_peak','heating_peak','freeze_event','none');
CREATE TYPE customer_type AS ENUM ('contractor','walk_in','project','builder','service_company');
CREATE TYPE po_status AS ENUM ('pending','in_transit','received','late');

-- Branches
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  climate_zone climate_zone NOT NULL,
  opened_date date NOT NULL
);

-- Suppliers
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lead_time_days int NOT NULL,
  lead_time_variability_days int NOT NULL,
  reliability_score numeric(3,2) NOT NULL,
  rebate_program_active boolean NOT NULL DEFAULT false,
  payment_terms text NOT NULL
);

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  description text NOT NULL,
  category product_category NOT NULL,
  subcategory text,
  unit_of_measure text NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  abc_class abc_class NOT NULL,
  xyz_class xyz_class NOT NULL,
  is_intermittent boolean NOT NULL DEFAULT false,
  seasonality_pattern seasonality_pattern NOT NULL DEFAULT 'none',
  is_phase_down boolean NOT NULL DEFAULT false,
  substitute_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL
);
CREATE INDEX idx_products_category ON public.products(category);

-- Supplier <-> Products
CREATE TABLE public.supplier_products (
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_sku text NOT NULL,
  cost numeric(12,2) NOT NULL,
  moq int NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (supplier_id, product_id)
);

-- Inventory levels
CREATE TABLE public.inventory_levels (
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  on_hand int NOT NULL DEFAULT 0,
  on_order int NOT NULL DEFAULT 0,
  allocated int NOT NULL DEFAULT 0,
  safety_stock int NOT NULL DEFAULT 0,
  reorder_point int NOT NULL DEFAULT 0,
  last_counted_at timestamptz,
  PRIMARY KEY (branch_id, product_id)
);
CREATE INDEX idx_inventory_branch ON public.inventory_levels(branch_id);

-- Sales history
CREATE TABLE public.sales_history (
  id bigserial PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  quantity int NOT NULL,
  customer_type customer_type NOT NULL,
  is_will_call boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_sales_product_date ON public.sales_history(product_id, sale_date);
CREATE INDEX idx_sales_branch_date ON public.sales_history(branch_id, sale_date);

-- Purchase orders
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  ordered_date date NOT NULL,
  expected_date date NOT NULL,
  received_date date,
  status po_status NOT NULL
);
CREATE INDEX idx_po_status ON public.purchase_orders(status);

-- Customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type customer_type NOT NULL,
  assigned_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL
);

-- RLS: enable on all, allow public read; writes only via service role
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read branches" ON public.branches FOR SELECT USING (true);
CREATE POLICY "public read suppliers" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "public read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "public read supplier_products" ON public.supplier_products FOR SELECT USING (true);
CREATE POLICY "public read inventory_levels" ON public.inventory_levels FOR SELECT USING (true);
CREATE POLICY "public read sales_history" ON public.sales_history FOR SELECT USING (true);
CREATE POLICY "public read purchase_orders" ON public.purchase_orders FOR SELECT USING (true);
CREATE POLICY "public read customers" ON public.customers FOR SELECT USING (true);
