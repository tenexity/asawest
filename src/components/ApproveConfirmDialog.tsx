import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, AlertCircle, Bell, Undo2 } from "lucide-react";
import { buildActionPlan } from "@/lib/action-plan";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  insight: any | null;
  onConfirm: () => void;
};

export function ApproveConfirmDialog({ open, onOpenChange, insight, onConfirm }: Props) {
  if (!insight) return null;
  const plan = buildActionPlan(insight);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            {plan.title}
          </DialogTitle>
          <DialogDescription>{plan.summary}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                What happens when you click Approve
              </h4>
              <ol className="space-y-2">
                {plan.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.label}</span>
                        <Badge variant="outline" className="text-[10px]">{s.system}</Badge>
                      </div>
                      {s.detail && <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
              <div className="flex gap-2">
                <Bell className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="font-semibold">Notifications</div>
                  <div className="text-muted-foreground">{plan.notifications}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Undo2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="font-semibold">Reversibility & safeguards</div>
                  <div className="text-muted-foreground">{plan.reversible}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="font-semibold">Audit</div>
                  <div className="text-muted-foreground">
                    Every approval is logged with your user, the financial impact, and the full action payload. View it any time from the
                    {" "}<span className="font-medium">Audit log</span> button.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onConfirm(); onOpenChange(false); }} className="gap-1">
            <CheckCircle2 className="h-4 w-4" /> Approve & execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
