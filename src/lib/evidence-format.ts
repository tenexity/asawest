// Humanize evidence_json into readable label/value pairs.
const LABELS: Record<string, string> = {
  sku: "SKU",
  product_name: "Product",
  product: "Product",
  branch: "Branch",
  branch_name: "Branch",
  source_branch: "From branch",
  dest_branch: "To branch",
  source_dos: "Source days of supply",
  dest_stockout_in_days: "Destination stockout in",
  on_hand: "On hand",
  on_order: "On order",
  safety_stock: "Safety stock",
  reorder_point: "Reorder point",
  avg_daily_demand: "Avg daily demand",
  days_to_stockout: "Days to stockout",
  units_short: "Units short",
  quantity: "Quantity",
  excess_qty: "Excess units",
  unit_price: "Unit price",
  unit_cost: "Unit cost",
  transfer_cost: "Transfer cost",
  expected_arrival: "Expected arrival",
  supplier: "Supplier",
  supplier_name: "Supplier",
  lead_time_days: "Lead time (days)",
  rebate_threshold: "Rebate threshold",
  current_qty: "Current quantity",
  bumped_qty: "Bumped quantity",
  substitute_sku: "Substitute SKU",
  substitute_name: "Substitute product",
  category: "Category",
  po_id: "PO #",
};

const HIDE = new Set(["product_id", "branch_id", "supplier_id", "substitute_id", "source_branch_id", "dest_branch_id"]);

export type EvidenceRow = { label: string; value: string };

function fmtNum(n: number) {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}

function fmtVal(k: string, v: any): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (/(price|cost|value|impact)/i.test(k)) return `$${fmtNum(v)}`;
    if (/days/i.test(k)) return `${fmtNum(v)} days`;
    return fmtNum(v);
  }
  if (typeof v === "string" && k === "po_id") return v.slice(0, 8) + "…";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function humanizeEvidence(ev: any): EvidenceRow[] {
  if (!ev || typeof ev !== "object") return [];
  return Object.entries(ev)
    .filter(([k, v]) => !HIDE.has(k) && v !== null && v !== "")
    .map(([k, v]) => ({
      label: LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      value: fmtVal(k, v),
    }));
}
