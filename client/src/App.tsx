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
import { Suspense, lazy } from "react";
import LoadingFallback from "@/components/LoadingFallback";
import { ThemeProvider } from "next-themes";

// ⚡ Bolt: Code splitting with React.lazy
// This reduces the initial bundle size by loading pages only when needed.
const Dashboard = lazy(() => import("@/components/Dashboard"));
const DiscoverPage = lazy(() => import("@/pages/discover"));
const SearchPage = lazy(() => import("@/pages/search"));
const DownloadsPage = lazy(() => import("@/pages/downloads"));
const IndexersPage = lazy(() => import("@/pages/indexers"));
const DownloadersPage = lazy(() => import("@/pages/downloaders"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const NotFound = lazy(() => import("@/pages/not-found"));
const LibraryPage = lazy(() => import("@/pages/library"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const WishlistPage = lazy(() => import("@/pages/wishlist"));
const XrelReleasesPage = lazy(() => import("@/pages/xrel-releases"));
const RssPage = lazy(() => import("@/pages/rss"));
const LoginPage = lazy(() => import("@/pages/auth/login"));
const SetupPage = lazy(() => import("@/pages/auth/setup"));

function Router() {
  return (
    <Suspense fallback={<LoadingFallback />}>
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
        <Route path="/xrel" component={XrelReleasesPage} />
        <Route path="/rss" component={RssPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
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
      case "/xrel":
        return "xREL.to releases";
      case "/rss":
        return "RSS Feeds";
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
