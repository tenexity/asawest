// Seeds the plumbing/HVAC distributor database with realistic data.
// Invoke once: supabase.functions.invoke('seed-data'). Pass { force: true } to re-seed.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Deterministic PRNG (mulberry32)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260506);
const ri = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
function poisson(lambda: number) {
  if (lambda <= 0) return 0;
  // Knuth
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

async function chunkInsert(supabase: any, table: string, rows: any[], size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw new Error(`${table} insert at ${i}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const force = !!body.force;

  // Idempotency guard
  const { count: existingProducts } = await supabase
    .from("products").select("*", { count: "exact", head: true });
  if ((existingProducts ?? 0) > 0 && !force) {
    return new Response(JSON.stringify({
      skipped: true,
      message: "Database already seeded. Pass { force: true } to re-seed.",
      products: existingProducts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (force) {
    // Delete in dependency order
    for (const t of ["sales_history","purchase_orders","supplier_products","inventory_levels","customers"]) {
      await supabase.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000").throwOnError?.();
      // sales_history uses bigint id; fall back
      await supabase.from(t).delete().gte("ctid", "(0,0)" as any).then(() => {}).catch(() => {});
    }
    // Use raw delete via rpc-less approach: just delete all
    for (const t of ["sales_history","purchase_orders","supplier_products","inventory_levels","customers","products","suppliers","branches"]) {
      const { error } = await supabase.from(t).delete().not("ctid", "is", null as any);
      if (error) {
        // try by gte on a known column
        await supabase.from(t).delete().gte("name" as any, "");
      }
    }
  }

  const log: string[] = [];
  const startedAt = Date.now();

  // ============ BRANCHES ============
  const branchSeed = [
    { name: "Atlanta Distribution Center", city: "Atlanta", state: "GA", climate_zone: "freeze_prone", opened_date: "1992-04-15" },
    { name: "Charlotte Branch",            city: "Charlotte", state: "NC", climate_zone: "temperate",    opened_date: "1998-09-01" },
    { name: "Phoenix Desert Hub",          city: "Phoenix",  state: "AZ", climate_zone: "hot",           opened_date: "2005-06-20" },
    { name: "Dallas Metroplex Center",     city: "Dallas",   state: "TX", climate_zone: "freeze_prone",  opened_date: "1988-02-10" },
    { name: "Nashville Branch",            city: "Nashville",state: "TN", climate_zone: "freeze_prone",  opened_date: "2010-11-05" },
  ];
  const { data: branches, error: bErr } = await supabase.from("branches").insert(branchSeed).select();
  if (bErr) throw bErr;
  log.push(`branches: ${branches!.length}`);

  // ============ SUPPLIERS ============
  const supplierNames = [
    "Charlotte Pipe","Mueller Industries","Uponor","Viega","Rheem","Carrier","Trane","Goodman",
    "Honeywell","Watts","Sloan","A.O. Smith","Bradford White","Lochinvar","Taco","Grundfos",
    "NIBCO","Apollo Valves","Spears Mfg","Oatey","RectorSeal","Fernco","Milwaukee Valve","Zurn",
    "Jay R. Smith","Webstone","Caleffi","Wilkins","Reliance Worldwide","SharkBite","Cash Acme",
    "McDonnell & Miller","Amtrol","Burnham","Weil-McLain","Navien","Noritz","Takagi","State Water Heaters",
    "HTP","Fujitsu","Mitsubishi Electric","Daikin","LG HVAC","Emerson","Johnson Controls","Belimo",
    "Siemens BT","Resideo","Aprilaire",
  ];
  const paymentTerms = ["NET 30","NET 45","NET 60","2/10 NET 30","COD"];
  const supplierRows = supplierNames.map((name) => ({
    name,
    lead_time_days: ri(3, 45),
    lead_time_variability_days: ri(1, 10),
    reliability_score: Math.round((0.65 + rand() * 0.34) * 100) / 100,
    rebate_program_active: rand() < 0.4,
    payment_terms: pick(paymentTerms),
  }));
  const { data: suppliers } = await supabase.from("suppliers").insert(supplierRows).select();
  log.push(`suppliers: ${suppliers!.length}`);

  // ============ PRODUCTS ============
  type ProdSpec = {
    sku: string; description: string; category: string; subcategory: string;
    unit_of_measure: string; unit_cost: number;
    seasonality_pattern: string; is_intermittent: boolean;
    is_phase_down: boolean;
  };
  const products: ProdSpec[] = [];

  const sizes = ["1/2","3/4","1","1-1/4","1-1/2","2","2-1/2","3","4","6"];
  const angles = ["90L","45L","T","C","CAP","RED","UN"]; // elbow/tee/coupler/cap/reducer/union
  const fittingMaterials = ["PVC","CPVC","CU","BRASS","PEX","BLK"];

  // 3000 fittings
  for (let i = 0; i < 3000; i++) {
    const sz = pick(sizes), ang = pick(angles), mat = pick(fittingMaterials);
    products.push({
      sku: `CP-${sz}-${ang}-${mat}-${i}`,
      description: `${sz}" ${ang === "90L" ? "90° Elbow" : ang === "45L" ? "45° Elbow" : ang === "T" ? "Tee" : ang === "C" ? "Coupling" : ang === "CAP" ? "Cap" : ang === "RED" ? "Reducer" : "Union"} ${mat}`,
      category: "fittings", subcategory: mat, unit_of_measure: "EA",
      unit_cost: Math.round((0.4 + rand() * 18) * 100) / 100,
      seasonality_pattern: "none", is_intermittent: false, is_phase_down: false,
    });
  }
  // 1500 PVC pipe
  const schedules = ["40","80","DWV"];
  const lengths = ["10","20"];
  for (let i = 0; i < 1500; i++) {
    const sz = pick(sizes), sch = pick(schedules), len = pick(lengths);
    products.push({
      sku: `PVC-${sch}-${sz}-${len}-${i}`,
      description: `${sz}" Sch ${sch} PVC Pipe ${len}'`,
      category: "PVC", subcategory: `Sch${sch}`, unit_of_measure: "EA",
      unit_cost: Math.round((3 + rand() * 90) * 100) / 100,
      seasonality_pattern: "none", is_intermittent: false, is_phase_down: false,
    });
  }
  // 1000 copper
  const cuTypes = ["L","M","K"];
  for (let i = 0; i < 1000; i++) {
    const sz = pick(sizes), tp = pick(cuTypes), len = pick(["10","20"]);
    products.push({
      sku: `CU-${tp}-${sz}-${len}-${i}`,
      description: `${sz}" Type ${tp} Copper Tube ${len}'`,
      category: "copper", subcategory: `Type${tp}`, unit_of_measure: "EA",
      unit_cost: Math.round((8 + rand() * 240) * 100) / 100,
      seasonality_pattern: "none", is_intermittent: false, is_phase_down: false,
    });
  }
  // 1000 PEX
  const pexLengths = ["100","300","500"];
  const pexColors = [["R","Red"],["B","Blue"],["W","White"]];
  for (let i = 0; i < 1000; i++) {
    const sz = pick(["3/8","1/2","3/4","1","1-1/4"]);
    const len = pick(pexLengths);
    const [code, name] = pick(pexColors);
    products.push({
      sku: `PEX-${sz}-${len}${code}-${i}`,
      description: `${sz}" PEX-A Tubing ${len}ft ${name}`,
      category: "PEX", subcategory: "PEX-A", unit_of_measure: "ROLL",
      unit_cost: Math.round((35 + rand() * 320) * 100) / 100,
      seasonality_pattern: "freeze_event", is_intermittent: false, is_phase_down: false,
    });
  }
  // 800 water heaters
  const fuels = ["GAS","ELEC","HP"];
  const gallons = ["30","40","50","75","100","119"];
  const whBrands = ["AOS","BW","RHM","STA","LCH"];
  for (let i = 0; i < 800; i++) {
    const f = pick(fuels), g = pick(gallons), b = pick(whBrands);
    products.push({
      sku: `WH-${f}-${g}-${b}-${i}`,
      description: `${g}gal ${f === "HP" ? "Heat Pump" : f} Water Heater ${b}`,
      category: "water_heaters", subcategory: f, unit_of_measure: "EA",
      unit_cost: Math.round((420 + rand() * 3500) * 100) / 100,
      seasonality_pattern: "heating_peak", is_intermittent: false, is_phase_down: false,
    });
  }
  // 700 HVAC equipment
  const hvacTypes = ["AC","HP","FUR","AHU","PKG"];
  for (let i = 0; i < 700; i++) {
    const t = pick(hvacTypes), tons = ri(2, 5), seer = pick([14,15,16,17,18,20]);
    const heating = t === "FUR" || t === "AHU";
    products.push({
      sku: `HVAC-${t}-${tons}-${seer}-${i}`,
      description: `${tons}-ton ${t} ${seer} SEER`,
      category: "HVAC_equipment", subcategory: t, unit_of_measure: "EA",
      unit_cost: Math.round((1200 + rand() * 6500) * 100) / 100,
      seasonality_pattern: heating ? "heating_peak" : "cooling_peak",
      is_intermittent: false, is_phase_down: false,
    });
  }
  // 500 refrigerants — track index for substitute linking
  const refStart = products.length;
  // Build matched trios: 410A (phase-down), 32 (sub), 454B (sub)
  const refCount = 500;
  for (let i = 0; i < refCount; i++) {
    const lbs = pick([10,25,50,100]);
    const types = ["410A","32","454B","134a","404A","407C"];
    const t = pick(types);
    const phaseDown = t === "410A" || t === "404A";
    products.push({
      sku: `RFG-${t}-${lbs}-${i}`,
      description: `R-${t} Refrigerant ${lbs}lb Cylinder`,
      category: "refrigerants", subcategory: t, unit_of_measure: "CYL",
      unit_cost: Math.round((90 + rand() * 700) * 100) / 100,
      seasonality_pattern: "cooling_peak", is_intermittent: false,
      is_phase_down: phaseDown,
    });
  }
  // 500 controls
  const ctlTypes = ["TSTAT","ZONE","SENSOR","ACTUATOR","RELAY"];
  for (let i = 0; i < 500; i++) {
    const t = pick(ctlTypes);
    products.push({
      sku: `CTL-${t}-M${ri(100,999)}-${i}`,
      description: `${t} Control Module`,
      category: "controls", subcategory: t, unit_of_measure: "EA",
      unit_cost: Math.round((25 + rand() * 480) * 100) / 100,
      seasonality_pattern: "none", is_intermittent: false, is_phase_down: false,
    });
  }
  // 1000 service parts (intermittent demand)
  const spParts = ["ANODE","ELEMENT","TC","GAS-VLV","IGN","FAN-MTR","CAP","CONTACTOR","BOARD","SENSOR"];
  for (let i = 0; i < 1000; i++) {
    const sys = pick(["WH","HVAC","BOILER"]);
    const part = pick(spParts);
    products.push({
      sku: `SP-${sys}-${part}-M${ri(100,999)}-${i}`,
      description: `${sys} ${part} Service Part`,
      category: "service_parts", subcategory: sys, unit_of_measure: "EA",
      unit_cost: Math.round((6 + rand() * 280) * 100) / 100,
      seasonality_pattern: "none", is_intermittent: rand() < 0.8, is_phase_down: false,
    });
  }

  // Assign ABC/XYZ + price
  const productRows = products.map((p) => {
    const r = rand();
    const abc = r < 0.2 ? "A" : r < 0.5 ? "B" : "C";
    const r2 = rand();
    const xyz = r2 < 0.3 ? "X" : r2 < 0.7 ? "Y" : "Z";
    const margin = 1.18 + rand() * 0.27;
    return {
      sku: p.sku,
      description: p.description,
      category: p.category,
      subcategory: p.subcategory,
      unit_of_measure: p.unit_of_measure,
      unit_cost: p.unit_cost,
      unit_price: Math.round(p.unit_cost * margin * 100) / 100,
      abc_class: abc,
      xyz_class: xyz,
      is_intermittent: p.is_intermittent,
      seasonality_pattern: p.seasonality_pattern,
      is_phase_down: p.is_phase_down,
    };
  });

  await chunkInsert(supabase, "products", productRows, 1000);

  // Pull back ids
  const { data: insertedProducts, error: pErr } = await supabase
    .from("products").select("id, sku, category, subcategory, abc_class, seasonality_pattern, is_phase_down, is_intermittent, unit_cost");
  if (pErr) throw pErr;
  log.push(`products: ${insertedProducts!.length}`);

  // ===== Phase-down substitution: link R-410A to R-32 / R-454B =====
  const subs = insertedProducts!.filter((p) =>
    p.category === "refrigerants" && (p.subcategory === "32" || p.subcategory === "454B")
  );
  const phaseDownProds = insertedProducts!.filter((p) => p.is_phase_down && p.subcategory === "410A");
  let linked = 0;
  if (subs.length > 0) {
    const updates: { id: string; substitute_product_id: string }[] = [];
    for (const p of phaseDownProds) {
      updates.push({ id: p.id, substitute_product_id: pick(subs).id });
    }
    // Update one-by-one in batches via upsert
    for (let i = 0; i < updates.length; i += 200) {
      const slice = updates.slice(i, i + 200);
      await Promise.all(slice.map((u) =>
        supabase.from("products").update({ substitute_product_id: u.substitute_product_id }).eq("id", u.id)
      ));
      linked += slice.length;
    }
  }
  log.push(`phase_down_links: ${linked} R-410A → R-32/R-454B`);

  // ============ SUPPLIER_PRODUCTS ============
  const moqOptions = [1, 5, 10, 25, 50, 100, 250];
  const sp: any[] = [];
  // Map category to preferred suppliers for realism (simple bias)
  const categorySupplierBias: Record<string, string[]> = {
    PVC: ["Charlotte Pipe","Spears Mfg","NIBCO"],
    copper: ["Mueller Industries","NIBCO"],
    PEX: ["Uponor","Viega","SharkBite","Reliance Worldwide"],
    water_heaters: ["A.O. Smith","Bradford White","Rheem","Lochinvar","State Water Heaters","Navien","Noritz","Takagi","HTP"],
    HVAC_equipment: ["Carrier","Trane","Goodman","Daikin","Mitsubishi Electric","Fujitsu","LG HVAC"],
    refrigerants: ["Honeywell","Emerson"],
    controls: ["Honeywell","Resideo","Belimo","Siemens BT","Johnson Controls","Aprilaire"],
    service_parts: ["Watts","Webstone","Cash Acme","McDonnell & Miller","Amtrol"],
    fittings: ["NIBCO","Apollo Valves","Watts","Webstone","Charlotte Pipe","Mueller Industries"],
    valves: ["Apollo Valves","Milwaukee Valve","Watts","NIBCO"],
  };
  const supplierByName: Record<string, any> = {};
  suppliers!.forEach((s) => (supplierByName[s.name] = s));

  for (const p of insertedProducts!) {
    const bias = categorySupplierBias[p.category] || [];
    const pool: any[] = [];
    for (const n of bias) if (supplierByName[n]) pool.push(supplierByName[n]);
    while (pool.length < 3) pool.push(pick(suppliers!));
    const n = ri(1, 3);
    const chosen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const s = pool[ri(0, pool.length - 1)];
      if (chosen.has(s.id)) continue;
      chosen.add(s.id);
      sp.push({
        supplier_id: s.id,
        product_id: p.id,
        supplier_sku: `${s.name.substring(0, 3).toUpperCase().replace(/\s/g, "")}-${p.sku}`,
        cost: Math.round(Number(p.unit_cost) * (0.92 + rand() * 0.13) * 100) / 100,
        moq: pick(moqOptions),
        is_primary: i === 0,
      });
    }
  }
  await chunkInsert(supabase, "supplier_products", sp, 2000);
  log.push(`supplier_products: ${sp.length}`);

  // ============ SALES HISTORY (18 months) ============
  const today = new Date();
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 18);
  const days: Date[] = [];
  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  const freezeBranches = branches!.filter((b) => b.climate_zone === "freeze_prone");
  // Pre-pick 2-4 freeze event weeks per freeze branch (winter months Dec/Jan/Feb of within range)
  const freezeWeeks: Record<string, Set<string>> = {};
  for (const b of freezeBranches) {
    freezeWeeks[b.id] = new Set();
    const winterDays = days.filter((d) => [11, 0, 1].includes(d.getMonth()));
    const numEvents = ri(2, 4);
    for (let i = 0; i < numEvents; i++) {
      const ev = winterDays[ri(0, winterDays.length - 1)];
      // 7-day window around ev
      for (let k = -3; k <= 3; k++) {
        const dd = new Date(ev); dd.setDate(dd.getDate() + k);
        freezeWeeks[b.id].add(dd.toISOString().slice(0,10));
      }
    }
  }

  // Build base lambda per product based on ABC class
  const lambdaByAbc: Record<string, () => number> = {
    A: () => 5 + rand() * 15,
    B: () => 1 + rand() * 3,
    C: () => 0.1 + rand() * 0.5,
  };

  // Generate sales rows. To keep volume tractable, only sample a subset of products per branch:
  // - All A class
  // - 60% of B
  // - 30% of C
  const branchIds = branches!.map((b) => b.id);
  const branchById: Record<string, any> = {};
  branches!.forEach((b) => (branchById[b.id] = b));

  const salesBatch: any[] = [];
  let totalSales = 0;
  const monthMul = (pat: string, m: number) => {
    if (pat === "cooling_peak") return [4,5,6,7].includes(m) ? 3 + rand() * 2 : 0.2 + rand() * 0.3;
    if (pat === "heating_peak") return [10,11,0,1].includes(m) ? 3 + rand() * 2 : 0.2 + rand() * 0.3;
    return 1;
  };

  async function flush() {
    if (salesBatch.length === 0) return;
    await chunkInsert(supabase, "sales_history", salesBatch, 2000);
    totalSales += salesBatch.length;
    salesBatch.length = 0;
  }

  for (const p of insertedProducts!) {
    for (const branchId of branchIds) {
      // Sample inclusion
      if (p.abc_class === "B" && rand() > 0.6) continue;
      if (p.abc_class === "C" && rand() > 0.3) continue;
      const isFreezeBranch = freezeWeeks[branchId] !== undefined;
      const baseLambda = lambdaByAbc[p.abc_class]();

      for (const day of days) {
        const dateStr = day.toISOString().slice(0, 10);
        let lambda = baseLambda;

        if (p.is_intermittent) {
          // Croston-style: most days zero
          if (rand() > 0.25) continue;
          const qty = ri(1, 5);
          salesBatch.push({
            branch_id: branchId, product_id: p.id, sale_date: dateStr,
            quantity: qty,
            customer_type: rand() < 0.65 ? "contractor" : rand() < 0.9 ? "walk_in" : "project",
            is_will_call: rand() < 0.4,
          });
          continue;
        }

        // Seasonality
        lambda *= monthMul(p.seasonality_pattern, day.getMonth());

        // Freeze event spike
        if (p.seasonality_pattern === "freeze_event") {
          if (!isFreezeBranch) { lambda *= 0.05; }
          else if (freezeWeeks[branchId].has(dateStr)) {
            lambda *= 5 + rand() * 5;
          } else if ([11,0,1].includes(day.getMonth())) {
            lambda *= 0.5;
          } else {
            lambda *= 0.1;
          }
        }

        const qty = poisson(lambda);
        if (qty <= 0) continue;
        salesBatch.push({
          branch_id: branchId, product_id: p.id, sale_date: dateStr,
          quantity: qty,
          customer_type: rand() < 0.65 ? "contractor" : rand() < 0.9 ? "walk_in" : "project",
          is_will_call: rand() < 0.4,
        });

        if (salesBatch.length >= 5000) await flush();
      }
    }
  }
  await flush();
  log.push(`sales_history: ${totalSales}`);

  // ============ INVENTORY LEVELS ============
  // Compute average daily demand per (branch, product) approx using base lambda — for simplicity
  // we approximate avg daily demand from product abc + seasonality (annual mean)
  const avgDaily = (abc: string, pat: string, intermittent: boolean) => {
    if (intermittent) return 0.25 * 3;
    const base = abc === "A" ? 12 : abc === "B" ? 2.5 : 0.3;
    // average seasonal multiplier ~ 1
    return base;
  };

  // Choose which products get problem states
  const allProducts = insertedProducts!;
  const shuffled = [...allProducts].sort(() => rand() - 0.5);
  const stockoutRiskProds = new Set(shuffled.slice(0, 50).map((p) => p.id));
  const stockedOutProds = new Set(shuffled.slice(50, 70).map((p) => p.id));
  const excessProds = new Set(shuffled.slice(70, 170).map((p) => p.id));

  const invRows: any[] = [];
  let problemStockoutRisk = 0, problemStockedOut = 0, problemExcess = 0;

  for (const p of allProducts) {
    for (const branchId of branchIds) {
      const dly = avgDaily(p.abc_class, p.seasonality_pattern, p.is_intermittent);
      const dosTarget = 30 + Math.floor(rand() * 60);
      const safety = Math.max(1, Math.round(dly * 7));
      const reorder = Math.max(safety + 1, Math.round(dly * 14));
      let onHand = Math.max(0, Math.round(dly * dosTarget));

      // For one branch per problem product, plant the issue
      if (stockedOutProds.has(p.id) && branchId === branchIds[0]) {
        onHand = 0; problemStockedOut++;
      } else if (stockoutRiskProds.has(p.id) && branchId === branchIds[0]) {
        onHand = Math.max(0, reorder - ri(1, Math.max(2, Math.round(reorder * 0.3))));
        if (onHand >= reorder) onHand = Math.max(0, reorder - 1);
        problemStockoutRisk++;
      } else if (excessProds.has(p.id) && branchId === branchIds[0]) {
        onHand = Math.max(1, Math.round(dly * (200 + ri(0, 100))));
        problemExcess++;
      }

      invRows.push({
        branch_id: branchId, product_id: p.id,
        on_hand: onHand,
        on_order: rand() < 0.1 ? Math.round(dly * 14) : 0,
        allocated: rand() < 0.15 ? ri(1, Math.max(1, Math.round(dly * 3))) : 0,
        safety_stock: safety,
        reorder_point: reorder,
        last_counted_at: new Date(today.getTime() - ri(1, 90) * 86400000).toISOString(),
      });
    }
  }
  await chunkInsert(supabase, "inventory_levels", invRows, 2000);
  log.push(`inventory_levels: ${invRows.length}`);
  log.push(`PLANTED — stockout_risk: ${problemStockoutRisk}, stocked_out: ${problemStockedOut}, excess: ${problemExcess}`);

  // ============ PURCHASE ORDERS ============
  const poRows: any[] = [];
  for (let i = 0; i < 30; i++) {
    const ordered = new Date(today.getTime() - ri(2, 60) * 86400000);
    const expected = new Date(ordered.getTime() + ri(7, 30) * 86400000);
    let status = pick(["pending","in_transit","received"]);
    let received: string | null = null;
    if (status === "received") received = new Date(expected.getTime() - ri(0, 5) * 86400000).toISOString().slice(0,10);
    poRows.push({
      supplier_id: pick(suppliers!).id,
      branch_id: pick(branches!).id,
      ordered_date: ordered.toISOString().slice(0,10),
      expected_date: expected.toISOString().slice(0,10),
      received_date: received,
      status,
    });
  }
  // Force 5 late
  for (let i = 0; i < 5; i++) {
    const ordered = new Date(today.getTime() - ri(40, 90) * 86400000);
    const expected = new Date(today.getTime() - ri(3, 20) * 86400000);
    poRows.push({
      supplier_id: pick(suppliers!).id,
      branch_id: pick(branches!).id,
      ordered_date: ordered.toISOString().slice(0,10),
      expected_date: expected.toISOString().slice(0,10),
      received_date: null,
      status: "late",
    });
  }
  await chunkInsert(supabase, "purchase_orders", poRows, 100);
  log.push(`purchase_orders: ${poRows.length} (5 late)`);

  // ============ CUSTOMERS ============
  const custFirst = ["Peachtree","Sunbelt","Tarheel","Desert","Lone Star","Music City","Magnolia","Carolina","Cumberland","Catalina","Smoky Mountain","Buckhead","Piedmont","Trinity","Saguaro","Mockingbird","Riverbend","Stone Mountain"];
  const custKind = ["Mechanical","Plumbing Co","HVAC Services","Builders","Property Maintenance","Construction","Service Group","Refrigeration","Heating & Air"];
  const custTypes: any[] = ["contractor","builder","service_company","walk_in"];
  const custRows: any[] = [];
  for (let i = 0; i < 200; i++) {
    custRows.push({
      name: `${pick(custFirst)} ${pick(custKind)} #${i+1}`,
      type: pick(custTypes),
      assigned_branch_id: pick(branches!).id,
    });
  }
  await chunkInsert(supabase, "customers", custRows, 500);
  log.push(`customers: ${custRows.length}`);

  // Seasonal coverage
  const seasonalCounts: Record<string, number> = {};
  for (const p of insertedProducts!) {
    seasonalCounts[p.seasonality_pattern] = (seasonalCounts[p.seasonality_pattern] || 0) + 1;
  }
  log.push(`seasonality: ${JSON.stringify(seasonalCounts)}`);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log.push(`elapsed: ${elapsed}s`);

  const summary = log.join("\n");
  console.log("=== SEED SUMMARY ===\n" + summary);

  return new Response(JSON.stringify({
    success: true,
    summary,
    health: {
      stockout_risk: problemStockoutRisk,
      stocked_out: problemStockedOut,
      excess: problemExcess,
      phase_down_links: linked,
    },
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
