import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { LogOut, User } from "lucide-react";
import { HowToButton } from "@/components/HowToButton";
import { TourButton } from "@/tour/TourButton";

type Branch = { id: string; name: string; city: string; state: string };

export function TopBar() {
  const { branchId, setBranchId } = useBranch();
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    supabase
      .from("branches")
      .select("id,name,city,state")
      .order("name")
      .then(({ data }) => setBranches((data ?? []) as Branch[]));
  }, []);

  return (
    <header className="h-14 border-b bg-background flex items-center gap-3 px-3 sticky top-0 z-30">
      <SidebarTrigger />
      <div className="ml-auto flex items-center gap-2">
        <TourButton />
        <HowToButton />
        <Select value={branchId} onValueChange={(v) => setBranchId(v as string)}>
          <SelectTrigger className="w-[220px] h-9">
            <SelectValue placeholder="All Branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name} — {b.city}, {b.state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}
