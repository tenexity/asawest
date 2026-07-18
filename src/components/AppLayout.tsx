import { Outlet } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";
import { BranchProvider } from "@/contexts/BranchContext";
import { DemoProvider } from "@/contexts/DemoContext";
import { DemoPanel } from "@/components/DemoPanel";
import { TourProvider } from "@/tour/TourProvider";

export default function AppLayout() {
  return (
    <BranchProvider>
      <DemoProvider>
        <TourProvider>
          <SidebarProvider>
            <div className="min-h-screen flex w-full bg-muted/20">
              <AppSidebar />
              <div className="flex-1 flex flex-col min-w-0">
                <TopBar />
                <main className="flex-1 p-4 md:p-6 min-w-0">
                  <Outlet />
                </main>
              </div>
            </div>
            <DemoPanel />
          </SidebarProvider>
        </TourProvider>
      </DemoProvider>
    </BranchProvider>
  );
}
