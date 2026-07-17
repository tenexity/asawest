export type TourStep = {
  id: string;
  route: string | ((ctx: TourCtx) => string);
  target?: string; // css selector (data-testid preferred)
  title: string;
  body: string;
  why: string; // "why this matters for your team"
  cta?: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
};

export type TourCtx = {
  heroSkuId?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard-deadstock",
    route: "/",
    target: '[data-tour="kpi-dead-stock"]',
    title: "Start with the money you've already spent",
    body: "Dead Stock shows inventory sitting on shelves with zero demand in the last 30 days. It's capital you can recover.",
    why: "For the CFO and Controller: this is the single fastest path to freeing working capital without cutting service levels.",
    placement: "bottom",
  },
  {
    id: "skus-deadstock-filter",
    route: "/skus?filter=dead",
    target: '[data-tour="filter-dead-stock"]',
    title: "See exactly which SKUs are stuck",
    body: "One click filters to every SKU with on-hand value but no recent sales. Sort by value to attack the biggest offenders first.",
    why: "For Procurement: a concrete markdown / return-to-vendor / transfer list — not a vague 'reduce inventory' directive.",
    placement: "right",
  },
  {
    id: "sku-detail-forecast",
    route: (ctx) => (ctx.heroSkuId ? `/skus/${ctx.heroSkuId}` : "/skus"),
    target: '[data-tour="forecast-tournament"]',
    title: "Four forecast models compete on every SKU",
    body: "Naive, moving average, exponential smoothing, and seasonal — the winner is chosen per-SKU with a confidence band and a plain-English reason.",
    why: "For the Buyer: no more guessing from a spreadsheet. The math is transparent and you can override it.",
    placement: "top",
  },
  {
    id: "reorder-recs",
    route: "/reorder",
    target: '[data-tour="reorder-table"]',
    title: "Reorder suggestions the buyer can actually act on",
    body: "Every row is seasonality-boosted, rebate-aware, and shows the exact math behind the quantity — lead time, safety stock, and supplier minimums included.",
    why: "For Procurement: fewer emergency POs, better rebate capture, less time in spreadsheets.",
    placement: "top",
  },
  {
    id: "network-graph",
    route: "/network",
    target: '[data-tour="network-canvas"]',
    title: "Your whole supply chain in one picture",
    body: "Suppliers → categories → branches → customer types, sized by 90-day flow-through. Filter to any category to see who really matters.",
    why: "For VP Ops: see concentration risk (one supplier = 40% of copper flow) before it becomes a fire drill.",
    placement: "bottom",
  },
  {
    id: "disruption-sim",
    route: "/network",
    target: '[data-tour="disruption-simulator"]',
    title: "Simulate the disruption before it hits",
    body: "Pick a supplier, set a delay, and see the exact SKUs at risk, days-until-empty, units short, and revenue exposure — branch by branch.",
    why: "For VP Ops + Procurement: turn a rumor ('Mueller might slip 2 weeks') into a decision ('transfer 40 elbows from Phoenix to Houston today').",
    placement: "top",
  },
  {
    id: "agents",
    route: "/agents",
    target: '[data-tour="agents-panel"]',
    title: "The system proposes, you approve, everything is logged",
    body: "Sense finds the issues, Decide drafts the fix in plain English, Approve creates the PO or transfer in draft — with a full audit trail.",
    why: "For VP Ops: institutional memory. No more 'why did we do that transfer last April?' every quarter.",
    placement: "top",
  },
  {
    id: "chat",
    route: "/chat",
    target: '[data-tour="chat-input"]',
    title: "Ask any question, get the SQL that answered it",
    body: "Anyone on the team can ask — 'which PEX fittings are excess in Phoenix but at-risk in Houston?' — and see the answer plus the query that produced it.",
    why: "For the whole team: unblock decisions without waiting on a data analyst.",
    placement: "top",
  },
];
