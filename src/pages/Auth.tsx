import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Droplets } from "lucide-react";

export default function Auth() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) toast.error(error.message);
      else toast.success("Account created. Signing in…");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
    }
    setBusy(false);
  };

  return (
    <main className="min-h-screen grid place-items-center bg-muted/30 p-6">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-md bg-primary text-primary-foreground grid place-items-center">
            <Droplets className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">FlowOps</h1>
            <p className="text-xs text-muted-foreground mt-1">Inventory intelligence</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="text-sm font-medium">Email</label>
          <Input
            type="email"
            required
            placeholder="you@distributor.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="text-sm font-medium">Password</label>
          <Input
            type="password"
            required
            minLength={6}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
          </button>
        </form>
      </Card>
    </main>
  );
}
