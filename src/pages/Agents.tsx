import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Boxes, TruckIcon, Repeat, BadgePercent, ArrowLeftRight,
  ChevronDown, Check, X, Clock, Edit, Sparkles, CheckCircle2, History, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { humanizeEvidence } from "@/lib/evidence-format";
import { EditActionDialog } from "@/components/EditActionDialog";
import { AuditLogDialog } from "@/components/AuditLogDialog";

type Insight = {
  id: string;
  type: "stockout_risk" | "excess_inventory" | "supplier_delay_impact" | "substitution_opportunity" | "rebate_opportunity" | "inter_branch_transfer";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  narrative: string;
  financial_impact_usd: number;
  evidence_json: any;
  recommended_action_json: any;
  status: "new" | "approved" | "rejected" | "snoozed" | "executed";
  created_at: string;
  resolved_at: string | null;
};

const TYPE_META: Record<Insight["type"], { icon: any; label: string; color: string }> = {
  stockout_risk: { icon: AlertTriangle, label: "Stockout Risk", color: "text-destructive" },
  excess_inventory: { icon: Boxes, label: "Excess Inventory", color: "text-warning" },
  supplier_delay_impact: { icon: TruckIcon, label: "Supplier Delay", color: "text-destructive" },
  substitution_opportunity: { icon: Repeat, label: "Substitution", color: "text-primary" },
  rebate_opportunity: { icon: BadgePercent, label: "Rebate", color: "text-success" },
  inter_branch_transfer: { icon: ArrowLeftRight, label: "Transfer", color: "text-primary" },
};

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

