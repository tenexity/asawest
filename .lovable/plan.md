# SKU Balance — Recommendation & Build Plan

## Recommendation

Yes, build this. It's a natural fit and directly monetizes the two KPIs already on the Dashboard (**Dead Stock** and **Stockouts**). Rather than bury it in a modal, add it as a **top-level sidebar page** called **SKU Balance** — it deserves its own real estate because it produces a *decision artifact* (a rebalance plan) that a buyer will export, share, and act on. A modal would feel like an afterthought.

The concept: the app already knows which SKUs are excess ($ tied up, no movement) and which are chronic stockouts (lost sales, high velocity). SKU Balance turns that into a single working-capital play: **"Free $X by clearing these 20 dead SKUs → redeploy into these 15 fast movers → net margin lift $Y."**

## Where it lives

- New sidebar entry **SKU Balance** (icon: `Scale` from lucide) between *Reorder Recommendations* and *Network Graph*.
- Route: `/balance`.
- Deep-link target from the Dashboard **Dead Stock** KPI (currently goes to `/skus?filter=dead`) gets a secondary "Build rebalance plan →" link.

## Page layout

```text
┌─ SKU Balance ────────────────────────────────────────────────┐
│  Capital tied up in dead stock: $322k                        │
│  Capital needed to fix top stockouts: $189k                  │
│  Net freed working capital: $133k     Est. margin lift: $47k │
├──────────────────────────┬───────────────────────────────────┤
│ RELEASE (excess → cash)  │ REDEPLOY (cash → fast movers)     │
│ ┌──────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ SKU | Br | Qty | $   │ │ │ SKU | Br | Short | Need $     │ │
│ │ ...  (top 20)        │ │ │ ...  (top 20)                 │ │
│ └──────────────────────┘ │ └───────────────────────────────┘ │
│  Disposition per row:    │  Priority per row:                │
│   • Return to supplier   │   • Critical (stockout now)       │
│   • Bundle w/ fast mover │   • Below ROP                     │
│   • Markdown 20-40%      │   • Trending up                   │
│   • Transfer to branch X │                                   │
├──────────────────────────┴───────────────────────────────────┤
│  [ Generate AI Rebalance Plan ]   [ Export CSV ]  [ Approve ]│
└──────────────────────────────────────────────────────────────┘
```

## How disposition is chosen (rules, not ML)

For each excess SKU:
1. If another branch has it below reorder point → **Transfer** (highest recovery, no discount).
2. Else if the supplier accepts returns (flag on `suppliers`) and qty × cost > $500 → **Return to supplier** (assume 85% recovery).
3. Else if there's a fast-moving SKU in the same category → **Bundle** (assume 100% recovery, moves paired stock).
4. Else → **Markdown 25%** (assume 75% recovery).

For each stockout SKU, priority = `days_since_stockout × avg_daily_demand × unit_margin`.

The pairing is a simple greedy match: sort releases by recoverable $ desc, sort redeploys by priority desc, walk down and allocate.

## AI layer

A **Generate AI Rebalance Plan** button (mirrors the *Generate Explanation* pattern in SKU Detail) calls a new `rebalance-plan` edge function. It sends the top 20 releases + top 20 redeploys to Lovable AI and gets back a 3-bullet narrative:
- **The play** — one sentence, dollars in / dollars out / net lift.
- **Why now** — the 2-3 SKUs driving most of the value.
- **First move this week** — the single highest-ROI action.

Rendered with `react-markdown` like the forecast explanation.

## Approve action

**Approve** creates:
- One `markdown_candidates` row per markdown disposition.
- One `transfer_orders` row per transfer disposition.
- One draft `purchase_orders` row bundling the redeploy SKUs by supplier.
- One `action_audit_log` entry with the full plan JSON.

Same confirm-dialog pattern (`ApproveConfirmDialog`) so the user sees exactly what will happen before it fires. Nothing is auto-sent to suppliers.

## Data — no new tables needed

Everything comes from existing tables. Add one RPC `sku_balance_plan(p_branch_id uuid)` that returns `{ releases: [...], redeploys: [...], totals: {...} }` — same shape pattern as `dashboard_summary`. Keeps the client thin.

## Tour integration

Add a **Step 9 — SKU Balance** to `tour-config.ts` with two sub-steps:
- **9a** highlight the two-column layout, narrate the working-capital story.
- **9b** highlight *Generate AI Rebalance Plan* button, user clicks it, plan appears.

Place it after Step 8 (Chat) since it's the payoff — "the AI already knows where the money is stuck; here's how it gets it moving."

## Build order (if you approve)

1. `sku_balance_plan` RPC + grants.
2. `/balance` page with the two tables and totals bar.
3. `rebalance-plan` edge function + AI narrative panel.
4. Approve dialog wired to existing action tables + audit log.
5. Sidebar entry + Dashboard KPI cross-link.
6. Tour step 9 + `data-tour` anchors.

Reply "go" and I'll build it in that order.
