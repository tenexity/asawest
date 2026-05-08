// Status helpers shared by SKU views.

export type Status = "Healthy" | "Watch" | "At Risk" | "Stockout" | "Excess";

export function computeStatus(
  on_hand: number,
  reorder_point: number,
  daysOfSupply: number | null,
): Status {
  if (on_hand === 0) return "Stockout";
  // No demand in the lookback window + stock on the shelf = dead/excess,
  // not "Healthy". daysOfSupply is null only when daily demand is 0.
  if (daysOfSupply === null) return "Excess";
  if (daysOfSupply > 180) return "Excess";
  if (on_hand <= reorder_point) return "At Risk";
  if (on_hand <= reorder_point * 1.25) return "Watch";
  return "Healthy";
}

export const statusToken: Record<Status, string> = {
  Healthy: "bg-success/15 text-success border-success/30",
  Watch: "bg-warning/15 text-warning border-warning/40",
  "At Risk": "bg-danger/15 text-danger border-danger/30",
  Stockout: "bg-danger text-danger-foreground border-transparent",
  Excess: "bg-warning/15 text-warning border-warning/40",
};
