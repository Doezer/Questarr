1. **Optimize `.filter(...).length` in `client/src/components/CollectionDialog.tsx`**:
   - Currently, `matchCount` uses `games.filter((g) => gameMatchesCollectionRules(g, rules)).length`. This creates an unnecessary array allocation for items that are immediately discarded.
   - Refactor `matchCount` calculation to use a `for...of` loop to increment a counter instead, as per Bolt's journal (`2026-07-30 - O(N) Array Filter Optimization`).

2. **Optimize `.filter(...).length` in `client/src/components/GameJournalTab.tsx`**:
   - The same issue exists here: `achievementsData.achievements.filter((a) => a.achieved).length`.
   - Refactor this to use a memoized counter, e.g. `const achievedCount = useMemo(() => { ... }, [achievementsData])`.

3. **Verify Changes**:
   - Check there are no type errors with `npm run check`.
   - Check tests with `npm run test`.
   - Ensure the app builds/lints cleanly.

4. **Complete Pre-Commit Steps**:
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
