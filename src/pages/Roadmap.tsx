import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Sparkles, Target, Rocket } from "lucide-react";

// ---------------------------------------------------------------
// Sortly comparison + build roadmap. Persists check state locally.
// ---------------------------------------------------------------

type Status = "done" | "partial" | "todo";

type Row = {
  id: string;
  capability: string;
  sortly: string;
  us: string;
  status: Status;
  note?: string;
};

const PARITY: Row[] = [
  { id: "p-barcode", capability: "Barcode / QR scanning", sortly: "Native, camera + Bluetooth scanners", us: "Not built", status: "todo" },
  { id: "p-mobile", capability: "Native iOS / Android app", sortly: "Full-featured mobile app", us: "Responsive web only", status: "todo" },
  { id: "p-offline", capability: "Offline mode w/ sync", sortly: "First-class offline capture", us: "Not built", status: "todo" },
  { id: "p-photos", capability: "Item photos & custom fields", sortly: "Rich item cards, unlimited photos", us: "Description only", status: "todo" },
  { id: "p-locations", capability: "Location / bin hierarchy", sortly: "Nested folders + locations", us: "Branch level only", status: "partial" },
  { id: "p-labels", capability: "QR label printing", sortly: "Built-in label designer", us: "Not built", status: "todo" },
  { id: "p-alerts", capability: "Low-stock alerts (email)", sortly: "Yes", us: "In-app agent alerts", status: "partial" },
  { id: "p-audit", capability: "Activity / audit log", sortly: "Yes", us: "Built (action_audit_log)", status: "done" },
  { id: "p-roles", capability: "Roles & permissions", sortly: "Yes", us: "Admin / read-only", status: "done" },
  { id: "p-import", capability: "CSV / spreadsheet import", sortly: "Yes", us: "Connect Data page (partial)", status: "partial" },
];

const DIFFERENTIATORS: Row[] = [
  { id: "d-forecast", capability: "AI demand forecasting (per SKU)", sortly: "None", us: "Damped Holt-Winters + seasonal-naive tournament", status: "done" },
  { id: "d-explain", capability: "Plain-English forecast explainer", sortly: "None", us: "Claude explain-forecast", status: "done" },
  { id: "d-agents", capability: "Autonomous sense→decide→act agents", sortly: "None", us: "Agents page w/ approve + audit", status: "done" },
  { id: "d-balance", capability: "Capital rebalance (excess → shortages)", sortly: "None", us: "SKU Balance w/ allocation tray", status: "done" },
  { id: "d-network", capability: "Supply-chain network graph", sortly: "None", us: "Interactive graph + critical path", status: "done" },
  { id: "d-disruption", capability: "Disruption simulator", sortly: "None", us: "Supplier delay simulation w/ Claude actions", status: "done" },
  { id: "d-chat", capability: "Natural-language Ask AI over data", sortly: "None", us: "Chat page w/ vocabulary injection", status: "done" },
  { id: "d-reorder", capability: "Reorder recs w/ safety stock + rebates", sortly: "Manual reorder points", us: "compute-reorder-recommendations + explainer", status: "done" },
  { id: "d-substitutes", capability: "Substitute suggestions", sortly: "None", us: "Wired in agents & disruption", status: "done" },
  { id: "d-seasonality", capability: "Seasonality-aware safety stock", sortly: "None", us: "Seasonality boost in recs", status: "done" },
];

const NEXT_MOAT: Row[] = [
  { id: "n-mobile-scan", capability: "Mobile PWA + camera barcode scan", sortly: "Their strength", us: "Phase 1 build (see plan below)", status: "todo" },
  { id: "n-offline", capability: "Offline-first capture w/ conflict-safe sync", sortly: "Their strength", us: "Phase 1 build", status: "todo" },
  { id: "n-voice", capability: "Voice count / hands-free receiving", sortly: "None", us: "Web Speech + Claude parse", status: "todo" },
  { id: "n-photo-ai", capability: "Photo-to-SKU identification", sortly: "None", us: "Vision model on item photo", status: "todo" },
  { id: "n-anomaly", capability: "Shrinkage / anomaly detection", sortly: "None", us: "Statistical + LLM narrative", status: "todo" },
  { id: "n-roi", capability: "AI-attributed savings meter", sortly: "None", us: "$ saved from approved actions", status: "todo" },
  { id: "n-landing", capability: "Public comparison landing page", sortly: "N/A", us: "Marketing site", status: "todo" },
];

