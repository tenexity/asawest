export type TourStep = {
  id: string;
  group: number; // major step number (1..N). Multiple entries share a group.
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
  // ── 0. Welcome ──────────────────────────────────────────────────
  {
    id: "welcome",
    group: 1,
    route: "/",
    title: "Welcome — you're in control of this tour",
    body: "You can exit this tour at any time by pressing Esc or clicking Skip. When you come back, the red button in the sidebar will read \"Resume tour\" and drop you right back where you left off. Feel free to click around between steps — nothing here is destructive.",
    why: "Take your time. The tour is a guide, not a rail — explore any screen as deeply as you want and pick the tour back up whenever you're ready.",
    placement: "center",
  },

  // ── 1. Dashboard ────────────────────────────────────────────────
  {

    id: "dashboard-deadstock",
    group: 1,
    route: "/",
    target: '[data-tour="kpi-dead-stock"]',
    title: "Start with the money you've already spent",
    body: "Dead Stock shows inventory sitting on shelves with zero demand in the last 90 days. It's capital you can recover.",
    why: "For the CFO and Controller: the fastest path to freeing working capital without cutting service levels.",
    placement: "bottom",
  },
  {
    id: "dashboard-branch-compare",
    group: 1,
    route: "/",
    target: '[data-tour="branch-comparison"]',
    title: "Compare every branch on one line",
    body: "Fill rate, stockouts, excess SKUs, inventory value, and days of supply — side by side. Outliers jump out immediately. Later in the tour we'll show you how to rebalance inventory across branches so every location lands at optimal levels.",
    why: "For the VP of Ops: know which branch to visit this week without opening five reports.",
    placement: "top",
  },

  // ── 2. SKUs page ────────────────────────────────────────────────
  {
    id: "skus-deadstock-filter",
    group: 2,
    route: "/skus?filter=dead",
    target: '[data-tour="filter-dead-stock"]',
    title: "See exactly which SKUs are stuck",
    body: "One click filters to every SKU with on-hand value but no recent sales. Sort by value to attack the biggest offenders first.",
    why: "For Procurement: a concrete markdown / return-to-vendor / transfer list — not a vague 'reduce inventory' directive.",
    placement: "right",
  },
  {
    id: "skus-drill-in",
    group: 2,
    route: "/skus?filter=dead",
    target: '[data-tour="sku-table"]',
    title: "Click any SKU to go deeper",
    body: "Each row opens the SKU detail page — full demand history, forecast, inventory-by-branch, and supplier options.",
    why: "For the Buyer: one click from a problem list to the evidence you need to act.",
    placement: "top",
  },

  // ── 3. SKU detail: forecast tournament ──────────────────────────
  {
    id: "sku-detail-forecast",
    group: 3,
    route: (ctx) => (ctx.heroSkuId ? `/skus/${ctx.heroSkuId}` : "/skus"),
    target: '[data-tour="forecast-tournament"]',
    title: "Four forecast models compete on every SKU",
    body: "Moving average, exponential smoothing, and Croston compete on recent history. The most accurate one wins for this SKU.",
    why: "For the Buyer: no more guessing from a spreadsheet. The math is transparent and you can override it.",
    placement: "left",
  },
  {
    id: "sku-detail-explain",
    group: 3,
    route: (ctx) => (ctx.heroSkuId ? `/skus/${ctx.heroSkuId}` : "/skus"),
    target: '[data-tour="explain-btn"]',
    title: "Click 'Generate explanation' — try it now",
    body: "The AI reads this SKU's actual pattern and returns a 3-bullet brief: what the demand looks like, why the winning model fits, and what you should do about it. Click the button before hitting Next.",
    why: "For the whole team: turns statistics into a plain-English decision. A new buyer can act confidently on day one.",
    placement: "left",
  },

  // ── 4. Reorder recommendations ──────────────────────────────────
  {
    id: "reorder-recs",
    group: 4,
    route: "/reorder",
    target: '[data-tour="reorder-table"]',
    title: "Reorder suggestions the buyer can actually act on",
    body: "Every row is seasonality-boosted, rebate-aware, and shows the exact math behind the quantity — lead time, safety stock, and supplier minimums included.",
    why: "For Procurement: fewer emergency POs, better rebate capture, less time in spreadsheets.",
    placement: "top",
  },
  {
    id: "reorder-why",
    group: 4,
    route: "/reorder",
    target: '[data-tour="reorder-table"]',
    title: "Expand any row to see the reasoning",
    body: "Click a row to see the calculation: avg daily demand, lead-time cover, safety stock formula, MOQ bump, and rebate-threshold logic. Nothing is a black box.",
    why: "For the buyer's manager: every recommendation is defensible in a supplier conversation.",
    placement: "bottom",
  },
  {
    id: "reorder-why-modal",
    group: 4,
    route: "/reorder",
    target: '[data-tour="reorder-why-btn"]',
    title: "Click 'Why' — open the full calculation",
    body: "The Why modal is the single most valuable screen for a buyer: avg daily demand, standard deviation, recent max day, lead time ± variability, service-level z-score, safety stock, reorder point, on-hand vs on-order, days of supply, MOQ, plus any seasonality boost or rebate-threshold bump — all in one place. Click Why on the first row to see it now, then hit Next.",
    why: "For the buyer and their manager: this is the audit trail most ERPs never expose. Every number that drove the suggested quantity is visible and defensible in a supplier conversation or an internal review.",
    placement: "left",
  },

  // ── 5. Network graph ────────────────────────────────────────────
  {
    id: "network-graph",
    group: 5,
    route: "/network?category=fittings&tour=1",
    target: '[data-tour="network-canvas"]',
    title: "Your whole supply chain in one picture",
    body: "Suppliers → categories → branches → customer types, sized by 90-day flow-through. We've pre-filtered to Fittings so the story is easy to read — change the filter any time.",
    why: "For VP Ops: see concentration risk (one supplier = 40% of copper flow) before it becomes a fire drill.",
    placement: "right",
  },
  {
    id: "network-node-click",
    group: 5,
    route: "/network?category=fittings&tour=1",
    target: '[data-tour="network-canvas"]',
    title: "Click any node for the details",
    body: "Click a supplier, category, or branch to see the flow-through value, top SKUs, and where the risk sits. Try clicking a supplier node before hitting Next.",
    why: "For the Ops team: the graph is a starting point, not the answer — every node is a drill-down.",
    placement: "right",
  },

  // ── 6. Disruption simulator ─────────────────────────────────────
  {
    id: "disruption-sim",
    group: 6,
    route: "/network",
    target: '[data-tour="disruption-simulator"]',
    title: "Simulate the disruption before it hits",
    body: "Pick a supplier, set a delay, and see the exact SKUs at risk, days-until-empty, units short, and revenue exposure — branch by branch.",
    why: "For VP Ops + Procurement: turn a rumor ('Mueller might slip 2 weeks') into a decision ('transfer 40 elbows from Phoenix to Houston today').",
    placement: "top",
  },
  {
    id: "disruption-run",
    group: 6,
    route: "/network",
    target: '[data-tour="run-simulation-btn"]',
    title: "Click 'Run Simulation' — try it now",
    body: "In a few seconds you'll get a severity heat map, top 20 at-risk SKUs with days-to-stockout, and AI-drafted recommended actions. Click the button before hitting Next.",
    why: "For the whole team: replaces the 'call everyone and panic' response with a specific 48-hour action list.",
    placement: "right",
  },

  // ── 7. Agents ───────────────────────────────────────────────────
  {
    id: "agents",
    group: 7,
    route: "/agents",
    target: '[data-tour="agents-panel"]',
    title: "The system proposes, you approve, everything is logged",
    body: "Sense finds the issues, Decide drafts the fix in plain English, Approve creates the PO or transfer in draft — with a full audit trail.",
    why: "For VP Ops: institutional memory. No more 'why did we do that transfer last April?' every quarter.",
    placement: "top",
  },
  {
    id: "agents-approve",
    group: 7,
    route: "/agents",
    target: '[data-tour="agents-panel"]',
    title: "Approve to see the exact workflow",
    body: "Click Approve on any recommendation. A dialog shows the step-by-step actions the system will take, who gets notified, and how to reverse it — before anything runs.",
    why: "For the manager: no surprises, no shadow automation. Every approval is a deliberate decision.",
    placement: "top",
  },

  // ── 8. SKU Balance ──────────────────────────────────────────────
  {
    id: "balance-overview",
    group: 8,
    route: "/balance",
    target: '[data-tour="balance-totals"]',
    title: "Turn dead stock back into working capital",
    body: "The system pairs every excess SKU with a specific disposition — transfer, return, bundle, or markdown — and matches the recovered cash against the SKUs that keep stocking out. One screen, one decision.",
    why: "For the CFO + VP Ops: this is the working-capital play your team has been trying to build in spreadsheets. It runs every night on live data.",
    placement: "bottom",
  },
  {
    id: "balance-generate",
    group: 8,
    route: "/balance",
    target: '[data-tour="balance-generate-btn"]',
    title: "Click 'Generate AI Rebalance Plan' — try it now",
    body: "The AI names the dollars in, the dollars out, the 2–3 SKUs driving most of the value, and the single highest-ROI move for this week. Click the button before hitting Next.",
    why: "For the executive team: a board-ready narrative in 10 seconds instead of a 2-week analyst project.",
    placement: "bottom",
  },

  // ── 9. Chat ─────────────────────────────────────────────────────
  {
    id: "chat",
    group: 9,
    route: "/chat",
    target: '[data-tour="chat-input"]',
    title: "Ask any question, get the SQL that answered it",
    body: "Anyone on the team can ask — 'which PEX fittings are excess in Phoenix but at-risk in Houston?' — and see the answer plus the query that produced it.",
    why: "For the whole team: unblock decisions without waiting on a data analyst.",
    placement: "top",
  },
  {
    id: "chat-starter",
    group: 9,
    route: "/chat",
    target: '[data-tour="chat-suggestions"]',
    title: "Click a suggested question to try it",
    body: "The starter chips run a real query against your data. Try one before hitting Finish — the answer comes back with a follow-up chip you can click to go deeper.",
    why: "For the whole team: no learning curve. Anyone who can read English can query the warehouse.",
    placement: "top",
  },
];
