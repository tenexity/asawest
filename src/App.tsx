import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Skus from "./pages/Skus";
import SkuDetail from "./pages/SkuDetail";
import ConnectData from "./pages/ConnectData";
import Placeholder from "./pages/Placeholder";
import NetworkGraph from "./pages/NetworkGraph";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/skus" element={<Skus />} />
              <Route path="/skus/:id" element={<SkuDetail />} />
              <Route path="/reorder" element={<Placeholder title="Reorder Recommendations" />} />
              <Route path="/network" element={<NetworkGraph />} />
              <Route path="/graph" element={<NetworkGraph />} />
              <Route path="/agents" element={<Placeholder title="Agents" />} />
              <Route path="/ask" element={<Placeholder title="Ask AI" />} />
              <Route path="/connect" element={<ConnectData />} />
              <Route path="/settings" element={<Placeholder title="Settings" />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
