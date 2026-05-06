import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type EditableInsight = {
  id: string;
  type: string;
  title: string;
  recommended_action_json: any;
  evidence_json: any;
};

// Per-type editable fields. Falls back to "quantity" + "summary".
const FIELDS_BY_TYPE: Record<string, Array<{ key: string; label: string; type?: "number" | "text" | "date" }>> = {
  inter_branch_transfer: [
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "expected_arrival", label: "Expected arrival", type: "date" },
  ],
  rebate_opportunity: [{ key: "quantity", label: "New quantity", type: "number" }],
  stockout_risk: [{ key: "quantity", label: "Order quantity", type: "number" }],
  excess_inventory: [{ key: "excess_qty", label: "Markdown units", type: "number" }],
  substitution_opportunity: [],
  supplier_delay_impact: [],
};

export function EditActionDialog({
  open, onOpenChange, insight, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  insight: EditableInsight | null;
  onSave: (edited: any) => Promise<void>;
}) {
  const [form, setForm] = useState<Record<string, any>>({});
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!insight) return;
    const a = insight.recommended_action_json ?? {};
    const ev = insight.evidence_json ?? {};
    const fields = FIELDS_BY_TYPE[insight.type] ?? [];
    const initial: Record<string, any> = {};
    fields.forEach((f) => { initial[f.key] = a[f.key] ?? ev[f.key] ?? ""; });
    setForm(initial);
    setSummary(a.summary ?? "");
  }, [insight]);

  if (!insight) return null;
  const fields = FIELDS_BY_TYPE[insight.type] ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit recommended action</DialogTitle>
          <DialogDescription>{insight.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fields.length === 0 && (
            <p className="text-sm text-muted-foreground">This insight type has no editable parameters — you can still revise the summary.</p>
          )}
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                type={f.type ?? "text"}
                value={form[f.key] ?? ""}
                onChange={(e) => setForm({ ...form, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="summary">Action summary</Label>
            <Textarea id="summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try { await onSave({ ...form, summary }); onOpenChange(false); } finally { setSaving(false); }
            }}
          >
            {saving ? "Saving…" : "Save & Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