const fmt$ = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` :
  n >= 1_000 ? `$${(n / 1_000).toFixed(1)}k` : `$${Math.round(n)}`;

function sevBadge(sev: Insight["severity"]) {
  const map = {
    critical: "bg-destructive text-destructive-foreground",
    high: "bg-destructive/15 text-destructive border border-destructive/30",
    medium: "bg-warning/15 text-warning-foreground border border-warning/30",
    low: "bg-muted text-muted-foreground border",
  } as const;
  return <Badge className={cn("uppercase text-[10px] tracking-wide", map[sev])}>{sev}</Badge>;
}

export default function Agents() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [editing, setEditing] = useState<Insight | null>(null);
  const [auditFor, setAuditFor] = useState<string | null | undefined>(undefined);
  const [draftingNarratives, setDraftingNarratives] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("insights")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    else setInsights((data ?? []) as Insight[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runSensePass() {
    setRunning(true);
    try {
      toast.message("Sensing the network…");
      const { data: sense, error: e1 } = await supabase.functions.invoke("agents-sense");
      if (e1) throw e1;
      setLastRun(new Date().toISOString());
      const created = sense?.created ?? 0;
      toast.success(`${created} new insights identified`);
      if (created > 0) {
        toast.message("Drafting narratives with Claude…");
        const { error: e2 } = await supabase.functions.invoke("agents-decide", { body: { ids: sense.ids } });
        if (e2) toast.error(e2.message);
      }
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Sense pass failed");
    } finally {
      setRunning(false);
    }
  }

  async function draftMissingNarratives() {
    const missing = insights.filter((i) => !i.narrative || i.narrative.trim() === "");
    if (missing.length === 0) { toast.success("All insights already have narratives."); return; }
    setDraftingNarratives(true);
    try {
      const CHUNK = 30;
      let total = 0;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const ids = missing.slice(i, i + CHUNK).map((m) => m.id);
        toast.message(`Drafting ${i + 1}-${Math.min(i + CHUNK, missing.length)} of ${missing.length}…`);
        const { data, error } = await supabase.functions.invoke("agents-decide", { body: { ids } });
        if (error) throw error;
        total += data?.updated ?? 0;
      }
      toast.success(`Drafted ${total} narratives`);
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Drafting failed");
    } finally {
      setDraftingNarratives(false);
    }
  }

  async function approve(insight: Insight, edited_action?: any) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.functions.invoke("agents-act", {
      body: { insight_id: insight.id, user_id: user?.id, edited_action },
    });
    if (error) return toast.error(error.message);
    toast.success("Action executed and logged");
    load();
  }

  async function setStatus(id: string, status: Insight["status"]) {
    const patch: any = { status };
    if (status === "rejected" || status === "executed") patch.resolved_at = new Date().toISOString();
    const { error } = await supabase.from("insights").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  const filtered = useMemo(() => {
    return insights
      .filter((i) => filterType === "all" || i.type === filterType)
      .filter((i) => filterSeverity === "all" || i.severity === filterSeverity)
      .filter((i) => {
        if (filterStatus === "all") return true;
        if (filterStatus === "active") return i.status === "new" || i.status === "approved";
        return i.status === filterStatus;
      })
      .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.financial_impact_usd - a.financial_impact_usd);
  }, [insights, filterType, filterSeverity, filterStatus]);

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = insights.filter((i) => new Date(i.created_at).getTime() > weekAgo);
    const total = recent.reduce((a, i) => a + Number(i.financial_impact_usd ?? 0), 0);
    const decided = recent.filter((i) => i.status !== "new");
    const approved = recent.filter((i) => i.status === "executed" || i.status === "approved");
    const rate = decided.length ? Math.round((approved.length / decided.length) * 100) : 0;
    return { count: recent.length, value: total, rate };
  }, [insights]);

  return (
    <div className="grid grid-cols-[1fr_280px] gap-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Agents
            </h1>
            <p className="text-sm text-muted-foreground">Autonomous loop: Sense → Decide → Act.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground text-right">
              {lastRun ? <>Last run: {formatDistanceToNow(new Date(lastRun), { addSuffix: true })}</> : "Not run yet"}
              <div className="flex items-center gap-2 mt-1 justify-end">
                <span>Auto-run</span>
                <Switch checked={autoRun} onCheckedChange={setAutoRun} />
              </div>
            </div>
            <Button variant="outline" onClick={() => setAuditFor(null)} className="gap-1">
              <History className="h-4 w-4" /> Audit log
            </Button>
            <Button variant="outline" onClick={draftMissingNarratives} disabled={draftingNarratives} className="gap-1">
              <RefreshCw className={cn("h-4 w-4", draftingNarratives && "animate-spin")} />
              {draftingNarratives ? "Drafting…" : "Draft missing narratives"}
            </Button>
            <Button onClick={runSensePass} disabled={running} size="lg">
              {running ? "Running…" : "Run Sense Pass"}
            </Button>
          </div>
        </div>

        {loading ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground border-dashed">
            No insights match. Click <strong>Run Sense Pass</strong> to scan the network.
          </Card>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filtered.map((ins) => (
              <InsightCard
                key={ins.id}
                insight={ins}
                onApprove={(i) => approve(i)}
                onEdit={(i) => setEditing(i)}
                onAudit={(i) => setAuditFor(i.id)}
                onStatus={setStatus}
              />
            ))}
          </div>
        )}
      </div>

      <EditActionDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        insight={editing as any}
        onSave={async (edited) => { if (editing) await approve(editing, edited); setEditing(null); }}
      />
      <AuditLogDialog
        open={auditFor !== undefined}
        onOpenChange={(o) => !o && setAuditFor(undefined)}
        insightId={auditFor ?? null}
      />

      <aside className="space-y-4">
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold">Filters</h3>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TYPE_META).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Severity</label>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active (hide resolved)</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="executed">Executed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="snoozed">Snoozed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold">This week</h3>
          <div>
            <div className="text-2xl font-semibold">{stats.count}</div>
            <div className="text-xs text-muted-foreground">insights generated</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{fmt$(stats.value)}</div>
            <div className="text-xs text-muted-foreground">impact identified</div>
          </div>
          <div>
            <div className="text-2xl font-semibold">{stats.rate}%</div>
            <div className="text-xs text-muted-foreground">approval rate</div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function InsightCard({
  insight, onApprove, onEdit, onAudit, onStatus,
}: {
  insight: Insight;
  onApprove: (i: Insight) => void;
  onEdit: (i: Insight) => void;
  onAudit: (i: Insight) => void;
  onStatus: (id: string, status: Insight["status"]) => void;
}) {
  const meta = TYPE_META[insight.type];
  const Icon = meta.icon;
  const ev = insight.evidence_json ?? {};
  const isExecuted = insight.status === "executed";
  const isResolved = insight.status === "rejected" || insight.status === "snoozed";
  const summary = insight.recommended_action_json?.summary;

  return (
    <Card className={cn("p-4 space-y-3 border-l-4",
      insight.severity === "critical" && "border-l-destructive",
      insight.severity === "high" && "border-l-destructive/60",
      insight.severity === "medium" && "border-l-warning",
      insight.severity === "low" && "border-l-muted-foreground/40",
      isExecuted && "opacity-80"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />
          {sevBadge(insight.severity)}
          <span className="text-xs text-muted-foreground">{meta.label}</span>
        </div>
        {isExecuted && (
          <Badge variant="outline" className="gap-1 text-success border-success/30">
            <CheckCircle2 className="h-3 w-3" /> Executed
          </Badge>
        )}
      </div>

      <div>
        <h3 className="font-medium leading-tight">{insight.title}</h3>
        <div className="text-2xl font-semibold mt-1">{fmt$(insight.financial_impact_usd)}</div>
      </div>

      {insight.narrative ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{insight.narrative}</p>
      ) : (
        <p className="text-xs text-muted-foreground italic">Drafting narrative…</p>
      )}

      {insight.type === "inter_branch_transfer" && (
        <div className="grid grid-cols-2 gap-3 text-xs bg-muted/40 rounded-md p-3">
          <div>
            <div className="text-muted-foreground">FROM</div>
            <div className="font-medium">{ev.source_branch}</div>
            <div className="text-muted-foreground mt-1">{ev.source_dos} days of supply</div>
          </div>
          <div>
            <div className="text-muted-foreground">TO</div>
            <div className="font-medium">{ev.dest_branch}</div>
            <div className="text-muted-foreground mt-1">stockout in {ev.dest_stockout_in_days}d</div>
          </div>
          <div className="col-span-2 grid grid-cols-3 gap-2 pt-2 border-t border-border">
            <div><div className="text-muted-foreground">Move</div><div className="font-medium">{ev.quantity} units</div></div>
            <div><div className="text-muted-foreground">Cost</div><div className="font-medium">{fmt$(ev.transfer_cost ?? 0)}</div></div>
            <div><div className="text-muted-foreground">Arrives</div><div className="font-medium">{ev.expected_arrival}</div></div>
          </div>
        </div>
      )}

      {summary && (
        <div className="text-sm bg-primary/5 border border-primary/20 rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-primary mb-1">Recommended Action</div>
          {summary}
        </div>
      )}

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-3 w-3" /> Evidence
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(ev, null, 2)}</pre>
        </CollapsibleContent>
      </Collapsible>

      {!isExecuted && !isResolved && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Button size="sm" onClick={() => onApprove(insight)} className="gap-1">
            <Check className="h-3 w-3" /> Approve
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" disabled>
            <Edit className="h-3 w-3" /> Edit
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => onStatus(insight.id, "rejected")}>
            <X className="h-3 w-3" /> Reject
          </Button>
          <Button size="sm" variant="ghost" className="gap-1 ml-auto" onClick={() => onStatus(insight.id, "snoozed")}>
            <Clock className="h-3 w-3" /> Snooze 7d
          </Button>
        </div>
      )}
      {isExecuted && insight.resolved_at && (
        <div className="text-xs text-muted-foreground pt-2 border-t border-border">
          Executed {formatDistanceToNow(new Date(insight.resolved_at), { addSuffix: true })}
        </div>
      )}
    </Card>
  );
}
