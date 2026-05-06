// Describes what the "Approve" button will actually do for each insight type.
// Used by ApproveConfirmDialog to give users a clear preview before execution.

export type ActionStep = {
  label: string;
  detail?: string;
  system: "Database" | "Inventory" | "Procurement" | "Notifications" | "Audit";
};

export type ActionPlan = {
  title: string;
  summary: string;
  steps: ActionStep[];
  reversible: string;
  notifications: string;
};

function fmtBranch(ev: any, key: string, fallback = "branch") {
  return ev?.[key] ?? fallback;
}

export function buildActionPlan(insight: any): ActionPlan {
  const a = insight?.recommended_action_json ?? {};
  const ev = insight?.evidence_json ?? {};
  const sku = ev.sku ?? "SKU";

  switch (insight?.type) {
    case "stockout_risk": {
      const qty = a.quantity ?? 50;
      return {
        title: "Create draft purchase order",
        summary: `Generates a draft PO for ${qty} units of ${sku} at ${fmtBranch(ev, "branch")} to prevent the projected stockout.`,
        steps: [
          { system: "Procurement", label: "Look up primary supplier", detail: "Finds the primary supplier for this SKU (falls back to any supplier if none flagged primary)." },
          { system: "Procurement", label: "Insert a new purchase_order row", detail: `status = "draft", expected delivery ~7 days out.` },
          { system: "Procurement", label: "Add a PO line item", detail: `${qty} units @ supplier cost.` },
          { system: "Database", label: "Mark insight as executed", detail: "status → executed, resolved_at → now()." },
          { system: "Audit", label: "Write entry to action_audit_log", detail: "Captures who approved, financial impact, and the full payload." },
        ],
        reversible: "The PO is created in DRAFT status — no order is placed with the supplier and no email is sent. A buyer must review and submit it from the procurement system.",
        notifications: "None. No email, EDI, or supplier notification is triggered automatically.",
      };
    }
    case "inter_branch_transfer": {
      const qty = a.quantity ?? ev.quantity ?? 0;
      return {
        title: "Create inter-branch transfer order",
        summary: `Moves ${qty} units of ${sku} from ${ev.source_branch ?? "source"} → ${ev.dest_branch ?? "destination"}.`,
        steps: [
          { system: "Inventory", label: "Insert a transfer_orders row", detail: `status = "pending", expected arrival ${ev.expected_arrival ?? "TBD"}.` },
          { system: "Database", label: "Mark insight as executed", detail: "status → executed, resolved_at → now()." },
          { system: "Audit", label: "Write entry to action_audit_log" },
        ],
        reversible: "Transfer is created in PENDING status. Warehouse staff must confirm pick & ship before stock actually moves.",
        notifications: "None automatically. Warehouse picks it up from the pending transfer queue.",
      };
    }
    case "excess_inventory": {
      const qty = a.excess_qty ?? ev.excess_qty ?? 0;
      return {
        title: "Flag as markdown candidate",
        summary: `Adds ${qty} units of ${sku} at ${fmtBranch(ev, "branch")} to the markdown review queue.`,
        steps: [
          { system: "Inventory", label: "Insert a markdown_candidates row", detail: `Estimated value ≈ $${Math.round(insight.financial_impact_usd ?? 0).toLocaleString()}.` },
          { system: "Database", label: "Mark insight as executed" },
          { system: "Audit", label: "Write entry to action_audit_log" },
        ],
        reversible: "Nothing is discounted or moved. A merchandiser must approve the markdown plan separately.",
        notifications: "None.",
      };
    }
    case "rebate_opportunity": {
      return {
        title: "Bump open PO to hit rebate threshold",
        summary: `Increases the first line item on PO ${String(ev.po_id ?? "").slice(0, 8)} by 15% so total spend crosses the rebate tier.`,
        steps: [
          { system: "Procurement", label: "Find first line item on the PO" },
          { system: "Procurement", label: "Update purchase_order_items.quantity", detail: "New qty = ceil(current × 1.15)." },
          { system: "Database", label: "Mark insight as executed" },
          { system: "Audit", label: "Write entry to action_audit_log" },
        ],
        reversible: "Only modifies an existing draft/pending PO. The PO still must be approved & sent to the supplier.",
        notifications: "None.",
      };
    }
    case "substitution_opportunity": {
      return {
        title: "Promote substitute SKU",
        summary: `Marks the substitute as the recommended replacement for ${sku} across pricing & ordering screens.`,
        steps: [
          { system: "Database", label: "Save the substitute pairing", detail: "Records the original SKU and its recommended substitute so it appears in pricing & ordering screens." },
          { system: "Database", label: "Mark insight as executed" },
          { system: "Audit", label: "Write entry to action_audit_log" },
        ],
        reversible: "Cosmetic & advisory — appears as a suggestion in sales/ordering UI. No prices, orders, or inventory are changed.",
        notifications: "None.",
      };
    }
    case "supplier_delay_impact": {
      return {
        title: "Acknowledge supplier delay",
        summary: "Closes this insight as acknowledged. Affected SKUs will surface separately as their own stockout/transfer recommendations.",
        steps: [
          { system: "Database", label: "Mark insight as executed (acknowledged)" },
          { system: "Audit", label: "Write entry to action_audit_log" },
        ],
        reversible: "No operational change. Purely an audit acknowledgement.",
        notifications: "None.",
      };
    }
    default:
      return {
        title: "Execute recommended action",
        summary: "Runs the recommended action for this insight.",
        steps: [
          { system: "Database", label: "Mark insight as executed" },
          { system: "Audit", label: "Write entry to action_audit_log" },
        ],
        reversible: "Acknowledgement only.",
        notifications: "None.",
      };
  }
}
