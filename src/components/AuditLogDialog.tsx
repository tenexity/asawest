import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";

type AuditEntry = {
  id: string;
  insight_id: string;
  insight_type: string;
  insight_title: string;
  action_summary: string | null;
  financial_impact_usd: number;
  status: string;
  created_at: string;
  action_payload: any;
};

const fmt$ = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` :
  n >= 1_000 ? `$${(n / 1_000).toFixed(1)}k` : `$${Math.round(n)}`;

export function AuditLogDialog({
  open, onOpenChange, insightId,
}: { open: boolean; onOpenChange: (o: boolean) => void; insightId?: string | null }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    let q = supabase.from("action_audit_log").select("*").order("created_at", { ascending: false }).limit(100);
    if (insightId) q = q.eq("insight_id", insightId);
    q.then(({ data }) => { setRows((data ?? []) as AuditEntry[]); setLoading(false); });
  }, [open, insightId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Action audit log</DialogTitle>
          <DialogDescription>
            {insightId ? "Actions taken on this insight." : "All actions executed by Agents."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No actions recorded yet.</div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="border rounded-md p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{r.insight_title}</div>
                    <Badge variant={r.status === "success" ? "outline" : "destructive"}>{r.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.insight_type.replace(/_/g, " ")} · {fmt$(Number(r.financial_impact_usd ?? 0))} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </div>
                  {r.action_summary && <div className="text-sm">{r.action_summary}</div>}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
