import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole, AppRole } from "@/hooks/useUserRole";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, Trash2, UserPlus } from "lucide-react";

type UserRow = { user_id: string; email: string; created_at: string; role: AppRole | null };
type Invite = { id: string; email: string; role: AppRole; created_at: string; accepted_at: string | null };

export default function Users() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("viewer");

  const load = async () => {
    setLoading(true);
    const [u, i] = await Promise.all([
      supabase.rpc("admin_list_users"),
      supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    ]);
    if (u.data) setUsers(u.data as UserRow[]);
    if (i.data) setInvites(i.data as Invite[]);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (roleLoading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("invitations").upsert(
      { email: inviteEmail.trim().toLowerCase(), role: inviteRole, accepted_at: null },
      { onConflict: "email" }
    );
    setBusy(false);
    if (error) return toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    toast({ title: "Invitation saved", description: `${inviteEmail} will get ${inviteRole} access when they sign up.` });
    setInviteEmail("");
    load();
  };

  const deleteInvite = async (id: string) => {
    await supabase.from("invitations").delete().eq("id", id);
    load();
  };

  const changeRole = async (user_id: string, role: AppRole) => {
    const { error } = await supabase.rpc("admin_set_user_role", { _user_id: user_id, _role: role });
    if (error) return toast({ title: "Update failed", description: error.message, variant: "destructive" });
    toast({ title: "Role updated" });
    load();
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Admins have full access. Viewers can browse data but cannot reset state or save snapshots.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg flex items-center gap-2"><UserPlus className="h-4 w-4" /> Invite a user</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              type="email"
              placeholder="person@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 min-w-[240px]"
            />
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="viewer">Viewer (read-only)</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={sendInvite} disabled={busy || !inviteEmail.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
              Save invitation
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The invited person signs up at the sign-in page with this email. Their role is assigned automatically.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Pending invitations</CardTitle></CardHeader>
        <CardContent>
          {invites.filter(i => !i.accepted_at).length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invitations.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Sent</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {invites.filter(i => !i.accepted_at).map(i => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell><Badge variant="secondary">{i.role}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(i.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => deleteInvite(i.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Active users</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Email</TableHead><TableHead>Joined</TableHead><TableHead className="w-[200px]">Role</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {users.map(u => (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Select value={u.role ?? "viewer"} onValueChange={(v) => changeRole(u.user_id, v as AppRole)}>
                        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
