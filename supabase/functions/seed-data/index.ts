// Stage-based seeder. Call multiple times with ?stage=...
// Stages:
//   core    — branches, suppliers, products (+ phase-down links), supplier_products,
//             inventory_levels, purchase_orders, customers
//   sales   — generates sales_history for a slice of products. Pass offset & limit.
//   summary — returns row counts + planted-problem totals
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rand: () => number, lambda: number) {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // normal approx
    const u1 = rand() || 1e-9, u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
  }
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

  const url = new URL(req.url);
  const stage = url.searchParams.get("stage") || "core";
  const startedAt = Date.now();

  try {
    if (stage === "core") return await runCore(supabase, startedAt);
    if (stage === "sales") {
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = parseInt(url.searchParams.get("limit") || "500", 10);
      return await runSales(supabase, offset, limit, startedAt);
    }
    if (stage === "summary") return await runSummary(supabase);
    return new Response(JSON.stringify({ error: "unknown stage" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runCore(supabase: any, startedAt: number) {
  const rand = mulberry32(20260506);
  const ri = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const log: string[] = [];

  // BRANCHES
  const branchSeed = [
    { name: "Atlanta Distribution Center", city: "Atlanta", state: "GA", climate_zone: "freeze_prone", opened_date: "1992-04-15" },
    { name: "Charlotte Branch",            city: "Charlotte", state: "NC", climate_zone: "temperate",    opened_date: "1998-09-01" },
    { name: "Phoenix Desert Hub",          city: "Phoenix",  state: "AZ", climate_zone: "hot",           opened_date: "2005-06-20" },
    { name: "Dallas Metroplex Center",     city: "Dallas",   state: "TX", climate_zone: "freeze_prone",  opened_date: "1988-02-10" },
    { name: "Nashville Branch",            city: "Nashville",state: "TN", climate_zone: "freeze_prone",  opened_date: "2010-11-05" },
  ];
  const { data: branches } = await supabase.from("branches").insert(branchSeed).select().throwOnError();
  log.push(`branches: ${branches.length}`);

  // SUPPLIERS
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
  const { data: suppliers } = await supabase.from("suppliers").insert(supplierRows).select().throwOnError();
  log.push(`suppliers: ${suppliers.length}`);

  // PRODUCTS
  type ProdSpec = {
    sku: string; description: string; category: string; subcategory: string;
    unit_of_measure: string; unit_cost: number;
    seasonality_pattern: string; is_intermittent: boolean; is_phase_down: boolean;
  };
  const products: ProdSpec[] = [];
  const sizes = ["1/2","3/4","1","1-1/4","1-1/2","2","2-1/2","3","4","6"];
  const angles = ["90L","45L","T","C","CAP","RED","UN"];
  const fittingMaterials = ["PVC","CPVC","CU","BRASS","PEX","BLK"];
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
  const schedules = ["40","80","DWV"];
  for (let i = 0; i < 1500; i++) {
    const sz = pick(sizes), sch = pick(schedules), len = pick(["10","20"]);
    products.push({
      sku: `PVC-${sch}-${sz}-${len}-${i}`,
      description: `${sz}" Sch ${sch} PVC Pipe ${len}'`,
      category: "PVC", subcategory: `Sch${sch}`, unit_of_measure: "EA",
      unit_cost: Math.round((3 + rand() * 90) * 100) / 100,
      seasonality_pattern: "none", is_intermittent: false, is_phase_down: false,
    });
  }
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
  const pexLengths = ["100","300","500"];
  const pexColors: [string,string][] = [["R","Red"],["B","Blue"],["W","White"]];
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
  for (let i = 0; i < 500; i++) {
    const lbs = pick([10,25,50,100]);
    const types = ["410A","32","454B","134a","404A","407C"];
    const t = pick(types);
    const phaseDown = t === "410A" || t === "404A";
    products.push({
      sku: `RFG-${t}-${lbs}-${i}`,
      description: `R-${t} Refrigerant ${lbs}lb Cylinder`,
      category: "refrigerants", subcategory: t, unit_of_measure: "CYL",
      unit_cost: Math.round((90 + rand() * 700) * 100) / 100,
      seasonality_pattern: "cooling_peak", is_intermittent: false, is_phase_down: phaseDown,
    });
  }
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

  const productRows = products.map((p) => {
    const r = rand();
    const abc = r < 0.2 ? "A" : r < 0.5 ? "B" : "C";
    const r2 = rand();
    const xyz = r2 < 0.3 ? "X" : r2 < 0.7 ? "Y" : "Z";
    const margin = 1.18 + rand() * 0.27;
    return {
      sku: p.sku, description: p.description, category: p.category, subcategory: p.subcategory,
      unit_of_measure: p.unit_of_measure, unit_cost: p.unit_cost,
      unit_price: Math.round(p.unit_cost * margin * 100) / 100,
      abc_class: abc, xyz_class: xyz,
      is_intermittent: p.is_intermittent, seasonality_pattern: p.seasonality_pattern,
      is_phase_down: p.is_phase_down,
    };
  });
  await chunkInsert(supabase, "products", productRows, 1000);

  const insertedProducts: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data: page } = await supabase
      .from("products")
      .select("id, sku, category, subcategory, abc_class, seasonality_pattern, is_phase_down, is_intermittent, unit_cost")
      .order("sku").range(off, off + 999).throwOnError();
    if (!page || page.length === 0) break;
    insertedProducts.push(...page);
    if (page.length < 1000) break;
  }
  log.push(`products: ${insertedProducts.length}`);

  // Phase-down links
  const subs = insertedProducts.filter((p: any) =>
    p.category === "refrigerants" && (p.subcategory === "32" || p.subcategory === "454B")
  );
  const phaseDownProds = insertedProducts.filter((p: any) => p.is_phase_down && p.subcategory === "410A");
  let linked = 0;
  if (subs.length > 0) {
    for (let i = 0; i < phaseDownProds.length; i += 50) {
      const slice = phaseDownProds.slice(i, i + 50);
      await Promise.all(slice.map((p: any) =>
        supabase.from("products").update({ substitute_product_id: subs[Math.floor(rand() * subs.length)].id }).eq("id", p.id)
      ));
      linked += slice.length;
    }
  }
  log.push(`phase_down_links: ${linked}`);

  // SUPPLIER_PRODUCTS
  const moqOptions = [1, 5, 10, 25, 50, 100, 250];
  const categorySupplierBias: Record<string, string[]> = {
    PVC: ["Charlotte Pipe","Spears Mfg","Oatey"],
    copper: ["Mueller Industries","NIBCO"],
    PEX: ["Uponor","Viega","SharkBite","Reliance Worldwide","Cash Acme"],
    water_heaters: ["A.O. Smith","Bradford White","Rheem","Lochinvar","State Water Heaters","Navien","Noritz","Takagi","HTP"],
    HVAC_equipment: ["Carrier","Trane","Goodman","Daikin","Mitsubishi Electric","Fujitsu","LG HVAC"],
    refrigerants: ["Honeywell","Emerson","RectorSeal"],
    controls: ["Resideo","Belimo","Siemens BT","Johnson Controls","Aprilaire"],
    service_parts: ["Watts","Webstone","McDonnell & Miller","Amtrol","Taco","Grundfos","Burnham","Weil-McLain"],
    fittings: ["Apollo Valves","Fernco","Zurn","Jay R. Smith","Caleffi"],
    valves: ["Milwaukee Valve","Sloan","Wilkins"],
  };
  const supplierByName: Record<string, any> = {};
  suppliers.forEach((s: any) => (supplierByName[s.name] = s));

  const sp: any[] = [];
  for (const p of insertedProducts) {
    const pool = (categorySupplierBias[p.category] || [])
      .map((n) => supplierByName[n])
      .filter(Boolean);
    if (pool.length === 0) throw new Error(`No supplier pool for ${p.category}`);
    const s = pool[ri(0, pool.length - 1)];
      sp.push({
        supplier_id: s.id, product_id: p.id,
        supplier_sku: `${s.name.substring(0, 3).toUpperCase().replace(/\s/g, "")}-${p.sku}`,
        cost: Math.round(Number(p.unit_cost) * (0.92 + rand() * 0.13) * 100) / 100,
        moq: pick(moqOptions), is_primary: true,
      });
  }
  await chunkInsert(supabase, "supplier_products", sp, 2000);
  log.push(`supplier_products: ${sp.length}`);

  // INVENTORY (50k rows)
  const branchIds = branches.map((b: any) => b.id);
  const avgDaily = (abc: string, intermittent: boolean) => {
    if (intermittent) return 0.7;
    return abc === "A" ? 12 : abc === "B" ? 2.5 : 0.3;
  };
  const shuffled = [...insertedProducts].sort(() => rand() - 0.5);
  const stockoutRiskProds = new Set(shuffled.slice(0, 50).map((p: any) => p.id));
  const stockedOutProds = new Set(shuffled.slice(50, 70).map((p: any) => p.id));
  const excessProds = new Set(shuffled.slice(70, 170).map((p: any) => p.id));
  // Cross-branch imbalance: same SKU is EXCESS at branch[1] AND AT-RISK at branch[2].
  // This is the canonical "rebalance opportunity" pattern that drives the
  // /ask chat scenario "which SKUs are excess at X but at risk at Y".
  const imbalanceProds = new Set(shuffled.slice(170, 320).map((p: any) => p.id));
  // Pure at-risk (low stock at branch[0], healthy elsewhere)
  const atRiskProds = new Set(shuffled.slice(320, 420).map((p: any) => p.id));
  const today = new Date();
  const invRows: any[] = [];
  let problemStockoutRisk = 0, problemStockedOut = 0, problemExcess = 0, problemAtRisk = 0, problemImbalance = 0;
  for (const p of insertedProducts) {
    for (let bi = 0; bi < branchIds.length; bi++) {
      const branchId = branchIds[bi];
      const dly = avgDaily(p.abc_class, p.is_intermittent);
      const dosTarget = 30 + Math.floor(rand() * 60);
      const safety = Math.max(3, Math.round(dly * 7));
      const reorder = Math.max(safety + 1, Math.round(dly * 14));
      let onHand = Math.max(0, Math.round(dly * dosTarget));
      const isPlantedHere =
        ((stockedOutProds.has(p.id) || stockoutRiskProds.has(p.id) || excessProds.has(p.id) || atRiskProds.has(p.id)) && bi === 0)
        || (imbalanceProds.has(p.id) && (bi === 1 || bi === 2));
      if (!isPlantedHere) {
        onHand = Math.max(onHand, reorder + 1, Math.round(dly * 30), 5);
      }
      if (stockedOutProds.has(p.id) && bi === 0) {
        onHand = 0; problemStockedOut++;
      } else if (stockoutRiskProds.has(p.id) && bi === 0) {
        // Below safety stock but not zero (true at-risk)
        onHand = Math.max(1, safety - ri(1, Math.max(1, Math.floor(safety * 0.5))));
        problemStockoutRisk++;
      } else if (atRiskProds.has(p.id) && bi === 0) {
        onHand = Math.max(1, safety - ri(1, Math.max(1, Math.floor(safety * 0.6))));
        problemAtRisk++;
      } else if (excessProds.has(p.id) && bi === 0) {
        onHand = Math.max(1, Math.round(dly * (200 + ri(0, 100))));
        problemExcess++;
      } else if (imbalanceProds.has(p.id) && bi === 1) {
        // EXCESS at branch[1]
        onHand = Math.max(safety * 8, Math.round(dly * (180 + ri(0, 80))));
        problemImbalance++;
      } else if (imbalanceProds.has(p.id) && bi === 2) {
        // AT-RISK at branch[2] (same SKU)
        onHand = Math.max(1, safety - ri(1, Math.max(1, Math.floor(safety * 0.6))));
      } else if (rand() < 0.05) {
        // Random sprinkle of shortfalls across the network so fill rate
        // lands in a realistic 92-95% range instead of a perfect 100%.
        // Mix of below-safety (true at-risk) and zero on_hand (stockout).
        if (rand() < 0.25) onHand = 0;
        else onHand = Math.max(1, safety - ri(1, Math.max(1, Math.floor(safety * 0.7))));
      }
      invRows.push({
        branch_id: branchId, product_id: p.id, on_hand: onHand,
        on_order: rand() < 0.1 ? Math.round(dly * 14) : 0,
        allocated: rand() < 0.15 ? ri(1, Math.max(1, Math.round(dly * 3))) : 0,
        safety_stock: safety, reorder_point: reorder,
        last_counted_at: new Date(today.getTime() - ri(1, 90) * 86400000).toISOString(),
      });
    }
  }
  await chunkInsert(supabase, "inventory_levels", invRows, 2000);
  log.push(`inventory_levels: ${invRows.length}  PLANTED — risk:${problemStockoutRisk} out:${problemStockedOut} excess:${problemExcess} atRisk:${problemAtRisk} imbalance:${problemImbalance}`);


  // POs
  const poRows: any[] = [];
  for (let i = 0; i < 30; i++) {
    const ordered = new Date(today.getTime() - ri(2, 60) * 86400000);
    const expected = new Date(ordered.getTime() + ri(7, 30) * 86400000);
    let status = pick(["pending","in_transit","received"] as const);
    let received: string | null = null;
    if (status === "received") received = new Date(expected.getTime() - ri(0, 5) * 86400000).toISOString().slice(0,10);
    poRows.push({
      supplier_id: suppliers[Math.floor(rand() * suppliers.length)].id,
      branch_id: branches[Math.floor(rand() * branches.length)].id,
      ordered_date: ordered.toISOString().slice(0,10),
      expected_date: expected.toISOString().slice(0,10),
      received_date: received, status,
    });
  }
  for (let i = 0; i < 5; i++) {
    const ordered = new Date(today.getTime() - ri(40, 90) * 86400000);
    const expected = new Date(today.getTime() - ri(3, 20) * 86400000);
    poRows.push({
      supplier_id: suppliers[Math.floor(rand() * suppliers.length)].id,
      branch_id: branches[Math.floor(rand() * branches.length)].id,
      ordered_date: ordered.toISOString().slice(0,10),
      expected_date: expected.toISOString().slice(0,10),
      received_date: null, status: "late",
    });
  }
  await chunkInsert(supabase, "purchase_orders", poRows, 100);
  log.push(`purchase_orders: ${poRows.length}`);

  // CUSTOMERS
  const custFirst = ["Peachtree","Sunbelt","Tarheel","Desert","Lone Star","Music City","Magnolia","Carolina","Cumberland","Catalina","Smoky Mountain","Buckhead","Piedmont","Trinity","Saguaro","Mockingbird","Riverbend","Stone Mountain"];
  const custKind = ["Mechanical","Plumbing Co","HVAC Services","Builders","Property Maintenance","Construction","Service Group","Refrigeration","Heating & Air"];
  const custTypes = ["contractor","builder","service_company","walk_in"] as const;
  const custRows: any[] = [];
  for (let i = 0; i < 200; i++) {
    custRows.push({
      name: `${pick(custFirst)} ${pick(custKind)} #${i+1}`,
      type: pick(custTypes),
      assigned_branch_id: branches[Math.floor(rand() * branches.length)].id,
    });
  }
  await chunkInsert(supabase, "customers", custRows, 500);
  log.push(`customers: ${custRows.length}`);

  log.push(`elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  const summary = log.join("\n");
  console.log("=== CORE STAGE ===\n" + summary);
  return new Response(JSON.stringify({ success: true, summary }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function runSales(supabase: any, offset: number, limit: number, startedAt: number) {
  // Fetch product slice ordered by id (uuid) so the slice spans all categories
  // instead of the alphabetical bias of SKU-prefixed pagination (which trapped
  // the first ~200 rows entirely in the `fittings` category).
  const { data: products } = await supabase.from("products")
    .select("id, abc_class, seasonality_pattern, is_intermittent")
    .order("id")
    .range(offset, offset + limit - 1)
    .throwOnError();
  const { data: branches } = await supabase.from("branches").select("id, climate_zone").throwOnError();

  const today = new Date();
  // 120-day window: covers the 90-day COGS metrics and the 30-day DoS
  // calculation, while keeping insert volume tractable when seeding all
  // 10k products. (Was 18 months — too heavy for full-catalog seeding.)
  const startDate = new Date(today); startDate.setDate(startDate.getDate() - 120);
  const days: Date[] = [];
  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) days.push(new Date(d));

  // Use a per-stage RNG, deterministic by offset
  const rand = mulberry32(20260506 + offset);
  const ri = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;

  const freezeBranches = branches.filter((b: any) => b.climate_zone === "freeze_prone");
  const freezeWeeks: Record<string, Set<string>> = {};
  for (const b of freezeBranches) {
    freezeWeeks[b.id] = new Set();
    const winter = days.filter((d) => [11, 0, 1].includes(d.getMonth()));
    const events = ri(2, 4);
    for (let i = 0; i < events; i++) {
      const ev = winter[ri(0, winter.length - 1)];
      for (let k = -3; k <= 3; k++) {
        const dd = new Date(ev); dd.setDate(dd.getDate() + k);
        freezeWeeks[b.id].add(dd.toISOString().slice(0, 10));
      }
    }
  }

  const lambdaByAbc: Record<string, () => number> = {
    A: () => 5 + rand() * 15, B: () => 1 + rand() * 3, C: () => 0.1 + rand() * 0.5,
  };
  // Smooth seasonal multiplier using a sinusoid centered on each pattern's peak month.
  // Avoids the hard month-boundary step the old version produced.
  const seasonMul = (pat: string, m: number) => {
    if (pat === "none") return 1;
    // peak month index (0-11) and amplitude
    const peak = pat === "cooling_peak" ? 6 /* July */
               : pat === "heating_peak" ? 0 /* January */
               : pat === "freeze_event" ? 0 /* January */
               : 6;
    // distance in months around the year (0..6)
    const d = Math.min(Math.abs(m - peak), 12 - Math.abs(m - peak));
    // cos curve: 1.0 at far side, peaks at ~3.0x at peak month
    const factor = 1 + 1.0 * Math.cos((d / 6) * Math.PI); // 0..2
    // cooling/heating need stronger swing
    if (pat === "cooling_peak" || pat === "heating_peak") return 0.3 + factor * 1.4; // 0.3..3.1
    return 0.5 + factor * 0.75; // milder
  };
  // B2B distributor: heavy weekday demand, light weekends.
  const dowMul = (dow: number) => {
    if (dow === 0) return 0.08;       // Sun
    if (dow === 6) return 0.35;       // Sat
    if (dow === 1 || dow === 4) return 1.05; // Mon/Thu slightly heavier
    return 1.0;
  };

  const branchIds = branches.map((b: any) => b.id);
  let inserted = 0;
  let buffer: any[] = [];
  const flush = async () => {
    if (!buffer.length) return;
    await chunkInsert(supabase, "sales_history", buffer, 2000);
    inserted += buffer.length;
    buffer = [];
  };

  for (const p of products) {
    for (const branchId of branchIds) {
      if (p.abc_class === "B" && rand() > 0.6) continue;
      if (p.abc_class === "C" && rand() > 0.3) continue;
      const isFreezeBranch = freezeWeeks[branchId] !== undefined;
      const baseLambda = lambdaByAbc[p.abc_class]();
      for (const day of days) {
        if (p.is_intermittent) {
          const intermittentP = 0.25 * dowMul(day.getDay());
          if (rand() > intermittentP) continue;
          buffer.push({
            branch_id: branchId, product_id: p.id, sale_date: day.toISOString().slice(0,10),
            quantity: ri(1, 5),
            customer_type: rand() < 0.65 ? "contractor" : rand() < 0.9 ? "walk_in" : "project",
            is_will_call: rand() < 0.4,
          });
          if (buffer.length >= 4000) await flush();
          continue;
        }
        let lambda = baseLambda * seasonMul(p.seasonality_pattern, day.getMonth()) * dowMul(day.getDay());
        // Per-day noise so the line isn't a perfectly smooth ribbon
        lambda *= 0.85 + rand() * 0.3;
        if (p.seasonality_pattern === "freeze_event") {
          const dateStr = day.toISOString().slice(0,10);
          if (!isFreezeBranch) lambda *= 0.05;
          else if (freezeWeeks[branchId].has(dateStr)) lambda *= 5 + rand() * 5;
          else if ([11,0,1].includes(day.getMonth())) lambda *= 0.5;
          else lambda *= 0.1;
        }
        const qty = poisson(rand, lambda);
        if (qty <= 0) continue;
        buffer.push({
          branch_id: branchId, product_id: p.id, sale_date: day.toISOString().slice(0,10),
          quantity: qty,
          customer_type: rand() < 0.65 ? "contractor" : rand() < 0.9 ? "walk_in" : "project",
          is_will_call: rand() < 0.4,
        });
        if (buffer.length >= 4000) await flush();
      }
    }
  }
  await flush();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`SALES offset=${offset} limit=${limit} inserted=${inserted} elapsed=${elapsed}s`);
  return new Response(JSON.stringify({
    success: true, offset, limit, products_processed: products.length, sales_inserted: inserted, elapsed,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function runSummary(supabase: any) {
  const tables = ["branches","suppliers","products","supplier_products","inventory_levels","sales_history","purchase_orders","customers"];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
    counts[t] = count || 0;
  }
  const { count: stockoutRisk } = await supabase
    .from("inventory_levels").select("*", { count: "exact", head: true })
    .lt("on_hand", 1).gt("reorder_point", 0);
  // Better approach: count rows where on_hand < reorder_point AND on_hand > 0
  const { data: invStats } = await supabase.rpc as any;
  // Compute via SQL view-less method using two queries
  const { count: stockedOut } = await supabase
    .from("inventory_levels").select("*", { count: "exact", head: true }).eq("on_hand", 0);
  // For risk and excess we use the planted counts via heuristic queries
  const { data: riskRows } = await supabase
    .from("inventory_levels").select("on_hand, reorder_point").gt("on_hand", 0).lte("on_hand", 200);
  let risk = 0;
  if (riskRows) for (const r of riskRows) if (r.on_hand < r.reorder_point) risk++;

  const { count: phaseDownLinked } = await supabase
    .from("products").select("*", { count: "exact", head: true })
    .eq("is_phase_down", true).not("substitute_product_id", "is", null);

  const summary =
    `Row counts: ${JSON.stringify(counts)}\n` +
    `Inventory health — stockout risk: ${risk}, stocked out: ${stockedOut}, ` +
    `(excess detection requires demand calc)\n` +
    `Phase-down links: ${phaseDownLinked} R-410A SKUs linked to substitutes`;
  console.log("=== SUMMARY ===\n" + summary);
  return new Response(JSON.stringify({ counts, stockedOut, stockoutRisk: risk, phaseDownLinked, summary }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
