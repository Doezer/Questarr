import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import Header from "@/components/Header";
import { useBackgroundNotifications } from "@/hooks/use-background-notifications";
import { AuthProvider } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";
import DiscoverPage from "@/pages/discover";
import SearchPage from "@/pages/search";
import DownloadsPage from "@/pages/downloads";
import IndexersPage from "@/pages/indexers";
import DownloadersPage from "@/pages/downloaders";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import LibraryPage from "@/pages/library";
import CalendarPage from "@/pages/calendar";
import WishlistPage from "@/pages/wishlist";
import LoginPage from "@/pages/auth/login";
import SetupPage from "@/pages/auth/setup";
import { ThemeProvider } from "next-themes";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/setup" component={SetupPage} />
      <Route path="/" component={Dashboard} />
      <Route path="/discover" component={DiscoverPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/downloads" component={DownloadsPage} />
      <Route path="/indexers" component={IndexersPage} />
      <Route path="/downloaders" component={DownloadersPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/calendar" component={CalendarPage} />
      <Route path="/wishlist" component={WishlistPage} />
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
  const [location, navigate] = useLocation();

  // Custom sidebar width for the application
  const style = {
    "--sidebar-width": "16rem", // 256px for navigation
    "--sidebar-width-icon": "4rem", // default icon width
  };

  const getPageTitle = (path: string) => {
    switch (path) {
      case "/":
        return "Dashboard";
      case "/discover":
        return "Discover";
      case "/search":
        return "Search";
      case "/downloads":
        return "Downloads";
      case "/indexers":
        return "Indexers";
      case "/downloaders":
        return "Downloaders";
      case "/settings":
        return "Settings";
      case "/library":
        return "Library";
      case "/calendar":
        return "Calendar";
      case "/wishlist":
        return "Wishlist";
      default:
        return "Questarr";
    }
  };

  // If on login or setup page, render simplified layout without sidebar/header
  if (location === "/login" || location === "/setup") {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <AuthProvider>
            <Router />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <AuthProvider>
          <TooltipProvider>
            <SidebarProvider style={style as React.CSSProperties}>
              <div className="flex h-screen w-full overflow-hidden">
                <AppSidebar activeItem={location} onNavigate={navigate} />
                <div className="flex flex-col flex-1 min-w-0">
                  <Header title={getPageTitle(location)} />
                  <main className="flex-1 overflow-hidden">
                    <AppContent />
                  </main>
                </div>
              </div>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
