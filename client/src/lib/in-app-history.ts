/**
 * Marks every history entry the app pushes itself, so going back can tell "the previous page is
 * Questarr" from "this entry came from a bookmark or an external link". The entry the app booted
 * on is never marked: its predecessor may belong to another site.
 */
const IN_APP_MARKER = "__questarrInApp";

const OPENED_GAME_MARKER = "__questarrOpenedGame";
let lastNavWasPop = false;
const listStates = new Map<string, unknown>();

if (typeof window !== "undefined" && !(window.history as { __marked?: boolean }).__marked) {
  const pushState = window.history.pushState.bind(window.history);
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
    const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    // Snapshot the list state on the entry a game page is opened from, so Back to that very entry
    // restores exactly what it showed.
    if (url && /\/games\/[^/?#]+/.test(String(url))) {
      const current = window.history.state as Record<string, unknown> | null;
      nativeReplaceState(
        { ...(current ?? {}), [OPENED_GAME_MARKER]: Object.fromEntries(listStates) },
        ""
      );
    }
    lastNavWasPop = false;
    pushState({ ...base, [IN_APP_MARKER]: true }, unused, url);
  };
  window.addEventListener("popstate", () => {
    lastNavWasPop = true;
  });
  // A replace keeps the entry it replaces: if the app pushed it, it stays marked.
  const replaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (state: unknown, unused: string, url?: string | URL | null) => {
    const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    replaceState(canGoBackInApp() ? { ...base, [IN_APP_MARKER]: true } : state, unused, url);
  };
  (window.history as { __marked?: boolean }).__marked = true;
}

export function canGoBackInApp(): boolean {
  const state = typeof window === "undefined" ? null : (window.history.state as unknown);
  return Boolean(state && typeof state === "object" && IN_APP_MARKER in state);
}

/** Keep a list page's search/filters in memory so they survive a detour to a game page. */
export function saveListState(key: string, state: unknown): void {
  listStates.set(key, state);
}

/** The saved list state, only when this page is being returned to by Back from one of its games. */
export function restoredListState<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  const state = window.history.state as Record<string, unknown> | null;
  const snapshot = state?.[OPENED_GAME_MARKER] as Record<string, unknown> | undefined;
  if (!lastNavWasPop || !snapshot) return undefined;
  return snapshot[key] as T | undefined;
}
