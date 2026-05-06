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
  const [sending, setSending] = useState(false);

  if (loading) return null;
  if (session) return <Navigate to="/" replace />;

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) toast.error(error.message);
    else toast.success("Magic link sent. Check your inbox.");
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
        <form onSubmit={sendLink} className="space-y-3">
          <label className="text-sm font-medium">Work email</label>
          <Input
            type="email"
            required
            placeholder="you@distributor.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? "Sending…" : "Send magic link"}
          </Button>
          <p className="text-xs text-muted-foreground">
            We'll email you a one-tap sign-in link. No password needed.
          </p>
        </form>
      </Card>
    </main>
  );
}
