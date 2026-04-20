/**
 * Lightweight module-level store for passing the current dashboard search query
 * to AddGameModal when it opens from the Header (sibling component).
 */
let _pendingQuery = "";

export const getAddGamePendingQuery = () => _pendingQuery;
export const setAddGamePendingQuery = (q: string) => {
  _pendingQuery = q;
};
export const clearAddGamePendingQuery = () => {
  _pendingQuery = "";
};
