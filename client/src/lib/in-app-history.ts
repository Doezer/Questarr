/**
 * Marks every history entry the app pushes itself, so going back can tell "the previous page is
 * Questarr" from "this entry came from a bookmark or an external link". The entry the app booted
 * on is never marked: its predecessor may belong to another site.
 */
const IN_APP_MARKER = "__questarrInApp";

if (typeof window !== "undefined" && !(window.history as { __marked?: boolean }).__marked) {
  const pushState = window.history.pushState.bind(window.history);
  window.history.pushState = (state: unknown, unused: string, url?: string | URL | null) => {
    const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    pushState({ ...base, [IN_APP_MARKER]: true }, unused, url);
  };
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
