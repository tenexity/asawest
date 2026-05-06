# Data Foundation: Plumbing/HVAC Distributor Inventory

Build the database schema and realistic seed data on Lovable Cloud. No UI in this step.

## 1. Enable Lovable Cloud

Provision the backend so Postgres + edge functions are available.

## 2. Schema (migration)

Create the following tables with the exact columns you listed. Notes:

- All `id` fields: `uuid` primary keys with `gen_random_uuid()` default.
- `branches.climate_zone`, `products.category`, `products.seasonality_pattern`, `products.abc_class`, `products.xyz_class`, `sales_history.customer_type`, `purchase_orders.status`, `customers.type` → Postgres enums.
- `products.substitute_product_id` → self-referencing nullable FK.
- `supplier_products` → composite PK `(supplier_id, product_id)`.
- `inventory_levels` → composite PK `(branch_id, product_id)`.
- Add indexes: `sales_history(product_id, sale_date)`, `sales_history(branch_id, sale_date)`, `inventory_levels(branch_id)`, `purchase_orders(status)`, `products(category)`, `products(sku)` unique.
- Enable RLS on every table. Since there is no auth yet and this is internal seed data, add a permissive `SELECT` policy for `anon` + `authenticated` so the future UI can read. Writes restricted to service role (seeding runs server-side).

## 3. Seeding strategy

Seed via a one-shot Supabase **edge function** (`seed-data`) invoked once. Reasoning: 10k products + ~18 months of daily sales = hundreds of thousands of rows; a SQL migration is the wrong tool, and client-side seeding is too slow/insecure. The function uses the service role key and batches inserts (`COPY`-style via `insert()` chunks of 1–5k rows).

### Branches (5)
Atlanta GA (freeze_prone), Charlotte NC (temperate), Phoenix AZ (hot), Dallas TX (freeze_prone — your spec says freeze_prone+hot but enum is single-value; we'll pick `freeze_prone` and note Dallas in name/state), Nashville TN (freeze_prone). Realistic opened_dates spanning 1985–2015.

### Suppliers (~50)
Named list: Charlotte Pipe, Mueller Industries, Uponor, Viega, Rheem, Carrier, Trane, Goodman, Honeywell, Watts, Sloan, A.O. Smith, Bradford White, Lochinvar, Taco, Grundfos. Plus ~34 plausible smaller names (e.g., NIBCO, Apollo Valves, Spears Mfg, Oatey, RectorSeal, Fernco, Milwaukee Valve, Zurn, Jay R. Smith, Webstone, Caleffi, Wilkins, Reliance Worldwide, SharkBite, Cash Acme, McDonnell & Miller, Amtrol, Burnham, Weil-McLain, Navien, Noritz, Takagi, State Water Heaters, HTP, Fujitsu, Mitsubishi Electric, Daikin, LG HVAC, Emerson, Johnson Controls, Belimo, Siemens BT, Resideo, Aprilaire). Lead times 3–45 days; reliability 0.65–0.99; rebate flag ~40% true.

### Products (10,000)
SKU generator per category:
- Fittings (3,000): `CP-{size}-{angle}-{material}` e.g. `CP-4-90L-PVC`, `CP-2-T-CU`.
- PVC pipe (1,500): `PVC-{schedule}-{size}-{length}` e.g. `PVC-40-2-10`.
- Copper (1,000): `CU-{type}-{size}-{length}` e.g. `CU-L-3/4-20`.
- PEX (1,000): `PEX-{size}-{length}{color}` e.g. `PEX-1-100R`.
- Water heaters (800): `WH-{fuel}-{gallons}-{brand}` e.g. `WH-GAS-50-AOS`.
- HVAC equipment (700): `HVAC-{type}-{tons}-{seer}` e.g. `HVAC-AC-3-16`.
- Refrigerants (500): `RFG-{type}-{lbs}` e.g. `RFG-410A-25`, `RFG-32-25`, `RFG-454B-25`. R-410A SKUs get `is_phase_down=true` and `substitute_product_id` linked to a matching R-32 or R-454B SKU (two-pass insert).
- Controls (500): `CTL-{type}-{model}` e.g. `CTL-TSTAT-T6`.
- Service parts (1,000): `SP-{system}-{part}-{model}` e.g. `SP-WH-ANODE-AOS50`. Marked `is_intermittent=true` for ~80% of these.

ABC class distribution: 20% A / 30% B / 50% C. XYZ: 30% X / 40% Y / 30% Z. Seasonality assigned by category (e.g. refrigerants & HVAC equipment → cooling_peak, water heaters & boilers → heating_peak, PEX/insulation/hydrants → freeze_event, fittings → none). Costs $0.50–$8,000; price = cost × (1.18–1.45).

### supplier_products
Each product gets 1–3 suppliers. One marked `is_primary=true`. Cost ≈ product.unit_cost × (0.92–1.05). MOQ from a realistic set {1, 5, 10, 25, 50, 100, 250}.

### sales_history (18 months daily)
Per-branch, per-product demand model:
- Steady movers: Poisson(λ) where λ scales with ABC class (A: 5–20/day, B: 1–4, C: 0.1–0.6).
- cooling_peak: ×3–5 multiplier on May–Aug; near-zero off-season.
- heating_peak: ×3–5 multiplier on Nov–Feb.
- freeze_event: baseline near zero; pick 2–4 random weeks Dec–Feb per freeze_prone branch and apply ×5–10 spike (only Atlanta, Dallas, Nashville).
- Intermittent (Croston): on each day, p(demand)=0.2–0.3, when fires draw uniform 1–5.
- customer_type weighted: 65% contractor, 25% walk_in, 10% project. `is_will_call` ~40% for contractors.

To keep volume tractable: for C-class steady SKUs, only emit rows on days with quantity > 0 (sparse storage). Target ~600k–1.2M rows total; insert in 5k-row batches.

### inventory_levels (every branch × product = 50k rows)
Default sane on_hand around 30–90 days of supply based on average daily demand. Then deliberately corrupt:
- 50 SKUs across branches → on_hand below reorder_point (stockout risk).
- 20 SKUs → on_hand = 0.
- 100 SKUs → on_hand > 180 days of supply (excess).
Tag selections include a mix of A-class movers and seasonal SKUs so the demo surfaces meaningful problems.

### purchase_orders (~30)
Mix of pending / in_transit / received. 5 explicitly `late` (expected_date in the past, no received_date). Spread across suppliers and branches.

### customers (~200)
Realistic contractor/builder names (e.g., "Peachtree Mechanical", "Sunbelt Plumbing Co"), assigned to branches by geography.

## 4. Verification log

At the end of the seed function, log (and return in the response):

- Row counts per table.
- Data health summary, e.g.:
  `Inventory health: 47 SKUs at stockout risk, 18 stocked out, 103 excess (>180 DOS).`
- Phase-down linkage check: `412 R-410A SKUs linked to R-32/R-454B substitutes.`
- Seasonal coverage: counts per `seasonality_pattern`.

## 5. How to run

After the migration applies and the edge function deploys, invoke `seed-data` once. The function is idempotent-guarded: it checks if `products` already has rows and exits early to prevent double-seeding. To re-seed, pass `{ "force": true }`.

## Technical details

- Enums created in migration before tables.
- Edge function uses `@supabase/supabase-js` with the service role key (already available via `SUPABASE_SERVICE_ROLE_KEY` env in Cloud functions).
- Deterministic seeding via a seeded PRNG (e.g., mulberry32) so the demo is reproducible.
- Batch size 2,000 rows for sales_history to stay under request limits; total seed runtime ~60–180s.
- No UI, no routes, no components touched.
