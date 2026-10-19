export const routePaths = {
  login: "/login",
  setup: "/setup",
  play: "/play",
  library: "/",
  discover: "/discover",
  search: "/search",
  downloads: "/downloads",
  indexers: "/indexers",
  downloaders: "/downloaders",
  settings: "/settings",
  calendar: "/calendar",
  wishlist: "/wishlist",
  playing: "/playing",
  libraryImport: "/library-import",
  xrel: "/xrel",
  rss: "/rss",
  stats: "/stats",
  logs: "/logs",
  importHistory: "/activity/imports",
  activityHistory: "/activity/history",
  activityBlocklist: "/activity/blocklist",
  systemTasks: "/system/tasks",
} as const;

/** Wouter pattern for the per-game details page. */
export const gameDetailsRoutePattern = "/games/:id";

/** Path of the details page for a library game or a Discover game (`igdb-<id>`). */
export function gameDetailsPath(gameId: string): string {
  return `/games/${encodeURIComponent(gameId)}`;
}

export const appRoutePaths = [
  routePaths.login,
  routePaths.setup,
  routePaths.library,
  routePaths.discover,
  routePaths.search,
  routePaths.downloads,
  routePaths.indexers,
  routePaths.downloaders,
  routePaths.settings,
  routePaths.calendar,
  routePaths.wishlist,
  routePaths.playing,
  routePaths.libraryImport,
  routePaths.xrel,
  routePaths.rss,
  routePaths.stats,
  routePaths.logs,
  routePaths.importHistory,
  routePaths.activityHistory,
  routePaths.activityBlocklist,
  routePaths.systemTasks,
] as const;
