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
import Reorder from "./pages/Reorder";
import NetworkGraph from "./pages/NetworkGraph";
import Agents from "./pages/Agents";
import Chat from "./pages/Chat";
import Auth from "./pages/Auth";
import Settings from "./pages/Settings";
import Users from "./pages/Users";
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
            <Route path="/auth" element={<Navigate to="/" replace />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/skus" element={<Skus />} />
              <Route path="/skus/:id" element={<SkuDetail />} />
              <Route path="/reorder" element={<Reorder />} />
              <Route path="/reorders" element={<Reorder />} />
              <Route path="/network" element={<NetworkGraph />} />
              <Route path="/graph" element={<NetworkGraph />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/ask" element={<Chat />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/connect" element={<ConnectData />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/users" element={<Users />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
