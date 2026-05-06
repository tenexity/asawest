import { useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { useState } from "react";

type Guide = { title: string; intro: string; steps: string[]; tips?: string[] };

const GUIDES: Record<string, Guide> = {
  "/": {
    title: "Dashboard",
    intro: "Your daily snapshot of inventory health across all branches.",
    steps: [
      "Use the branch selector (top-right) to scope KPIs to one branch or All Branches.",
      "Review the urgency tiles to spot stockouts and at-risk SKUs.",
      "Click any chart segment or KPI to drill into the underlying SKUs.",
    ],
  },
  "/skus": {
    title: "SKU Explorer",
    intro: "Search, filter, and inspect every SKU in your catalog.",
    steps: [
      "Search by SKU code or description, or filter by category and ABC/XYZ class.",
      "Toggle 'Problems only' to hide healthy items (see the info icon for definitions).",
      "Click any row to open the SKU detail page with demand history and forecasts.",
    ],
  },
  "/skus/": {
    title: "SKU Detail",
    intro: "Full picture of one SKU: inventory by branch, demand, and forecasts.",
    steps: [
      "Switch the time window on the demand chart to see recent vs long-term trends.",
      "Scroll to 'Forecast Model Comparison' — 4 models compete and the most accurate wins.",
      "Click 'Generate explanation' for a plain-English analyst note on the winner.",
    ],
  },
  "/reorder": {
    title: "Reorder Recommendations",
    intro: "Auto-generated reorder suggestions ranked by urgency and dollar impact.",
    steps: [
      "Click 'Run Recommendation Pass' to recompute everything from current inventory and 90 days of sales.",
      "Filter by branch, supplier, urgency, or category. Use 'Seasonal only' / 'Rebate only' to focus.",
      "Click 'Why' on any row to see the math (safety stock, ROP, demand stats) plus an analyst note.",
      "Approve, snooze, or reject individual rows — or select multiple and 'Create PO from Selected' to draft purchase orders grouped by supplier.",
    ],
  },
  "/network": {
    title: "Network Graph",
    intro: "Visual map of suppliers → product categories → branches → customers.",
    steps: [
      "Drag nodes to rearrange. Scroll to zoom, drag the canvas to pan.",
      "Click a node to see what it connects to and its key metrics.",
      "Use the legend to understand node types and edge weights (volume, revenue, dependency).",
    ],
  },
  "/graph": {
    title: "Network Graph",
    intro: "Visual map of suppliers → product categories → branches → customers.",
    steps: [
      "Drag nodes to rearrange. Scroll to zoom, drag the canvas to pan.",
      "Click a node to see what it connects to and its key metrics.",
      "Use the legend to understand node types and edge weights.",
    ],
  },
  "/agents": {
    title: "Agents",
    intro: "AI agents that sense problems, decide on actions, and let you act.",
    steps: [
      "Click 'Run Sense Pass' to scan the network for new insights (stockout risk, transfers, rebates, etc.).",
      "Filter by type, severity, and status in the right sidebar.",
      "Open an insight to review the evidence, then approve to create the underlying transfer or PO.",
    ],
  },
  "/ask": {
    title: "Ask AI",
    intro: "Natural-language Q&A over your inventory, sales, suppliers, and branches.",
    steps: [
      "Pick a starter chip or type a question (e.g. 'Which Atlanta SKUs will stock out in 7 days?').",
      "The AI calls structured tools and may run SQL — expand 'Show SQL' to verify.",
      "Conversations are saved in the left rail. Click 'New conversation' to start fresh.",
    ],
  },
  "/chat": {
    title: "Ask AI",
    intro: "Natural-language Q&A over your inventory, sales, suppliers, and branches.",
    steps: [
      "Pick a starter chip or type a question.",
      "Expand 'Show SQL' on any answer to see the queries the AI ran.",
      "Conversations are saved in the left rail.",
    ],
  },
  "/connect": {
    title: "Connect Data",
    intro: "Connect external systems (ERPs, POS, supplier feeds) to keep data fresh.",
    steps: [
      "Pick a connector tile and follow the OAuth or API-key prompts.",
      "After connecting, schedule a sync interval that fits your data velocity.",
      "Use 'Test connection' to confirm the link before turning sync on.",
    ],
  },
  "/settings": {
    title: "Settings & Demo",
    intro: "Manage demo mode, snapshots, and presentation tools.",
    steps: [
      "Toggle Demo Mode (or press 'D') to show the floating presenter panel.",
      "Use 'Reset Demo State' (or press 'R') to restore the planted-problem baseline.",
      "Save snapshots before destructive actions so you can restore them mid-demo.",
    ],
    tips: [
      "Keyboard shortcuts: D = demo mode · R = reset · → = next demo page",
    ],
  },
};

function guideForPath(path: string): Guide {
  if (path.startsWith("/skus/") && path.length > "/skus/".length) return GUIDES["/skus/"];
  return GUIDES[path] ?? {
    title: "How to use this page",
    intro: "Quick orientation for the current view.",
    steps: [
      "Use the controls at the top to filter what you see.",
      "Hover icons for tooltips that explain badges and statuses.",
      "Click any row or card to drill into the underlying detail.",
    ],
  };
}

export function HowToButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const guide = guideForPath(pathname);

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setOpen(true)}>
        <HelpCircle className="h-4 w-4" />
        How-to
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{guide.title} — How to use</DialogTitle>
            <DialogDescription>{guide.intro}</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            {guide.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {guide.tips && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              {guide.tips.map((t, i) => <div key={i}>💡 {t}</div>)}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
