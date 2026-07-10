import { Router as WouterRouter, Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import Header from "@/components/Header";
import MobileBottomNav from "@/components/MobileBottomNav";
import { getPageTitle } from "@/components/navigation-items";
import { useBackgroundNotifications } from "@/hooks/use-background-notifications";
import { AuthProvider } from "@/lib/auth";
import { Suspense, lazy, useEffect, useRef } from "react";
import LoadingFallback from "@/components/LoadingFallback";
import { ThemeProvider } from "next-themes";
import { routerBase } from "@/lib/app-path";
import { routePaths } from "@/lib/routes";
import { GHOST_THEME_KEY } from "@/lib/ghost-mode";

// ⚡ Bolt: Code splitting with React.lazy
// This reduces the initial bundle size by loading pages only when needed.
const Library = lazy(() => import("@/components/Library"));
const DiscoverPage = lazy(() => import("@/pages/discover"));
const SearchPage = lazy(() => import("@/pages/search"));
const DownloadsPage = lazy(() => import("@/pages/downloads"));
const IndexersPage = lazy(() => import("@/pages/indexers"));
const DownloadersPage = lazy(() => import("@/pages/downloaders"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const NotFound = lazy(() => import("@/pages/not-found"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const WishlistPage = lazy(() => import("@/pages/wishlist"));
const XrelReleasesPage = lazy(() => import("@/pages/xrel-releases"));
const RssPage = lazy(() => import("@/pages/rss"));
const LoginPage = lazy(() => import("@/pages/auth/login"));
const SetupPage = lazy(() => import("@/pages/auth/setup"));
const StatsPage = lazy(() => import("@/pages/stats"));
const LogsPage = lazy(() => import("@/pages/logs"));
const ImportHistoryPage = lazy(() => import("@/pages/import-history"));
const PlayPage = lazy(() => import("@/pages/play"));

// Konami code: an undocumented shortcut into the /play easter egg.
const KONAMI_CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "KeyB",
  "KeyA",
];

function useKonamiCode(onActivate: () => void) {
  // Keep the listener bound once; read the latest callback through a ref instead of
  // re-subscribing every render (onActivate is typically a fresh inline closure).
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    let progress = 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === KONAMI_CODE[progress]) {
        progress++;
      } else {
        // A mistyped repeat of the first key shouldn't force restarting the whole sequence.
        progress = event.code === KONAMI_CODE[0] ? 1 : 0;
      }
      if (progress === KONAMI_CODE.length) {
        progress = 0;
        onActivateRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function Router() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Switch>
        <Route path={routePaths.login} component={LoginPage} />
        <Route path={routePaths.setup} component={SetupPage} />
        <Route path={routePaths.play} component={PlayPage} />
        <Route path={routePaths.library} component={Library} />
        <Route path={routePaths.discover} component={DiscoverPage} />
        <Route path={routePaths.search} component={SearchPage} />
        <Route path={routePaths.downloads} component={DownloadsPage} />
        <Route path={routePaths.indexers} component={IndexersPage} />
        <Route path={routePaths.downloaders} component={DownloadersPage} />
        <Route path={routePaths.settings} component={SettingsPage} />
        <Route path={routePaths.calendar} component={CalendarPage} />
        <Route path={routePaths.wishlist} component={WishlistPage} />
        <Route path={routePaths.xrel} component={XrelReleasesPage} />
        <Route path={routePaths.rss} component={RssPage} />
        <Route path={routePaths.stats} component={StatsPage} />
        <Route path={routePaths.logs} component={LogsPage} />
        <Route path={routePaths.importHistory} component={ImportHistoryPage} />
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

function AppShell() {
  const [location, navigate] = useLocation();

  useKonamiCode(() => navigate(routePaths.play));

  // Re-apply the cosmetic Ghost Mode accent (if the player unlocked and enabled it) on load.
  useEffect(() => {
    const enabled = localStorage.getItem(GHOST_THEME_KEY) === "true";
    document.documentElement.classList.toggle("theme-ghost", enabled);
  }, []);

  // Custom sidebar width for the application
  const style = {
    "--sidebar-width": "16rem", // 256px for navigation
    "--sidebar-width-icon": "4rem", // default icon width
  };

  // If on login, setup, or the hidden /play easter egg, render simplified layout without sidebar/header
  if (
    location === routePaths.login ||
    location === routePaths.setup ||
    location === routePaths.play
  ) {
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
                  <main className="flex-1 overflow-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
                    <AppContent />
                  </main>
                </div>
                <MobileBottomNav activeItem={location} onNavigate={navigate} />
              </div>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={routerBase}>
      <AppShell />
    </WouterRouter>
  );
}

export default App;
