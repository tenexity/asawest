export type DemoStep = {
  path: string;
  label: string;
  bullets: string[];
};

export const DEMO_SEQUENCE: DemoStep[] = [
  {
    path: "/",
    label: "Dashboard",
    bullets: [
      "Frame the problem: $1.2M tied up in excess inventory",
      "Point to branch comparison — Houston vs Phoenix",
      "Note 50 SKUs at stockout risk in red",
      "Set up the question: how do we act on this?",
    ],
  },
  {
    path: "/skus",
    label: "SKU Explorer",
    bullets: [
      "Filter to freeze-event SKUs (PEX fittings)",
      "Show seasonality pattern badge",
      "Click into one to drill down",
    ],
  },
  {
    path: "/skus",
    label: "SKU Detail",
    bullets: [
      "Show forecast tournament — 4 models compete",
      "Read Claude's plain-English reasoning",
      "Point out winner + confidence band",
    ],
  },
  {
    path: "/reorder",
    label: "Reorder Recommendations",
    bullets: [
      "Seasonality-boosted suggestions in orange",
      "Rebate-aware bumps to hit threshold",
      "Click to see full math behind one rec",
    ],
  },
  {
    path: "/graph",
    label: "Graph + Disruption Sim",
    bullets: [
      "THE MOMENT — pick the largest supplier",
      "Slide delay to 10-14 days",
      "Watch ripple count light up across SKUs",
      "Save snapshot for the post-mortem",
    ],
  },
  {
    path: "/agents",
    label: "Agents",
    bullets: [
      "Run sense pass — agent finds 6 insight types",
      "Approve a transfer recommendation",
      "Show the executed PO/transfer",
    ],
  },
  {
    path: "/chat",
    label: "Ask AI",
    bullets: [
      "Type: 'show freeze-prone PEX exposure'",
      "Watch tools fire — find_skus, get_branch_summary",
      "Reveal the SQL transparency panel",
    ],
  },
  {
    path: "/",
    label: "Close the Loop",
    bullets: [
      "KPIs reflect actions just taken",
      "$ at risk dropped, transfers in flight",
      "Hand off to Q&A",
    ],
  },
];

export const TIMING = [
  { at: "0:00", text: "Open on Dashboard, frame the problem (1 min)" },
  { at: "1:00", text: "SKU Explorer + forecast tournament (1 min)" },
  { at: "2:00", text: "Reorder recommendations (1 min)" },
  { at: "3:00", text: "Network graph (30 sec)" },
  { at: "3:30", text: "DISRUPTION SIMULATOR — pick supplier, 7 days, run (2 min)" },
  { at: "5:30", text: "Agents — show insights, approve a transfer (1 min)" },
  { at: "6:30", text: "Ask AI — type a question live (1 min)" },
  { at: "7:30", text: "Back to Dashboard, closed loop (30 sec)" },
  { at: "8:00", text: "Reset and Q&A (2 min)" },
];

export function findStepIndex(pathname: string): number {
  // Prefer exact match, then prefix match
  const exact = DEMO_SEQUENCE.findIndex(s => s.path === pathname);
  if (exact >= 0) return exact;
  return DEMO_SEQUENCE.findIndex(s => pathname.startsWith(s.path) && s.path !== "/");
}
