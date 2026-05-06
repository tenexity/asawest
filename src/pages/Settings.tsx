import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useDemo } from "@/contexts/DemoContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { TIMING } from "@/lib/demo-script";
import { Loader2, RotateCcw, Save, Play } from "lucide-react";

type Scenario = { id: string; name: string; created_at: string };

export default function Settings() {
  const { user } = useAuth();
  const { demoMode, setDemoMode, lastResetAt, setLastResetAt, setResetHandler } = useDemo();
  const [resetting, setResetting] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [snapName, setSnapName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadScenarios = () => {
    supabase.from("saved_scenarios").select("id,name,created_at").order("created_at", { ascending: false })
      .then(({ data }) => setScenarios((data ?? []) as Scenario[]));
  };

  useEffect(() => { loadScenarios(); }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke("reset-demo-state");
      if (error) throw error;
      const ts = data?.reset_at || new Date().toISOString();
      setLastResetAt(ts);
      if (user) await supabase.from("user_settings").upsert({ user_id: user.id, last_reset_at: ts, demo_mode: demoMode });
      toast({ title: "Demo reset complete", description: `Repopulated ${Object.keys(data?.row_counts_per_table || {}).length} tables.` });
    } catch (e: any) {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  // Register reset handler for keyboard shortcut
  useEffect(() => {
    setResetHandler(() => handleReset);
    return () => setResetHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSnapshot = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("scenario-snapshot", { body: { action: "save", name: snapName || undefined } });
      if (error) throw error;
      setSnapName("");
      loadScenarios();
      toast({ title: "Snapshot saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const restoreSnapshot = async (id: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("scenario-snapshot", { body: { action: "restore", id } });
      if (error) throw error;
      toast({ title: "Snapshot restored" });
    } catch (e: any) {
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader><CardTitle className="text-lg">Demo Controls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Demo Mode</div>
              <div className="text-sm text-muted-foreground">Shows the floating presenter panel and timer. Shortcut: D</div>
            </div>
            <Switch checked={demoMode} onCheckedChange={setDemoMode} />
          </div>

          <div className="border-t pt-4">
            <div className="font-medium mb-1">Reset to Clean Demo State</div>
            <div className="text-sm text-muted-foreground mb-3">
              Wipes all dynamic data and replants the original problem states. Shortcut: R
              {lastResetAt && <span className="block mt-1">Last reset: {new Date(lastResetAt).toLocaleString()}</span>}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="lg" disabled={resetting}>
                  {resetting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                  Reset to Clean Demo State
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset all dynamic data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will truncate sales, inventory, POs, insights, transfers, recommendations, and chats — then re-seed the planted problem states (50 at-risk, 20 stockouts, 100 excess, 5 late POs).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Scenario Snapshots</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Snapshot name (optional)" value={snapName} onChange={(e) => setSnapName(e.target.value)} />
            <Button onClick={saveSnapshot} disabled={busy}>
              <Save className="h-4 w-4 mr-2" /> Save current state
            </Button>
          </div>
          <div className="space-y-2">
            {scenarios.length === 0 && <p className="text-sm text-muted-foreground">No snapshots yet.</p>}
            {scenarios.map((s) => (
              <div key={s.id} className="flex items-center justify-between border rounded p-2">
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => restoreSnapshot(s.id)} disabled={busy}>
                  <Play className="h-3 w-3 mr-1" /> Restore
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Presenter Mode — 10-minute Timing</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {TIMING.map((t) => (
              <li key={t.at} className="flex gap-3 text-sm">
                <span className="font-mono font-semibold w-12 shrink-0 text-primary">{t.at}</span>
                <span className="text-muted-foreground">{t.text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 text-xs text-muted-foreground border-t pt-3">
            Keyboard shortcuts: <kbd className="px-1 border rounded">D</kbd> toggle demo mode ·
            <kbd className="px-1 border rounded ml-1">R</kbd> reset state ·
            <kbd className="px-1 border rounded ml-1">→</kbd> next demo page
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
