/**
 * Length of the tab's history when the app booted. Anything beyond it was pushed by in-app
 * navigation, so going back stays inside Questarr; a page opened from a bookmark or an external
 * link in a tab that already had history is not mistaken for "has somewhere to go back to".
 */
const initialHistoryLength = typeof window === "undefined" ? 1 : window.history.length;

export function canGoBackInApp(): boolean {
  return typeof window !== "undefined" && window.history.length > initialHistoryLength;
}
