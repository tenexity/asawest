# Guided Demo Brief — Inventory Forecaster

## Audience & hero
- **Primary buyer:** VP Operations / Director of Supply Chain at a mid-market plumbing & HVAC distributor (10–30 branches).
- **Also watching:** Head of Procurement (buys the SKUs), CFO / Controller (owns working capital), Branch Managers (feel the stockouts).
- **Hero company (in-app):** ASA West — 8 branches, 10,000 SKUs, ~$18M inventory on hand.
- **Hero SKU archetype:** freeze-event PEX fittings — seasonal, high-variance, high-consequence when out.
- **Hero supplier archetype:** Mueller Industries (copper) and Lochinvar (water heaters) for disruption demos.

## Pain → Feature map
| Pain | Who feels it | Feature in-app | Value line |
|---|---|---|---|
| $M tied up in dead stock nobody notices | CFO / Controller | Dashboard **Dead Stock** KPI + Skus "Dead stock only" filter | "Turn shelf dust back into working capital." |
| Stockouts on the SKUs that actually matter | Branch Managers, VP Ops | Fill Rate KPI + Top Problems table | "Know which stockouts are costing you real revenue — today." |
| Buyers guess reorder qty from a spreadsheet | Procurement | SKU Detail forecast tournament + Reorder Recs | "Four forecast models compete on every SKU; the buyer sees the winner and the math." |
| A supplier slips 2 weeks and nobody knows what breaks | VP Ops, Procurement | Network Graph + Disruption Simulator | "See exactly which SKUs, branches, and dollars are at risk — before the PO is late." |
| Insights sit in reports, nobody acts | VP Ops | Agents (Sense → Decide → Act) + Audit log | "The system proposes the move, you approve it, and it's logged." |
| Ad-hoc questions take a data analyst a week | Everyone | Ask AI | "Type the question. Get the answer with the SQL that produced it." |

## Screen order (8 steps, ~5 min)
1. **Dashboard** — frame the state of the business. Dead Stock KPI = the money hook.
2. **SKU Explorer** — filter to Dead Stock. "These 600 SKUs are $322K of capital doing nothing."
3. **SKU Detail** — forecast tournament. "Four models, one winner, plain-English reasoning."
4. **Reorder Recommendations** — seasonality- and rebate-aware suggestions the buyer can act on.
5. **Network Graph** — the whole supply chain in one view.
6. **Disruption Simulator** — pick Mueller Industries, 14 days. "Here's what breaks and what it costs."
7. **Agents** — Sense pass finds it, Decide drafts the fix, Approve executes with a full audit trail.
8. **Ask AI** — the free-form escape hatch. Anyone on the team can ask, no analyst needed.

## Tone
Confident, specific, dollar-denominated. No AI-buzzword filler. Every card says *who this helps* and *what changes for them*.
