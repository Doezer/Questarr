import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useBackgroundNotifications } from "@/hooks/use-background-notifications";
import Dashboard from "@/components/Dashboard";
import SearchPage from "@/pages/search";
import DownloadsPage from "@/pages/downloads";
import IndexersPage from "@/pages/indexers";
import DownloadersPage from "@/pages/downloaders";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/search" component={SearchPage} />
      <Route path="/downloads" component={DownloadsPage} />
      <Route path="/indexers" component={IndexersPage} />
      <Route path="/downloaders" component={DownloadersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  // Enable background notifications for downloads
  useBackgroundNotifications();

  return <Router />;
}

function App() {
  // Custom sidebar width for the application
  const style = {
    "--sidebar-width": "16rem",       // 256px for navigation
    "--sidebar-width-icon": "4rem",   // default icon width
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1">
              <header className="flex items-center justify-between p-4 border-b">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <h1 className="text-xl font-semibold">GameRadarr</h1>
              </header>
              <main className="flex-1 overflow-hidden">
                <AppContent />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