function useChecked(key: string) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(checked)); }, [key, checked]);
  return [checked, setChecked] as const;
}

const statusBadge = (s: Status) => {
  if (s === "done") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Shipped</Badge>;
  if (s === "partial") return <Badge variant="secondary">Partial</Badge>;
  return <Badge variant="outline">To do</Badge>;
};

function Section({
  title, icon, rows, storageKey, description,
}: { title: string; icon: React.ReactNode; rows: Row[]; storageKey: string; description: string }) {
  const [checked, setChecked] = useChecked(storageKey);
  const doneCount = useMemo(
    () => rows.filter(r => checked[r.id] || r.status === "done").length,
    [rows, checked],
  );
  const pct = Math.round((doneCount / rows.length) * 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
          <div className="flex items-center gap-3 min-w-[220px]">
            <Progress value={pct} className="w-40" />
            <span className="text-sm text-muted-foreground tabular-nums">{doneCount}/{rows.length}</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-3 w-10">Done</th>
                <th className="py-2 pr-3">Capability</th>
                <th className="py-2 pr-3">Sortly</th>
                <th className="py-2 pr-3">Inventory Forecaster</th>
                <th className="py-2 pr-3 w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const isDone = checked[r.id] || r.status === "done";
                return (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-3 pr-3">
                      <Checkbox
                        checked={isDone}
                        onCheckedChange={(v) => setChecked(prev => ({ ...prev, [r.id]: !!v }))}
                      />
                    </td>
                    <td className={`py-3 pr-3 font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>{r.capability}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{r.sortly}</td>
                    <td className="py-3 pr-3">{r.us}</td>
                    <td className="py-3 pr-3">{statusBadge(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Roadmap() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sortly Comparison &amp; Build Roadmap</h1>
        <p className="text-muted-foreground mt-1">
          Where we match Sortly, where we already win, and what to build next. Check items off as we ship — progress is saved in your browser.
        </p>
        <div className="mt-3 p-3 rounded-md border bg-muted/30 text-sm">
          <span className="font-medium">Positioning:</span>{" "}
          <em>Sortly organizes your inventory. Inventory Forecaster tells you what to do about it — today, not someday.</em>
        </div>
      </div>

      <Section
        title="Parity Gaps — What Sortly Does Well"
        icon={<Target className="h-5 w-5 text-amber-600" />}
        description="Table-stakes SMB features their users love. Close these to remove the 'but Sortly has…' objection."
        rows={PARITY}
        storageKey="roadmap:parity"
      />

      <Section
        title="AI-Native Differentiators — Where We Already Win"
        icon={<Sparkles className="h-5 w-5 text-primary" />}
        description="Every item here is a Sortly gap and shipped in our app today. Lead every demo with these."
        rows={DIFFERENTIATORS}
        storageKey="roadmap:diff"
      />

      <Section
        title="Next Moat — Widen the Gap"
        icon={<Rocket className="h-5 w-5 text-emerald-600" />}
        description="Neutralize Sortly's strengths (mobile, offline, barcode) and add AI capabilities they can't match."
        rows={NEXT_MOAT}
        storageKey="roadmap:next"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Phase 1 Plan — Mobile PWA + Offline Sync
          </CardTitle>
          <p className="text-sm text-muted-foreground">Closes the two biggest Sortly gaps in one sprint of work.</p>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed">
          <div>
            <h3 className="font-semibold text-base mb-1">Goal</h3>
            <p>Field users (warehouse, driver, tech in a basement) can scan, count, receive, and adjust stock from a phone with zero connectivity, and see it merged cleanly when they come back online — while our AI layer keeps running on the server.</p>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Approach: Installable PWA (not native)</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Ships as one codebase, one App Store review-free deploy — critical for demo velocity.</li>
              <li>iOS 17+ / Android Chrome both support camera <code>BarcodeDetector</code>, background sync, and IndexedDB.</li>
              <li>Add to Home Screen &rArr; full-screen, offline, push-capable. Native wrapper only if a customer forces it.</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Architecture</h3>
            <pre className="bg-muted p-3 rounded overflow-x-auto text-xs">{`Phone (PWA)
 ├─ Service Worker  →  cache app shell + last-synced data
 ├─ IndexedDB       →  local mirror of SKUs, branches, open counts
 ├─ Outbox queue    →  mutations tagged with client_id + client_ts
 └─ BarcodeDetector →  camera scan → SKU lookup (local first)

        │  online
        ▼
Edge Function: /sync
 ├─ Auth check
 ├─ Pull:  since=<last_server_ts>  →  changed rows
 └─ Push:  outbox[]  →  apply w/ conflict rules  →  return server_ts`}</pre>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Data model additions</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><code>stock_movements</code> — append-only ledger (sku, branch, delta, reason, actor, client_id, client_ts, server_ts). On-hand becomes a projection so conflicts are impossible.</li>
              <li><code>sync_cursors</code> — per user/device last-pulled server_ts.</li>
              <li>Add <code>updated_at</code> triggers on <code>products</code>, <code>inventory_levels</code>, <code>branches</code> for delta pull.</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Conflict strategy</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Movements:</strong> commutative — apply all, order by <code>client_ts</code>. No conflict possible.</li>
              <li><strong>Item edits (description, photo, custom fields):</strong> last-write-wins by <code>client_ts</code>, loser stored in <code>sync_conflicts</code> for review.</li>
              <li><strong>Approvals (reorder, balance plan):</strong> server-authoritative; queued approvals re-validated on sync and rejected with a toast if state changed.</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Build breakdown</h3>
            <ol className="list-decimal pl-5 space-y-1">
              <li><strong>Week 1 — PWA shell.</strong> <code>vite-plugin-pwa</code>, manifest, install prompt, offline app-shell, "Offline" banner.</li>
              <li><strong>Week 1 — Local mirror.</strong> Dexie (IndexedDB) schema; hydrate on login; delta pull edge function.</li>
              <li><strong>Week 2 — Scan &amp; count.</strong> Camera scanner page → SKU lookup → cycle count / receive / adjust flows writing to local outbox.</li>
              <li><strong>Week 2 — <code>stock_movements</code> table + <code>/sync</code> edge function.</strong> Push/pull, cursors, idempotency by <code>client_id</code>.</li>
              <li><strong>Week 3 — Conflict UI.</strong> Sync status chip, retry, <code>sync_conflicts</code> review drawer for admins.</li>
              <li><strong>Week 3 — Label printing.</strong> QR generator page (bulk from SKU list) — closes another Sortly parity gap in the same sprint.</li>
              <li><strong>Week 4 — Field polish.</strong> Big-tap targets, haptics, torch toggle, voice-count (Web Speech → Claude parse), demo mode with seeded scans.</li>
            </ol>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Success criteria</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Airplane-mode demo: scan 20 items, adjust 5, re-connect → all merged, audit log intact, forecasts updated.</li>
              <li>Zero duplicate movements after intentional double-submit.</li>
              <li>&lt; 2s from camera open to SKU card on a mid-range Android.</li>
              <li>Existing web app unaffected; PWA is additive.</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-base mb-1">Risks &amp; mitigations</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>iOS Safari quirks</strong> (storage eviction, background sync gaps) → fall back to foreground sync on app resume; warn if storage quota &lt; 50 MB.</li>
              <li><strong>Barcode variety</strong> (Code128, UPC, QR, DataMatrix) → <code>BarcodeDetector</code> covers most; ZXing WASM fallback for DataMatrix.</li>
              <li><strong>Large catalogs</strong> → mirror only SKUs for the user's assigned branches, plus a "search server" fallback when online.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
