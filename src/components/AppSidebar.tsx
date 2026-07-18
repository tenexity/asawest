import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  ClipboardList,
  Scale,
  Network,
  Bot,
  Sparkles,
  Plug,
  Settings,
  Droplets,
  Users as UsersIcon,
} from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "SKU Explorer", url: "/skus", icon: Boxes },
  { title: "SKU Balance", url: "/balance", icon: Scale },
  { title: "Reorder Plan", url: "/reorder", icon: ClipboardList },
  { title: "Network Graph", url: "/network", icon: Network },
  { title: "Agents", url: "/agents", icon: Bot },
  { title: "Ask AI", url: "/ask", icon: Sparkles },
  { title: "Connect Data", url: "/connect", icon: Plug },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { isAdmin } = useUserRole();
  const navItems = isAdmin
    ? [...items, { title: "Users", url: "/users", icon: UsersIcon }]
    : items;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-1 py-1">
          <div className="h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground grid place-items-center">
            <Droplets className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="font-semibold tracking-tight">Inventory Forecaster</div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active =
                  item.url === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <NavLink to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
